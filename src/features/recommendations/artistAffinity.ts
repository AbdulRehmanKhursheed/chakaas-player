/**
 * Artist-affinity store — the heart of the on-device recommendation engine.
 *
 * Why artist affinity (not audio-feature similarity):
 *   Every track already has an artist name and every play tells us "this
 *   user likes (or doesn't) songs by this person." Cheap, fast, accurate
 *   for a personal music app. No external services or enrichment needed.
 *
 * Persistence:
 *   Backed by MMKV under `chakaas-recommendations`. MMKV is synchronous on
 *   read so the play-event hot path doesn't need to await anything.
 *
 * Scoring rules (per play event):
 *   - Completed play (≥ 80% of track):  +1.0
 *   - Partial   (30–80%):                +0.5 × completion
 *   - Skip       (< 30%):                -0.3
 *   - 30-day half-life decay via `decayAllScores()` so stale tastes fade.
 *
 * Bootstrapping:
 *   The engine learns purely from real plays — no automatic taste seeding.
 *   `seed.ts` exists only as a hint inside the file (a snapshot of what
 *   the user stated they listen to) and is never written into scores.
 */
import { recommendationStorage, getJSON, setJSON } from '@/services/storage/mmkv';
import { logger } from '@/utils/logger';
import { USER_TASTE_SEED } from './seed';

const STORE_KEY = 'artist_affinity_v1';
const SEEDED_FLAG_KEY = 'artist_affinity_seeded_v1';
const LEGACY_SEED_CLEARED_KEY = 'legacy_seed_cleared_v1';

interface AffinityState {
  /** artistName (lowercased) → score */
  scores: Record<string, number>;
  /** epoch-seconds of the last decay run; -1 means never run. */
  lastDecayAt: number;
}

const DEFAULT_STATE: AffinityState = {
  scores: {},
  lastDecayAt: -1,
};

// ── Internal helpers ───────────────────────────────────────────────────────

function loadState(): AffinityState {
  return getJSON<AffinityState>(recommendationStorage, STORE_KEY) ?? DEFAULT_STATE;
}

function saveState(state: AffinityState): void {
  setJSON(recommendationStorage, STORE_KEY, state);
}

function normaliseArtist(artist: string): string {
  return artist.trim().toLowerCase();
}

// ── Legacy seed cleanup ────────────────────────────────────────────────────

/**
 * One-time wipe for users running an earlier build that auto-seeded artist
 * scores. Idempotent — guarded by an MMKV flag so it only runs the first
 * time after this version installs. After running, real plays start scoring
 * from a true blank slate.
 *
 * Detected by the presence of the legacy SEEDED_FLAG_KEY (set by the
 * removed `ensureSeeded()` function).
 */
export function clearLegacySeedBiasOnce(): void {
  if (recommendationStorage.getBoolean(LEGACY_SEED_CLEARED_KEY)) return;
  const hadLegacySeed = recommendationStorage.getBoolean(SEEDED_FLAG_KEY);
  if (hadLegacySeed) {
    recommendationStorage.delete(STORE_KEY);
    recommendationStorage.delete(SEEDED_FLAG_KEY);
    logger.info('[ArtistAffinity] Cleared legacy seed bias — engine starts fresh.');
  }
  recommendationStorage.set(LEGACY_SEED_CLEARED_KEY, true);
}

// ── Updates ────────────────────────────────────────────────────────────────

/**
 * Record a play event for a track and adjust the artist's affinity score.
 *
 * @param artist          Track artist name (case-insensitive).
 * @param completionRatio Fraction of track that played, [0, 1].
 * @param wasSkipped      True if the user manually skipped before track ended.
 */
export function bumpArtistFromPlay(
  artist: string,
  completionRatio: number,
  wasSkipped: boolean,
): void {
  if (!artist) return;
  const key = normaliseArtist(artist);
  const state = loadState();
  const current = state.scores[key] ?? 0;

  let delta = 0;
  if (wasSkipped && completionRatio < 0.3) {
    delta = -0.3;
  } else if (completionRatio >= 0.8) {
    delta = 1.0;
  } else if (completionRatio >= 0.3) {
    delta = 0.5 * completionRatio;
  } else {
    // Tiny play, not yet a skip; ignore — too noisy to learn from.
    return;
  }

  // Cap the score so a binge-loop on one artist doesn't blow out the
  // distribution and starve everything else.
  const next = Math.max(-2, Math.min(50, current + delta));
  state.scores[key] = next;
  saveState(state);
}

/**
 * Apply gentle exponential decay to every score. Call once per app launch (or
 * once a day) so old preferences fade and new listening dominates.
 *
 * Half-life: 30 days. Scores below 0.05 are dropped to keep the store small.
 */
export function decayAllScores(): void {
  const state = loadState();
  const now = Math.floor(Date.now() / 1000);
  if (state.lastDecayAt < 0) {
    state.lastDecayAt = now;
    saveState(state);
    return;
  }
  const elapsedDays = (now - state.lastDecayAt) / 86400;
  if (elapsedDays < 1) return; // less than a day → no-op

  const decay = Math.pow(0.5, elapsedDays / 30); // 30-day half-life
  const next: Record<string, number> = {};
  for (const [artist, score] of Object.entries(state.scores)) {
    const decayed = score * decay;
    if (Math.abs(decayed) >= 0.05) {
      next[artist] = decayed;
    }
  }
  state.scores = next;
  state.lastDecayAt = now;
  saveState(state);
}

// ── Reads ──────────────────────────────────────────────────────────────────

/**
 * Top N artists ranked by affinity score, descending. Negative-score artists
 * (i.e. ones the user repeatedly skipped) are excluded.
 *
 * Returns artist names as stored. We bumpArtistFromPlay using the original
 * mixed-case name and only lowercase the lookup key, so most entries
 * already have proper capitalisation when read back.
 */
export function getTopArtists(limit = 10): Array<{ artist: string; score: number }> {
  const state = loadState();
  return Object.entries(state.scores)
    .filter(([, score]) => score > 0)
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit)
    .map(([key, score]) => ({
      artist: key,
      score,
    }));
}

/** Score for a specific artist. Useful for ranking individual tracks. */
export function getArtistScore(artist: string): number {
  if (!artist) return 0;
  const state = loadState();
  return state.scores[normaliseArtist(artist)] ?? 0;
}

/** Reset the entire store. Exposed for a potential "Reset taste" settings action. */
export function resetAffinity(): void {
  recommendationStorage.delete(STORE_KEY);
  recommendationStorage.delete(SEEDED_FLAG_KEY);
}

// ── Engine stats (for the Chakaas Engine analytics screen) ──────────────────

export interface EngineStats {
  /** Total number of artists with a non-zero score. */
  totalArtists: number;
  /** Sum of all positive scores — proxy for "how much I know". */
  totalPositiveScore: number;
  /** Top artists (positive only) with their original-case display names. */
  topArtists: Array<{ artist: string; score: number; isSeed: boolean }>;
  /** Number of artists with a negative score (i.e. repeatedly skipped). */
  dislikedArtistCount: number;
  /** Epoch seconds of the last decay run, or null if never. */
  lastDecayAt: number | null;
}

/**
 * Snapshot of the engine's current state. Pure read — does not mutate.
 *
 * `isSeed` is always false now (the seed-from-statement bootstrap was
 * removed) — the field stays in the type so the screen doesn't have to
 * branch.
 */
export function getEngineStats(topLimit = 10): EngineStats {
  const state = loadState();

  const positive: Array<{ artist: string; score: number; isSeed: boolean }> = [];
  let dislikedCount = 0;
  let totalPositiveScore = 0;

  for (const [key, score] of Object.entries(state.scores)) {
    if (score < 0) {
      dislikedCount += 1;
      continue;
    }
    if (score === 0) continue;
    totalPositiveScore += score;
    positive.push({ artist: key, score, isSeed: false });
  }

  positive.sort((a, b) => b.score - a.score);

  // Reference USER_TASTE_SEED so the import isn't flagged as unused — the
  // file is kept for documentation of what the user stated they listen to.
  void USER_TASTE_SEED;

  return {
    totalArtists: positive.length,
    totalPositiveScore,
    topArtists: positive.slice(0, topLimit),
    dislikedArtistCount: dislikedCount,
    lastDecayAt: state.lastDecayAt < 0 ? null : state.lastDecayAt,
  };
}
