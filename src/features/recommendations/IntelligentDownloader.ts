/**
 * IntelligentDownloader
 * ─────────────────────
 *
 * Builds a ranked list of downloadable YouTube candidates that the user is
 * statistically likely to enjoy, derived from their last 14 days of plays.
 *
 * Pipeline (one pass per call to `buildDownloadCandidates`):
 *   1. Pull plays from the last 14 days, weight by skip behaviour
 *      (full listens count for 1.0, skips for 0.2 — "skip-weighted").
 *   2. Group by track to derive the user's top-5 *artists* and a small set
 *      of dominant *genres*.
 *   3. Cold-start fallback when there's almost no history (< 10 plays):
 *      a fixed seed list of broad Bollywood queries.
 *   4. For each seed, run `searchYouTube(query, 5)` in parallel via
 *      `Promise.allSettled` — one slow seed never blocks the others.
 *   5. Filter candidates that are already in the library (by `youtubeId`
 *      OR a fuzzy `${artist}::${title}` lowercase match).
 *   6. Score each surviving candidate:
 *        seedRankInverse * 0.5
 *      + artistMatchBoost * 0.3
 *      + genreMatchBoost  * 0.15
 *      + smallRandom      * 0.05
 *   7. Mix 80 % from the top of the ranking with 20 % random picks from the
 *      tail — "exploit/explore" — for diversity without sacrificing signal.
 *   8. Slice to `count`.
 *
 * Each suggestion carries a human-readable `rationale` like
 * "Because you've been playing Arijit Singh" so the UI can explain the pick.
 */

import { Q } from '@nozbe/watermelondb';
import { tracksCollection, playsCollection } from '@/db';
import { searchYouTube } from '@/features/download/YoutubeExtractor';
import { AVG_TRACK_BYTES, formatBytes } from '@/services/storage/StorageEstimator';
import type { YouTubeSearchResult } from '@/types/track';
import { logger } from '@/utils/logger';

// ── Public types ───────────────────────────────────────────────────────────

export interface DownloadSuggestion {
  /** YouTube video ID — also the dedupe key. */
  videoId: string;
  title: string;
  artist: string;
  thumbnail: string;
  duration_ms: number;
  /** Human-readable explanation, e.g. "Because you've been playing Arijit Singh". */
  rationale: string;
  /** Estimated final on-disk size in bytes (uses AVG_TRACK_BYTES). */
  estimatedBytes: number;
  /** Pre-formatted size string to drop into UI without further work. */
  estimatedSizeReadable: string;
  /** Composite score; higher is better. Exposed for debugging / UI sort tiebreaks. */
  priorityScore: number;
}

// ── Internal constants ────────────────────────────────────────────────────

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
const MIN_PLAYS_FOR_PERSONALISATION = 10;
const TOP_ARTIST_COUNT = 5;
const PER_SEED_RESULTS = 5;
const EXPLOIT_RATIO = 0.8;

/** Seed queries used when the user has almost no listening history yet. */
const COLD_START_SEEDS: string[] = [
  'AR Rahman best',
  'Arijit Singh hits',
  'Bollywood Romantic 2024',
  'Bollywood Party Anthems',
  'Bollywood Classical',
];

// ── Listening profile derivation ──────────────────────────────────────────

interface ListeningProfile {
  /** Top artists by skip-weighted play count, most-played first. */
  topArtists: string[];
  /** Top genres (may be empty if tracks lack a genre tag). */
  topGenres: string[];
  /** Total skip-weighted play count from the analysis window. */
  totalWeight: number;
  /** Whether we're operating in cold-start mode. */
  isColdStart: boolean;
}

/**
 * Aggregates the last 14 days of plays into a listener profile.
 *
 * `weight = wasSkipped ? 0.2 : 1.0` — skips still count a little so that
 * "songs the user heard but immediately skipped" don't accidentally drop
 * out of consideration entirely (we still know they heard the artist).
 */
async function deriveProfile(): Promise<ListeningProfile> {
  const since = Date.now() - FOURTEEN_DAYS_MS;

  let plays: Awaited<ReturnType<ReturnType<typeof playsCollection.query>['fetch']>>;
  try {
    plays = await playsCollection
      .query(Q.where('played_at', Q.gte(since)))
      .fetch();
  } catch (err) {
    logger.error('[IntelligentDownloader] plays query failed:', err);
    plays = [];
  }

  if (plays.length < MIN_PLAYS_FOR_PERSONALISATION) {
    return { topArtists: [], topGenres: [], totalWeight: 0, isColdStart: true };
  }

  // Sum weighted plays per track ID.
  const trackWeights = new Map<string, number>();
  let totalWeight = 0;
  for (const play of plays) {
    const w = play.wasSkipped ? 0.2 : 1.0;
    trackWeights.set(play.trackId, (trackWeights.get(play.trackId) ?? 0) + w);
    totalWeight += w;
  }

  // Resolve track IDs → models in a single query.
  const trackIds = [...trackWeights.keys()];
  let trackModels: Awaited<ReturnType<ReturnType<typeof tracksCollection.query>['fetch']>>;
  try {
    trackModels = await tracksCollection
      .query(Q.where('id', Q.oneOf(trackIds)))
      .fetch();
  } catch (err) {
    logger.error('[IntelligentDownloader] tracks query failed:', err);
    trackModels = [];
  }

  // Bucket weight by artist and genre.
  const artistWeights = new Map<string, number>();
  const genreWeights = new Map<string, number>();
  for (const t of trackModels) {
    const w = trackWeights.get(t.id) ?? 0;
    if (t.artist) {
      artistWeights.set(t.artist, (artistWeights.get(t.artist) ?? 0) + w);
    }
    if (t.genre) {
      genreWeights.set(t.genre, (genreWeights.get(t.genre) ?? 0) + w);
    }
  }

  const topArtists = [...artistWeights.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_ARTIST_COUNT)
    .map(([a]) => a);

  const topGenres = [...genreWeights.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([g]) => g);

  return {
    topArtists,
    topGenres,
    totalWeight,
    isColdStart: topArtists.length === 0,
  };
}

// ── Library lookup (for dedupe) ───────────────────────────────────────────

interface LibraryIndex {
  ytIds: Set<string>;
  fuzzyKeys: Set<string>; // `${artist}::${title}` lowercased
}

async function buildLibraryIndex(): Promise<LibraryIndex> {
  const ytIds = new Set<string>();
  const fuzzyKeys = new Set<string>();
  try {
    const all = await tracksCollection.query().fetch();
    for (const t of all) {
      if (t.youtubeId) ytIds.add(t.youtubeId);
      fuzzyKeys.add(`${t.artist}::${t.title}`.toLowerCase());
    }
  } catch (err) {
    logger.error('[IntelligentDownloader] library index failed:', err);
  }
  return { ytIds, fuzzyKeys };
}

function isInLibrary(
  result: YouTubeSearchResult,
  index: LibraryIndex,
): boolean {
  if (index.ytIds.has(result.id)) return true;
  const key = `${result.author}::${result.title}`.toLowerCase();
  return index.fuzzyKeys.has(key);
}

// ── Candidate gathering ───────────────────────────────────────────────────

interface SeededResult {
  result: YouTubeSearchResult;
  /** Index of the seed query (0-based) — lower = more relevant seed. */
  seedIndex: number;
  /** The seed query that produced this result (for rationale text). */
  seedLabel: string;
  /** Position within the seed's results (0-based — top of the search list = 0). */
  rankInSeed: number;
}

/**
 * Runs all seed queries in parallel and flattens the results, retaining the
 * seed origin information needed for scoring + rationale.
 */
async function gatherCandidates(
  seeds: string[],
  seedLabels: string[],
): Promise<SeededResult[]> {
  const settled = await Promise.allSettled(
    seeds.map((q) => searchYouTube(q, PER_SEED_RESULTS)),
  );

  const out: SeededResult[] = [];
  settled.forEach((r, seedIndex) => {
    if (r.status !== 'fulfilled') return;
    r.value.forEach((result, rankInSeed) => {
      out.push({
        result,
        seedIndex,
        seedLabel: seedLabels[seedIndex] ?? seeds[seedIndex],
        rankInSeed,
      });
    });
  });
  return out;
}

// ── Scoring ───────────────────────────────────────────────────────────────

interface ScoredCandidate extends SeededResult {
  score: number;
  matchedArtist: string | null;
  matchedGenre: string | null;
}

function scoreCandidate(
  sr: SeededResult,
  profile: ListeningProfile,
  totalSeeds: number,
): ScoredCandidate {
  // 1. Seed rank inverse — earlier seed + earlier in seed = higher.
  const seedDepth = totalSeeds <= 1 ? 1 : sr.seedIndex / Math.max(1, totalSeeds - 1);
  const positionDepth =
    PER_SEED_RESULTS <= 1 ? 0 : sr.rankInSeed / (PER_SEED_RESULTS - 1);
  const seedRankInverse = 1 - 0.7 * seedDepth - 0.3 * positionDepth;

  // 2. Artist boost — does the result's channel match a top artist?
  const lowerAuthor = sr.result.author.toLowerCase();
  const lowerTitle = sr.result.title.toLowerCase();
  let matchedArtist: string | null = null;
  let artistMatchBoost = 0;
  for (const a of profile.topArtists) {
    const lower = a.toLowerCase();
    if (
      lowerAuthor.includes(lower) ||
      lowerTitle.includes(lower)
    ) {
      matchedArtist = a;
      // Higher boost when the matched artist ranks earlier in topArtists.
      const idx = profile.topArtists.indexOf(a);
      artistMatchBoost = 1 - idx * 0.15;
      break;
    }
  }

  // 3. Genre boost — match on title text.
  let matchedGenre: string | null = null;
  let genreMatchBoost = 0;
  for (const g of profile.topGenres) {
    if (lowerTitle.includes(g.toLowerCase())) {
      matchedGenre = g;
      genreMatchBoost = 1;
      break;
    }
  }

  // 4. Tiny random component to break ties + add diversity.
  const smallRandom = Math.random();

  const score =
    seedRankInverse * 0.5 +
    artistMatchBoost * 0.3 +
    genreMatchBoost * 0.15 +
    smallRandom * 0.05;

  return { ...sr, score, matchedArtist, matchedGenre };
}

// ── Rationale composition ─────────────────────────────────────────────────

function composeRationale(c: ScoredCandidate, profile: ListeningProfile): string {
  if (c.matchedArtist) {
    return `Because you've been playing ${c.matchedArtist}`;
  }
  if (c.matchedGenre) {
    return `Top ${c.matchedGenre} pick`;
  }
  if (profile.isColdStart) {
    return `Top ${c.seedLabel}`;
  }
  return `Similar to your recent listening`;
}

// ── Exploit/explore mix ───────────────────────────────────────────────────

/**
 * Picks `count` from `ranked` (already sorted high → low score) using an
 * 80 / 20 exploit / explore mix:
 *   • 80 % from the top of the list (the highest-confidence picks)
 *   • 20 % random samples from the remainder (diversity)
 *
 * Falls back gracefully when `ranked` has fewer than `count` items.
 */
function exploitExploreMix<T>(ranked: T[], count: number): T[] {
  if (count <= 0 || ranked.length === 0) return [];
  if (ranked.length <= count) return ranked.slice();

  const exploitN = Math.max(1, Math.round(count * EXPLOIT_RATIO));
  const exploreN = count - exploitN;

  const head = ranked.slice(0, exploitN);
  const tail = ranked.slice(exploitN);

  // Sample exploreN from the tail without replacement.
  const tailCopy = tail.slice();
  const explorePicks: T[] = [];
  for (let i = 0; i < exploreN && tailCopy.length > 0; i++) {
    const idx = Math.floor(Math.random() * tailCopy.length);
    explorePicks.push(tailCopy[idx]);
    tailCopy.splice(idx, 1);
  }

  return [...head, ...explorePicks];
}

// ── Module-level cache for repeat replacement requests ────────────────────

interface SuggestionCache {
  /** All ranked candidates from the most recent build, descending score. */
  ranked: { candidate: ScoredCandidate; suggestion: DownloadSuggestion }[];
  builtAt: number;
}

let _cache: SuggestionCache | null = null;

/**
 * Cache TTL — replacement requests assume the cache is reasonably fresh.
 * After this expires we rebuild from scratch.
 */
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ── Core build ────────────────────────────────────────────────────────────

interface BuildContext {
  ranked: ScoredCandidate[];
  profile: ListeningProfile;
}

async function buildRanking(): Promise<BuildContext> {
  const profile = await deriveProfile();
  const libraryIndex = await buildLibraryIndex();

  // Determine seed queries.
  let seeds: string[];
  let seedLabels: string[];
  if (profile.isColdStart) {
    seeds = COLD_START_SEEDS;
    seedLabels = COLD_START_SEEDS;
  } else {
    // Personalised — search by each top artist and add a couple of broad seeds.
    const personalised = profile.topArtists.map((a) => `${a} hits`);
    const broad = ['Bollywood Romantic 2024', 'Bollywood Party Anthems'];
    seeds = [...personalised, ...broad];
    seedLabels = [...profile.topArtists, ...broad];
  }

  const candidates = await gatherCandidates(seeds, seedLabels);

  // Filter dupes (same videoId across different seeds) keeping the earliest.
  const seenVideoIds = new Set<string>();
  const unique: SeededResult[] = [];
  for (const c of candidates) {
    if (!c.result.id) continue;
    if (seenVideoIds.has(c.result.id)) continue;
    if (isInLibrary(c.result, libraryIndex)) continue;
    seenVideoIds.add(c.result.id);
    unique.push(c);
  }

  const scored = unique
    .map((c) => scoreCandidate(c, profile, seeds.length))
    .sort((a, b) => b.score - a.score);

  return { ranked: scored, profile };
}

function toSuggestion(
  c: ScoredCandidate,
  profile: ListeningProfile,
): DownloadSuggestion {
  return {
    videoId: c.result.id,
    title: c.result.title,
    artist: c.result.author,
    thumbnail: c.result.thumbnail,
    duration_ms: c.result.duration_ms,
    rationale: composeRationale(c, profile),
    estimatedBytes: AVG_TRACK_BYTES,
    estimatedSizeReadable: formatBytes(AVG_TRACK_BYTES),
    priorityScore: c.score,
  };
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Builds up to `count` ranked download suggestions tailored to the user.
 *
 * Caches the full ranking so subsequent calls to `getReplacementSuggestion`
 * can return next-best picks without re-running the whole pipeline.
 */
export async function buildDownloadCandidates(
  count: number,
): Promise<DownloadSuggestion[]> {
  if (count <= 0) return [];

  const { ranked, profile } = await buildRanking();

  if (ranked.length === 0) {
    logger.warn('[IntelligentDownloader] No candidates after filtering.');
    _cache = { ranked: [], builtAt: Date.now() };
    return [];
  }

  // Mix exploit/explore over the *scored ranked* list.
  const picked = exploitExploreMix(ranked, count);

  const suggestions = picked.map((c) => toSuggestion(c, profile));

  // Cache the full ranked list (in suggestion form) for replacement requests.
  _cache = {
    ranked: ranked.map((c) => ({
      candidate: c,
      suggestion: toSuggestion(c, profile),
    })),
    builtAt: Date.now(),
  };

  return suggestions;
}

/**
 * Returns the next-best suggestion that the user has not already seen.
 *
 * `excludeVideoIds` should be every video currently rendered in the plan
 * (both already-shown picks and any prior replacements). Returns `null`
 * when there are no more candidates to swap in.
 *
 * Reuses the in-memory cache from the last `buildDownloadCandidates` call
 * when fresh; rebuilds the ranking otherwise.
 */
export async function getReplacementSuggestion(
  excludeVideoIds: string[],
): Promise<DownloadSuggestion | null> {
  const exclude = new Set(excludeVideoIds);

  const cacheFresh =
    _cache !== null && Date.now() - _cache.builtAt < CACHE_TTL_MS;

  let ranked: { candidate: ScoredCandidate; suggestion: DownloadSuggestion }[];
  if (cacheFresh && _cache) {
    ranked = _cache.ranked;
  } else {
    const built = await buildRanking();
    if (built.ranked.length === 0) return null;
    ranked = built.ranked.map((c) => ({
      candidate: c,
      suggestion: toSuggestion(c, built.profile),
    }));
    _cache = { ranked, builtAt: Date.now() };
  }

  for (const r of ranked) {
    if (!exclude.has(r.suggestion.videoId)) {
      return r.suggestion;
    }
  }
  return null;
}

/** Test-only: drop the in-memory cache so the next build runs fresh. */
export function _resetIntelligentDownloaderCache(): void {
  _cache = null;
}
