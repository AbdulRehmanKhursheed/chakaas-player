/**
 * discoverEngine — surface ranked Saavn suggestions tailored to the user.
 *
 * Pipeline:
 *   1. Compose a candidate set from two sources:
 *        a) `getTopArtists(20)` — learned + seeded artist preferences. We
 *           rotate a subset of 6 artists per refresh based on `rotationSeed`
 *           so the same top-N doesn't dominate every tap.
 *        b) `USER_TASTE_SEED.moodQueries` — ~30 curated text queries; we
 *           rotate 8 per refresh.
 *   2. For each query we fetch `PER_QUERY_FETCH` results and offset into the
 *      list by `rotationSeed % 8`, tapping deeper into Saavn's ranking on
 *      successive refreshes.
 *   3. Filter out:
 *        - anything already in the local library (saavn id + title/artist fp)
 *        - anything in the persistent skip memory (`skipMemory.ts`)
 *   4. Score each candidate as
 *           (artist affinity score) + (saavn_play_count_log_normalised)
 *      and sort descending.
 *   5. When `rotationSeed > 0`, sample from the top `limit * 4` using a
 *      seeded PRNG so the same nonce produces the same list (good for
 *      tab-switching / cache hits) but a new nonce yields a fresh sample.
 */
import { searchSaavn } from '@/features/download/providers/SaavnProvider';
import { Q } from '@nozbe/watermelondb';
import { tracksCollection } from '@/db';
import { logger } from '@/utils/logger';
import type { YouTubeSearchResult } from '@/types/track';
import { USER_TASTE_SEED } from './seed';
import { getTopArtists, getArtistScore } from './artistAffinity';
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
const RECENCY_BIAS_YEARS = 5;

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

// ── Popularity normalisation ───────────────────────────────────────────────

function popularityScore(playCountStr: string | undefined): number {
  if (!playCountStr) return 0;
  const n = Number.parseInt(playCountStr, 10);
  if (!Number.isFinite(n) || n <= 0) return 0;
  // Log-normalise: 1k plays → ~0.4, 1M → 1.0, 100M → 1.6.
  return Math.log10(n) / 6;
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

  // Pull a wider pool, then rotate. PER_QUERY_FETCH is large so we also have
  // a deeper slice to offset into. The previous double-mod (`% PER_QUERY_FETCH
  // … % 8`) was equivalent to a single `% 8` because `PER_QUERY_FETCH > 8`,
  // so collapse it to one operation for clarity.
  const resultOffset = Math.abs(seed) % 8;

  // ── Source A: top artists (rotated subset of top-N) ───────────────────
  // Fire all artist + mood searches in parallel. Serial would multiply
  // network latency by ~14 (6 artists + 8 mood queries); on a 200ms RTT
  // that's ~2.8s vs. ~250ms parallel.
  const allArtists = getTopArtists(ARTIST_POOL);
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
    // Offset into the result list so successive refreshes peek deeper into
    // Saavn's ranking instead of always grabbing the same top items.
    const rotated = settled.value.slice(resultOffset).concat(settled.value.slice(0, resultOffset));
    for (const r of rotated) {
      if (shouldReject(r)) continue;
      seen.add(r.id);

      const popularity = popularityScore(undefined); // search results don't carry play_count; rely on Saavn ranking
      collected.push({
        ...r,
        score: artistScore + popularity,
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
      `seed=${seed}, artists=${chosenArtists.length}/${allArtists.length}, ` +
      `moods=${moodQueries.length}/${USER_TASTE_SEED.moodQueries.length}, ` +
      `library de-dupe ${fingerprints.saavnIds.size + fingerprints.titleArtist.size} keys, ` +
      `skipMemory size ${skippedKeys.size})`,
  );

  // Touch the recency bias var so unused-import lint stays quiet — we keep
  // the constant in case the next iteration uses it for year-of-release
  // weighting.
  void RECENCY_BIAS_YEARS;

  return out;
}
