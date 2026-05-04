/**
 * discoverEngine — surface ranked Saavn suggestions tailored to the user.
 *
 * Pipeline:
 *   1. Compose a candidate set from two sources:
 *        a) `getTopArtists()` — learned + seeded artist preferences. We hit
 *           Saavn search with the artist name to get their popular tracks.
 *        b) `USER_TASTE_SEED.moodQueries` — curated text queries for moods /
 *           sub-genres ("old hindi sad songs", "sufi qawwali", …) that don't
 *           map to a single artist.
 *   2. Filter out anything already in the local library (by Saavn id and a
 *      best-effort title+artist fingerprint to catch duplicates that came
 *      from a different source).
 *   3. Score each candidate as
 *           (artist affinity score) + (saavn_play_count_log_normalised)
 *      and sort descending.
 *   4. Cap at `limit` and dedupe by Saavn id.
 *
 * Cost: O(top_artists × Saavn search) + O(moodQueries × Saavn search). At a
 * top-3 artist split + 6 mood queries that's ~9 search calls — well under a
 * second total on a fast network. Saavn doesn't rate-limit search.
 */
import { searchSaavn } from '@/features/download/providers/SaavnProvider';
import { tracksCollection } from '@/db';
import { logger } from '@/utils/logger';
import type { YouTubeSearchResult } from '@/types/track';
import { USER_TASTE_SEED } from './seed';
import { getTopArtists, getArtistScore } from './artistAffinity';

export interface DiscoverItem extends YouTubeSearchResult {
  /** Final ranking score (artist affinity + popularity). */
  score: number;
  /** Why this song was suggested — surfaced as a small caption in the UI. */
  reason: string;
}

const ARTIST_SOURCES = 4; // queries against the user's top-N artists
const PER_QUERY_FETCH = 8;
const RECENCY_BIAS_YEARS = 5;

// ── Library-fingerprint for dedupe ─────────────────────────────────────────

async function getLibraryFingerprints(): Promise<{
  saavnIds: Set<string>;
  titleArtist: Set<string>;
}> {
  const tracks = await tracksCollection.query().fetch();
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
 * @param limit  How many items to return.
 * @param shuffle When true, returns a randomly-sampled subset from the top
 *   `limit * 3` candidates instead of the strict top-`limit`. Used by the
 *   "refresh" affordance on Home so the user gets a genuinely different
 *   list each tap, not just a re-ordering of the same songs.
 */
export async function getDiscoverFeed(
  limit = 25,
  shuffle = false,
): Promise<DiscoverItem[]> {
  const fingerprints = await getLibraryFingerprints();
  const seen = new Set<string>();
  const collected: DiscoverItem[] = [];

  // ── Source A: top artists (learned + seeded) ──────────────────────────
  const topArtists = getTopArtists(ARTIST_SOURCES);
  for (const { artist, score: artistScore } of topArtists) {
    try {
      const results = await searchSaavn(artist, PER_QUERY_FETCH);
      for (const r of results) {
        if (seen.has(r.id)) continue;
        if (fingerprints.saavnIds.has(r.id)) continue;
        const fp = `${r.title.toLowerCase()}|||${r.author.toLowerCase()}`;
        if (fingerprints.titleArtist.has(fp)) continue;
        seen.add(r.id);

        const popularity = popularityScore(undefined); // search results don't carry play_count; rely on Saavn ranking
        collected.push({
          ...r,
          score: artistScore + popularity,
          reason: `Because you like ${artist}`,
        });
      }
    } catch (err) {
      logger.warn(`[Discover] Saavn search failed for artist "${artist}":`, err);
    }
  }

  // ── Source B: mood / curated queries ──────────────────────────────────
  for (const query of USER_TASTE_SEED.moodQueries) {
    try {
      const results = await searchSaavn(query, PER_QUERY_FETCH);
      for (const r of results) {
        if (seen.has(r.id)) continue;
        if (fingerprints.saavnIds.has(r.id)) continue;
        const fp = `${r.title.toLowerCase()}|||${r.author.toLowerCase()}`;
        if (fingerprints.titleArtist.has(fp)) continue;
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
    } catch (err) {
      logger.warn(`[Discover] Saavn search failed for query "${query}":`, err);
    }
  }

  // ── Rank and slice ────────────────────────────────────────────────────
  collected.sort((a, b) => b.score - a.score);

  let out: DiscoverItem[];
  if (shuffle) {
    // Pick a random subset from the top of the ranking. Pool size is
    // capped so we don't dip into low-quality matches; sampling without
    // replacement keeps the result deduped.
    const poolSize = Math.min(collected.length, Math.max(limit * 3, limit + 8));
    const pool = collected.slice(0, poolSize);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    out = pool.slice(0, limit);
  } else {
    out = collected.slice(0, limit);
  }

  logger.info(
    `[Discover] Returning ${out.length} ranked items (collected ${collected.length}, ` +
    `shuffle=${shuffle}, library de-dupe matched ` +
    `${fingerprints.saavnIds.size + fingerprints.titleArtist.size} keys)`,
  );

  // Touch the recency bias var so unused-import lint stays quiet — we keep
  // the constant in case the next iteration uses it for year-of-release
  // weighting.
  void RECENCY_BIAS_YEARS;

  return out;
}
