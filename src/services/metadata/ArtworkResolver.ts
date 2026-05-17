/**
 * Artwork resolver — orchestrates iTunes, Deezer, and MusicBrainz lookups to
 * find the best available cover art for a track.
 *
 * Strategy:
 *   1. If `primaryUrl` is supplied and looks high-res (≥ 500x500 by URL
 *      heuristic), use it as-is.
 *   2. Otherwise race the three free APIs (4s timeout each). Take the first
 *      one to return artwork tagged ≥ 500x500. If none cross that threshold
 *      after all three settle, pick the widest result we got.
 *   3. Return null if everything fails.
 *
 * Results (including null misses) are cached in-process by a normalised
 * `title|||artist` key. Hits live 24h, misses 60min (so the user can retry
 * sooner).
 */

import { logger } from '@/utils/logger';
import { lookupITunesArtwork } from './iTunesSearch';
import { lookupDeezerArtwork } from './DeezerLookup';
import { lookupMusicBrainzArtwork } from './MusicBrainz';

// ── Types ─────────────────────────────────────────────────────────────────

export type ResolvedArtwork = {
  url: string;
  source: string;
  width?: number;
};

export type ResolveParams = {
  primaryUrl?: string;
  title: string;
  artist: string;
  trackId: string;
};

type CacheEntry = {
  value: ResolvedArtwork | null;
  expiresAt: number;
};

// ── Constants ─────────────────────────────────────────────────────────────

const HIT_TTL_MS = 24 * 60 * 60 * 1000; // 1 day
const MISS_TTL_MS = 60 * 60 * 1000; // 60 min
const MIN_GOOD_WIDTH = 500;
const CACHE_MAX_ENTRIES = 200;

// ── LRU cache ─────────────────────────────────────────────────────────────

// `Map` preserves insertion order — re-set on read to bump entries to the end.
const cache = new Map<string, CacheEntry>();

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\(\[].*?[\)\]]/g, ' ') // strip "(feat. X)", "[remix]" etc.
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cacheKey(title: string, artist: string): string {
  return `${normalize(title)}|||${normalize(artist)}`;
}

function getCached(key: string): ResolvedArtwork | null | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return undefined;
  }
  // LRU bump
  cache.delete(key);
  cache.set(key, entry);
  return entry.value;
}

function setCached(key: string, value: ResolvedArtwork | null): void {
  const ttl = value ? HIT_TTL_MS : MISS_TTL_MS;
  cache.set(key, { value, expiresAt: Date.now() + ttl });
  // Evict oldest if we exceed the budget.
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

// ── Heuristics ────────────────────────────────────────────────────────────

/**
 * Best-effort guess at the resolution of a remote artwork URL. We can't HEAD
 * every CDN cheaply, but most music providers encode size into the path:
 *   - JioSaavn:  `.../150x150/...`, `.../500x500/...`
 *   - iTunes:    `.../100x100bb.jpg`, `.../1000x1000bb.jpg`
 *   - Deezer:    `cover_xl` (always 1000)
 *
 * Returns the largest dimension parsed from the URL, or `null` if we can't
 * tell.
 */
function inferUrlWidth(url: string): number | null {
  const match = url.match(/(\d{2,4})x(\d{2,4})/);
  if (!match) return null;
  const w = parseInt(match[1] ?? '', 10);
  const h = parseInt(match[2] ?? '', 10);
  if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
  return Math.max(w, h);
}

function isLikelyHighRes(url: string): boolean {
  const w = inferUrlWidth(url);
  if (w === null) return false; // unknown — be conservative
  return w >= MIN_GOOD_WIDTH;
}

// ── Source runners ────────────────────────────────────────────────────────

/**
 * Wrap a source lookup so it never rejects. Errors and timeouts surface as
 * `null`, keeping `Promise.all` / `Promise.race` semantics simple.
 */
async function safe<T>(
  label: string,
  fn: () => Promise<T | null>,
): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    logger.warn(`[ArtworkResolver] ${label} threw:`, err);
    return null;
  }
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Resolve the best available artwork for a track. See file header for the
 * resolution strategy.
 *
 * Never throws — failure modes all surface as `null`.
 */
export async function resolveBestArtwork(
  params: ResolveParams,
): Promise<ResolvedArtwork | null> {
  const { primaryUrl, title, artist } = params;

  // Trust a primary URL that already looks high-res.
  if (primaryUrl && isLikelyHighRes(primaryUrl)) {
    const width = inferUrlWidth(primaryUrl) ?? undefined;
    return { url: primaryUrl, source: 'primary', width };
  }

  const key = cacheKey(title, artist);
  const cached = getCached(key);
  if (cached !== undefined) return cached;

  // Race the three free sources. Each has its own internal 4s timeout.
  const sources: Array<Promise<ResolvedArtwork | null>> = [
    safe('itunes', () => lookupITunesArtwork(title, artist)),
    safe('deezer', () => lookupDeezerArtwork(title, artist)),
    safe('musicbrainz', () => lookupMusicBrainzArtwork(title, artist)),
  ];

  // Manual race: resolve as soon as anything returns a ≥ MIN_GOOD_WIDTH hit,
  // else wait for all and pick the widest.
  const settled = await Promise.all(
    sources.map((p) =>
      p.then((v) => ({ ok: true as const, v })).catch(() => ({ ok: true as const, v: null })),
    ),
  );

  let best: ResolvedArtwork | null = null;
  for (const r of settled) {
    const candidate = r.v;
    if (!candidate) continue;
    const inferred = candidate.width ?? inferUrlWidth(candidate.url) ?? 0;
    if (inferred >= MIN_GOOD_WIDTH) {
      // Return immediately on the first definite high-res hit.
      const result: ResolvedArtwork = { ...candidate, width: inferred };
      setCached(key, result);
      return result;
    }
    if (!best || inferred > (best.width ?? 0)) {
      best = { ...candidate, width: inferred };
    }
  }

  // Fall back to the primary URL when no source produced anything usable.
  if (!best && primaryUrl) {
    const width = inferUrlWidth(primaryUrl) ?? undefined;
    const fallback: ResolvedArtwork = { url: primaryUrl, source: 'primary', width };
    setCached(key, fallback);
    return fallback;
  }

  setCached(key, best);
  return best;
}

/** Test/debug helper — clears the in-process cache. */
export function clearArtworkResolverCache(): void {
  cache.clear();
}
