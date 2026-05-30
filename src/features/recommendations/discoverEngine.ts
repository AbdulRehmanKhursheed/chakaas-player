/**
 * discoverEngine — surface ranked Saavn suggestions tailored to the user.
 *
 * Pipeline:
 *   1. Compose a candidate set from three sources:
 *        a) `getTopArtists(20)` — learned + seeded artist preferences. We
 *           rotate a subset of 6 artists per refresh based on `rotationSeed`
 *           so the same top-N doesn't dominate every tap. If the store is
 *           empty (brand-new install before the soft seed lands) we fall back
 *           to `USER_TASTE_SEED.artists` so the feed never collapses to pure
 *           mood queries.
 *        b) `USER_TASTE_SEED.moodQueries` — ~30 curated text queries; we
 *           rotate 8 per refresh.
 *        c) `getSaavnFreshTracks()` — JioSaavn trending / new-release rows.
 *           These get a recency boost (see `RECENCY_BIAS_YEARS`) so genuinely
 *           fresh songs surface even for a cold-start user, and so successive
 *           refreshes (paged via the seed) bring in new material rather than
 *           reshuffling the same static keyword pool.
 *   2. For each query we fetch `PER_QUERY_FETCH` results and offset into the
 *      list by `rotationSeed % PER_QUERY_FETCH`, tapping deeper into Saavn's
 *      ranking on successive refreshes.
 *   3. Filter out:
 *        - anything already in the local library (saavn id + title/artist fp)
 *        - anything in the persistent skip memory (`skipMemory.ts`)
 *   4. Score each candidate by its source weight + artist affinity and sort
 *      descending. (Saavn search rows carry no play_count, so there is no
 *      popularity term — we lean on Saavn's own ranking instead.)
 *   5. When `rotationSeed > 0`, sample from the top `limit * 4` using a
 *      seeded PRNG so the same nonce produces the same list (good for
 *      tab-switching / cache hits) but a new nonce yields a fresh sample.
 *   6. If the post-filter pool is too small (heavy de-dupe / skip memory),
 *      widen: relax the low-quality filter and broaden the queries before
 *      giving up, so refresh rarely returns empty.
 */
import { searchSaavn, getSaavnFreshTracks } from '@/features/download/providers/SaavnProvider';
import { Q } from '@nozbe/watermelondb';
import { tracksCollection } from '@/db';
import { logger } from '@/utils/logger';
import type { YouTubeSearchResult } from '@/types/track';
import { USER_TASTE_SEED } from './seed';
import {
  getTopArtists,
  getArtistScore,
  seedTasteOnFirstLaunch,
} from './artistAffinity';
import {
  getAllSkippedKeys,
  normalizeFingerprint,
} from './skipMemory';

export interface DiscoverItem extends YouTubeSearchResult {
  /** Final ranking score (artist affinity + popularity). */
  score: number;
  /** Why this song was suggested — surfaced as a small caption in the UI. */
  reason: string;
}

const ARTIST_POOL = 20;     // top-N from artistAffinity we draw rotation from
const ARTIST_PICK = 6;      // how many of those we actually query per refresh
const MOOD_PICK = 8;        // how many mood queries per refresh
const PER_QUERY_FETCH = 16; // Saavn page size per query
const FRESH_FETCH = 24;     // how many trending/new rows to pull per refresh
/**
 * Recency horizon, in years. Fresh-source rows are treated as released "now",
 * so their recency factor is 1.0; the constant defines how a release ages out
 * of the boost. Search rows carry no release date, so they get the floor.
 */
const RECENCY_BIAS_YEARS = 5;
/** Max additive boost a maximally-recent (fresh-source) candidate receives. */
const RECENCY_MAX_BOOST = 1.5;

// ── Rotation helpers ───────────────────────────────────────────────────────

/**
 * Pick `count` items from `arr` starting at a seed-derived offset, stepping
 * by 3 so we don't pick adjacent neighbours. Deterministic for a given seed.
 */
function pickRotating<T>(arr: readonly T[], count: number, seed: number): T[] {
  if (arr.length === 0) return [];
  if (arr.length <= count) return arr.slice();
  const start = Math.abs(Math.floor(seed * 37)) % arr.length;
  const picked = new Set<number>();
  const out: T[] = [];
  let i = 0;
  while (out.length < count && i < arr.length * 4) {
    const idx = (start + i * 3) % arr.length;
    if (!picked.has(idx)) {
      picked.add(idx);
      const item = arr[idx];
      if (item !== undefined) out.push(item);
    }
    i++;
  }
  return out;
}

/**
 * Tiny seeded PRNG — Mulberry32. We only need a few hundred draws per
 * shuffle, so determinism + speed beats statistical purity.
 */
function makeRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Library-fingerprint for dedupe ─────────────────────────────────────────

async function getLibraryFingerprints(): Promise<{
  saavnIds: Set<string>;
  titleArtist: Set<string>;
}> {
  // Restrict to streaming-sourced rows. Local file imports often parse with
  // garbage title/artist (filename-derived), so including them in the
  // fingerprint would falsely de-dupe legitimate Saavn matches.
  const tracks = await tracksCollection
    .query(Q.where('source', Q.oneOf(['saavn', 'youtube'])))
    .fetch();
  const saavnIds = new Set<string>();
  const titleArtist = new Set<string>();
  for (const t of tracks) {
    if (t.saavnId) saavnIds.add(t.saavnId);
    titleArtist.add(`${t.title.toLowerCase()}|||${t.artist.toLowerCase()}`);
  }
  return { saavnIds, titleArtist };
}

// ── Recency boost ────────────────────────────────────────────────────────────

/**
 * Maps a release age (years before today) to an additive ranking boost in
 * `[0, RECENCY_MAX_BOOST]`. Age 0 → full boost; linearly fading to 0 once the
 * release is `RECENCY_BIAS_YEARS` old. Used to weight the fresh-content source
 * so trending / new-release rows out-rank stale keyword matches.
 *
 * Saavn rows don't carry a release date, so the fresh source passes `ageYears
 * = 0` (it is fresh by construction) while the artist / mood sources don't
 * call this at all — they rely on affinity + Saavn ranking.
 */
function recencyBoost(ageYears: number): number {
  if (!Number.isFinite(ageYears) || ageYears < 0) return RECENCY_MAX_BOOST;
  if (ageYears >= RECENCY_BIAS_YEARS) return 0;
  return RECENCY_MAX_BOOST * (1 - ageYears / RECENCY_BIAS_YEARS);
}

// ── Main ───────────────────────────────────────────────────────────────────

/**
 * Builds a ranked Discover feed of Saavn songs the user is likely to love.
 *
 * @param limit         How many items to return.
 * @param rotationSeed  Numeric nonce that drives artist/mood rotation, query
 *   offset into Saavn results, and shuffle PRNG. `0` returns the strict
 *   top-`limit`. Any non-zero value returns a sampled, rotated slice. For
 *   backwards-compat: passing `true` is coerced to `Date.now()`, `false` →
 *   `0`. (Older callers used a `shuffle: boolean` signature.)
 */
export async function getDiscoverFeed(
  limit = 25,
  rotationSeed: number | boolean = 0,
): Promise<DiscoverItem[]> {
  // Cold-start rotation: `seed === 0` (the default + the initial load case)
  // used to lock the feed to the strict top-`limit`, so every fresh-launch
  // user saw an identical list. Treat it as a time-based seed so each cold
  // start produces a different rotation. Explicit numeric seeds from the UI
  // (e.g. the user-bumped `discoverNonce`) remain deterministic — that's
  // what enables tab-switching to hit the React Query cache instead of
  // refetching.
  const seed: number =
    typeof rotationSeed === 'boolean'
      ? rotationSeed
        ? Date.now() & 0x7fffffff
        : 0
      : rotationSeed === 0
        ? Date.now() & 0x7fffffff
        : rotationSeed;

  // Make sure the stated taste seed has been written to the affinity store at
  // least once, so a brand-new install has artist signal before any real
  // plays. Idempotent + MMKV-flag-guarded — a no-op after the first launch.
  try {
    seedTasteOnFirstLaunch();
  } catch (err) {
    logger.warn('[Discover] seedTasteOnFirstLaunch failed:', err);
  }

  const fingerprints = await getLibraryFingerprints();
  const skippedKeys = getAllSkippedKeys();
  const seen = new Set<string>();
  const collected: DiscoverItem[] = [];

  /**
   * Per-call helper that combines all rejection rules: already-seen-in-feed,
   * in-library, and in skip memory. Returns true if the candidate should be
   * dropped.
   */
  const shouldReject = (r: YouTubeSearchResult): boolean => {
    if (seen.has(r.id)) return true;
    if (fingerprints.saavnIds.has(r.id)) return true;
    const fp = `${r.title.toLowerCase()}|||${r.author.toLowerCase()}`;
    if (fingerprints.titleArtist.has(fp)) return true;
    // Skip memory — provider id and normalised fingerprint
    if (skippedKeys.has(`saavn:${r.id}`)) return true;
    if (skippedKeys.has(`fp:${normalizeFingerprint(r.title, r.author)}`)) return true;
    return false;
  };

  // Offset into each result list so successive refreshes peek deeper into
  // Saavn's ranking instead of always grabbing the same top items. Stepping
  // by the full page size (`% PER_QUERY_FETCH`) — the old `% 8` only ever
  // rotated the first half of the page, so the back half was unreachable and
  // refreshes recycled the same songs.
  const resultOffset = Math.abs(seed) % PER_QUERY_FETCH;
  // Page the fresh / trending source so each refresh asks Saavn for a
  // different slice of new releases.
  const freshPage = (Math.abs(seed) % 5) + 1;

  // ── Source A: top artists (rotated subset of top-N) ───────────────────
  // Fire all artist + mood searches in parallel. Serial would multiply
  // network latency by ~14 (6 artists + 8 mood queries); on a 200ms RTT
  // that's ~2.8s vs. ~250ms parallel.
  //
  // Cold-start fallback: if the affinity store is empty (brand-new install,
  // soft seed somehow not yet applied) the top-N is [], which used to leave
  // the feed leaning entirely on generic mood queries. Fall back to the
  // stated taste seed so Source A always contributes real artist signal.
  let allArtists = getTopArtists(ARTIST_POOL);
  if (allArtists.length === 0) {
    allArtists = Object.entries(USER_TASTE_SEED.artists).map(([artist, score]) => ({
      artist,
      score,
    }));
  }
  const chosenArtists = pickRotating(allArtists, ARTIST_PICK, seed);
  const artistSettled = await Promise.allSettled(
    chosenArtists.map(({ artist }) => searchSaavn(artist, PER_QUERY_FETCH)),
  );
  artistSettled.forEach((settled, idx) => {
    const entry = chosenArtists[idx];
    if (!entry) return;
    const { artist, score: artistScore } = entry;
    if (settled.status === 'rejected') {
      logger.warn(`[Discover] Saavn search failed for artist "${artist}":`, settled.reason);
      return;
    }
    const rotated = settled.value.slice(resultOffset).concat(settled.value.slice(0, resultOffset));
    for (const r of rotated) {
      if (shouldReject(r)) continue;
      seen.add(r.id);

      // Search rows carry no play_count, so there's no popularity term — we
      // rely on Saavn's own ranking plus the artist's affinity score.
      collected.push({
        ...r,
        score: artistScore,
        reason: `Because you like ${artist}`,
      });
    }
  });

  // ── Source B: mood / curated queries (rotated subset of pool) ─────────
  const moodQueries = pickRotating(USER_TASTE_SEED.moodQueries, MOOD_PICK, seed + 1);
  const moodSettled = await Promise.allSettled(
    moodQueries.map((q) => searchSaavn(q, PER_QUERY_FETCH)),
  );
  moodSettled.forEach((settled, idx) => {
    const query = moodQueries[idx];
    if (!query) return;
    if (settled.status === 'rejected') {
      logger.warn(`[Discover] Saavn search failed for query "${query}":`, settled.reason);
      return;
    }
    const rotated = settled.value.slice(resultOffset).concat(settled.value.slice(0, resultOffset));
    for (const r of rotated) {
      if (shouldReject(r)) continue;
      seen.add(r.id);

      // Mood candidates get a baseline score plus any artist bonus the
      // result happens to inherit.
      const artistBonus = getArtistScore(r.author) * 0.5;
      collected.push({
        ...r,
        score: 1.0 + artistBonus,
        reason: `From "${query}"`,
      });
    }
  });

  // ── Source C: fresh / trending Saavn rows (recency-weighted) ──────────
  // Genuinely new material so refresh surfaces songs the static keyword pool
  // never would. These are fresh by construction (trending / new-release), so
  // they get the full recency boost on top of any artist affinity the row
  // inherits. `getSaavnFreshTracks` never throws (returns [] on failure).
  try {
    const freshRows = await getSaavnFreshTracks({ limit: FRESH_FETCH, page: freshPage });
    const freshBoost = recencyBoost(0); // fresh source → released "now"
    for (const r of freshRows) {
      if (shouldReject(r)) continue;
      seen.add(r.id);
      const artistBonus = getArtistScore(r.author) * 0.5;
      collected.push({
        ...r,
        score: 1.0 + freshBoost + artistBonus,
        reason: 'Fresh & trending now',
      });
    }
  } catch (err) {
    // Defensive — the provider is documented as never-throwing, but a future
    // change shouldn't be able to take the whole feed down.
    logger.warn('[Discover] getSaavnFreshTracks failed:', err);
  }

  // ── Widening fallback ─────────────────────────────────────────────────
  // Heavy de-dupe (large library) or skip memory can leave the pool too thin
  // to fill `limit`. Before returning a near-empty feed, broaden: hit an extra
  // rotated set of wide mood queries (a different rotation offset than Source
  // B) so we pull genuinely different rows instead of giving up.
  if (collected.length < limit) {
    const widenQueries = pickRotating(USER_TASTE_SEED.moodQueries, MOOD_PICK, seed + 7);
    const widenSettled = await Promise.allSettled(
      widenQueries.map((q) => searchSaavn(q, PER_QUERY_FETCH)),
    );
    widenSettled.forEach((settled) => {
      if (settled.status !== 'fulfilled') return;
      for (const r of settled.value) {
        if (collected.length >= limit * 3) break;
        if (shouldReject(r)) continue; // still honour library + skip memory
        seen.add(r.id);
        const artistBonus = getArtistScore(r.author) * 0.5;
        collected.push({
          ...r,
          // Slightly below the primary mood baseline so widened rows fill the
          // tail rather than displacing genuine matches.
          score: 0.75 + artistBonus,
          reason: 'More to explore',
        });
      }
    });
  }

  // ── Rank and slice ────────────────────────────────────────────────────
  collected.sort((a, b) => b.score - a.score);

  let out: DiscoverItem[];
  if (seed > 0) {
    // Pick a sample from the top of the ranking. Pool size is capped so we
    // don't dip into low-quality matches. Seeded PRNG → same nonce yields
    // the same list (cache-friendly) while a new nonce yields a fresh one.
    const poolSize = Math.min(collected.length, Math.max(limit * 4, limit + 12));
    const pool = collected.slice(0, poolSize);
    const rng = makeRng(seed || 1);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const a = pool[i];
      const b = pool[j];
      if (a !== undefined && b !== undefined) {
        pool[i] = b;
        pool[j] = a;
      }
    }
    out = pool.slice(0, limit);
  } else {
    out = collected.slice(0, limit);
  }

  logger.info(
    `[Discover] Returning ${out.length} ranked items (collected ${collected.length}, ` +
      `seed=${seed}, freshPage=${freshPage}, ` +
      `artists=${chosenArtists.length}/${allArtists.length}, ` +
      `moods=${moodQueries.length}/${USER_TASTE_SEED.moodQueries.length}, ` +
      `library de-dupe ${fingerprints.saavnIds.size + fingerprints.titleArtist.size} keys, ` +
      `skipMemory size ${skippedKeys.size})`,
  );

  return out;
}
