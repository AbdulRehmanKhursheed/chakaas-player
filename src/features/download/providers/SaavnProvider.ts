/**
 * SaavnProvider — JioSaavn search + stream-URL resolution.
 *
 * Why JioSaavn (Bloomee approach):
 *   - JioSaavn's catalog is *built* for Bollywood / Hindi. Coverage and
 *     metadata quality (album, artist, year, artwork) crush YouTube for this
 *     use case.
 *   - The CDN (`web.saavncdn.com`) is not anti-bot — a plain HTTPS GET with a
 *     `Referer: https://www.jiosaavn.com/` + desktop-style User-Agent returns
 *     the audio. No cipher, no po_token, no IP throttling. Verified 320 kbps
 *     `audio/mp4` comes back as a real M4A file.
 *
 * Why not the saavn.dev community wrapper:
 *   - `saavn.dev` is a community proxy that adds latency and a single point
 *     of failure. We hit JioSaavn's own `/api.php` directly, the same
 *     endpoints the official web player uses.
 */
import RNBlobUtil from 'react-native-blob-util';
import { logger } from '@/utils/logger';
import type { YouTubeSearchResult } from '@/types/track';
import type { AudioStreamInfo } from './types';

// ── Constants ────────────────────────────────────────────────────────────────

const JIOSAAVN_BASE = 'https://www.jiosaavn.com/api.php';

/**
 * The CDN signs URLs against the requesting User-Agent fingerprint plus
 * Referer. Both MUST match between the auth-token request and the audio GET,
 * otherwise the CDN returns `403 Access Denied`. Verified empirically against
 * `web.saavncdn.com` (Akamai-fronted).
 */
const COMMON_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://www.jiosaavn.com/',
  Origin: 'https://www.jiosaavn.com',
};

/**
 * Headers required when downloading from `web.saavncdn.com`. Identical to
 * COMMON_HEADERS so the User-Agent fingerprint is stable across the
 * auth-token request and the audio GET.
 */
export const SAAVN_DOWNLOAD_HEADERS: Record<string, string> = {
  ...COMMON_HEADERS,
};

// ── HTML-entity decoder ──────────────────────────────────────────────────────

/**
 * Saavn returns titles HTML-encoded (`&quot;`, `&amp;`, etc.). Decode them
 * before they reach the UI / DB. Only handles the entities Saavn actually
 * emits — full HTML entity coverage is overkill.
 */
function decodeEntities(input: string): string {
  if (!input) return '';
  return input
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

// ── Network helper ───────────────────────────────────────────────────────────

async function fetchJson<T = any>(url: string): Promise<T> {
  let response: Awaited<ReturnType<typeof RNBlobUtil.fetch>>;
  try {
    response = await RNBlobUtil.fetch('GET', url, COMMON_HEADERS);
  } catch (err) {
    // RNBlobUtil can throw at the native bridge for unresolvable DNS,
    // ECONNREFUSED, or invalid URLs. Re-tag with provider prefix so the
    // resolver chain logs are traceable.
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`[Saavn] network error: ${message}`);
  }
  const status = response.info().status;
  if (status < 200 || status >= 300) {
    throw new Error(`[Saavn] request returned HTTP ${status}`);
  }
  const raw = response.text();
  let text: string;
  try {
    text = typeof raw === 'string' ? raw : await (raw as Promise<string>);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`[Saavn] could not read response body: ${message}`);
  }
  if (!text || text.length === 0) {
    throw new Error('[Saavn] empty response body');
  }
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    // JioSaavn occasionally returns an HTML error page (Akamai block / WAF
    // challenge). Surface a clean message instead of letting JSON.parse
    // throw bare into the resolver — its catch path normalises this.
    const preview = text.slice(0, 80).replace(/\s+/g, ' ');
    throw new Error(`[Saavn] non-JSON response (first 80 chars: "${preview}"): ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── Search ───────────────────────────────────────────────────────────────────

interface SaavnSongRaw {
  id: string;
  title?: string;
  song?: string;
  subtitle?: string;
  type?: string;
  image?: string;
  more_info?: {
    encrypted_media_url?: string;
    '320kbps'?: string | boolean;
    duration?: string;
    album?: string;
    artistMap?: {
      primary_artists?: Array<{ id?: string; name?: string }>;
      featured_artists?: Array<{ id?: string; name?: string }>;
      artists?: Array<{ id?: string; name?: string }>;
    };
    primary_artists?: string;
    singers?: string;
  };
}

function pickArtist(raw: SaavnSongRaw): string {
  const primary = raw.more_info?.artistMap?.primary_artists ?? [];
  if (primary.length > 0 && primary[0]?.name) return decodeEntities(primary[0].name);
  if (raw.more_info?.primary_artists) return decodeEntities(raw.more_info.primary_artists);
  if (raw.more_info?.singers) return decodeEntities(raw.more_info.singers);
  if (raw.subtitle) return decodeEntities(raw.subtitle.split(' - ')[0] ?? raw.subtitle);
  return 'Unknown';
}

function upgradeImageQuality(url: string | undefined): string {
  if (!url) return '';
  // Saavn returns 50x50 by default. Replace with 500x500 for high-res artwork.
  return url.replace(/-\d+x\d+\.(jpg|png|jpeg|webp)/i, '-500x500.$1');
}

/**
 * Maps a raw JioSaavn song object into the shared `YouTubeSearchResult` shape.
 * Returns `null` for rows we can't use (no id, no title, or — crucially — no
 * `encrypted_media_url`, which the CDN won't serve). Shared by `searchSaavn`
 * and `getSaavnFreshTracks` so every Saavn row is built identically.
 */
function saavnRawToResult(raw: SaavnSongRaw): YouTubeSearchResult | null {
  const id = raw?.id;
  if (!id) return null;

  const title = decodeEntities(raw.title ?? raw.song ?? '').trim();
  if (!title) return null;

  // Skip songs the CDN won't serve — no point queuing them.
  if (!raw.more_info?.encrypted_media_url) return null;

  const artist = pickArtist(raw);
  const durationSec = Number.parseInt(raw.more_info?.duration ?? '0', 10);
  const durationMs =
    Number.isFinite(durationSec) && durationSec > 0 ? durationSec * 1000 : 0;

  const has320 =
    raw.more_info?.['320kbps'] === true || raw.more_info?.['320kbps'] === 'true';

  const album = decodeEntities(raw.more_info?.album ?? '');

  return {
    id,
    title,
    author: artist,
    duration_ms: durationMs,
    thumbnail: upgradeImageQuality(raw.image),
    // `view_count` is YouTube-only free-form metadata; the album lives in the
    // dedicated `saavnAlbum` field so the card can show "views for YouTube,
    // album for Saavn" deliberately instead of overloading one field.
    view_count: '',
    provider: 'saavn',
    saavnEncryptedUrl: raw.more_info?.encrypted_media_url ?? '',
    saavnHas320kbps: has320,
    saavnAlbum: album,
  };
}

/**
 * Searches JioSaavn for a query. Returns up to `limit` song results in the
 * shared `YouTubeSearchResult` shape (now provider-agnostic).
 *
 * The encrypted_media_url and 320kbps flag are captured here so the download
 * path can call `song.generateAuthToken` later without re-hitting search.
 */
export async function searchSaavn(
  query: string,
  limit = 15,
): Promise<YouTubeSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const params = new URLSearchParams({
    __call: 'search.getResults',
    _format: 'json',
    _marker: '0',
    api_version: '4',
    ctx: 'web6dot0',
    p: '1',
    n: String(limit),
    q: trimmed,
  });

  const url = `${JIOSAAVN_BASE}?${params.toString()}`;
  const data = await fetchJson<{ results?: SaavnSongRaw[] }>(url);

  // Defensive — the response shape from JioSaavn's unofficial endpoint has
  // changed in the past. Treat any non-object/missing `results` as "no hits"
  // rather than letting `.filter` throw on null.
  const rawResults = data && typeof data === 'object' && Array.isArray((data as any).results)
    ? (data.results as SaavnSongRaw[])
    : [];
  const songs = rawResults.filter((r) => r && r.type === 'song');
  const seen = new Set<string>();
  const results: YouTubeSearchResult[] = [];

  for (const raw of songs) {
    if (seen.has(raw.id)) continue;
    const mapped = saavnRawToResult(raw);
    if (!mapped) continue;
    seen.add(mapped.id);
    results.push(mapped);
    if (results.length >= limit) break;
  }

  return results;
}

// ── Fresh / trending tracks ───────────────────────────────────────────────────

/**
 * Recursively walks an arbitrary JioSaavn JSON payload and collects every
 * embedded song-shaped object (`type === 'song'` with an
 * `encrypted_media_url`). The trending / launch-data endpoints nest songs at
 * varying depths and key names across API versions, so a structural sweep is
 * far more robust than hard-coding a path that breaks on the next shape change.
 */
function collectSaavnSongs(node: unknown, out: SaavnSongRaw[], seen: Set<string>): void {
  if (!node || out.length >= 100) return;

  if (Array.isArray(node)) {
    for (const item of node) {
      collectSaavnSongs(item, out, seen);
      if (out.length >= 100) return;
    }
    return;
  }

  if (typeof node !== 'object') return;

  const record = node as Record<string, unknown>;
  if (
    record.type === 'song' &&
    typeof record.id === 'string' &&
    record.more_info &&
    typeof (record.more_info as any).encrypted_media_url === 'string' &&
    !seen.has(record.id)
  ) {
    seen.add(record.id);
    out.push(record as unknown as SaavnSongRaw);
  }

  for (const value of Object.values(record)) {
    if (value && typeof value === 'object') {
      collectSaavnSongs(value, out, seen);
      if (out.length >= 100) return;
    }
  }
}

/** Rotating set of popular Bollywood-leaning seed queries for the year-token fallback. */
const FRESH_FALLBACK_QUERIES = [
  'latest bollywood hits',
  'new hindi songs',
  'top punjabi songs',
  'trending bollywood',
  'new bollywood romantic',
];

/**
 * Returns FRESH / new-release / trending Bollywood-leaning tracks (NOT a
 * deterministic keyword search). Used by the recommendations engine.
 *
 * Strategy:
 *   1. Hit JioSaavn's own trending endpoint (`content.getTrending`, the same
 *      call the web player's home feed uses) and sweep songs out of the
 *      nested payload.
 *   2. If that yields nothing usable (endpoint shape change, WAF block, or
 *      trending entities lacking `encrypted_media_url`), fall back to
 *      year-token queries — a rotating set of popular seeds with the current
 *      year appended — so the result is still time-fresh-ish.
 *
 * Defensive by contract: NEVER throws. Returns `[]` on total failure. Rows use
 * the same `YouTubeSearchResult` shape as the rest of the pipeline, with
 * `provider: 'saavn'`.
 */
export async function getSaavnFreshTracks(
  opts: { limit?: number; page?: number } = {},
): Promise<YouTubeSearchResult[]> {
  const limit = Math.max(1, opts.limit ?? 20);
  const page = Math.max(1, opts.page ?? 1);

  // ── 1. Trending endpoint ──────────────────────────────────────────────────
  try {
    const params = new URLSearchParams({
      __call: 'content.getTrending',
      _format: 'json',
      _marker: '0',
      api_version: '4',
      ctx: 'web6dot0',
      entity_type: 'song',
      entity_language: 'hindi',
    });
    const data = await fetchJson<unknown>(`${JIOSAAVN_BASE}?${params.toString()}`);

    const rawSongs: SaavnSongRaw[] = [];
    collectSaavnSongs(data, rawSongs, new Set<string>());

    const results: YouTubeSearchResult[] = [];
    const seen = new Set<string>();
    for (const raw of rawSongs) {
      if (seen.has(raw.id)) continue;
      const mapped = saavnRawToResult(raw);
      if (!mapped) continue;
      seen.add(mapped.id);
      results.push(mapped);
      if (results.length >= limit) break;
    }

    if (results.length > 0) return results;
    logger.warn('[SaavnProvider] getSaavnFreshTracks: trending returned no usable songs, falling back to year-token queries');
  } catch (err) {
    logger.warn('[SaavnProvider] getSaavnFreshTracks: trending endpoint failed, falling back:', err);
  }

  // ── 2. Year-token fallback ─────────────────────────────────────────────────
  try {
    const year = new Date().getFullYear();
    // Rotate the seed by page so successive pages don't return the same list.
    const seed = FRESH_FALLBACK_QUERIES[(page - 1) % FRESH_FALLBACK_QUERIES.length];
    const rows = await searchSaavn(`${seed} ${year}`, limit);
    return rows.slice(0, limit);
  } catch (err) {
    logger.warn('[SaavnProvider] getSaavnFreshTracks: year-token fallback failed:', err);
    return [];
  }
}

// ── Stream URL resolution ────────────────────────────────────────────────────

interface AuthTokenResponse {
  auth_url?: string;
  type?: string;
  status?: string;
  bitrate?: string;
}

// ── In-process URL cache ────────────────────────────────────────────────────

/**
 * Saavn's signed CDN URLs are valid for ~6 hours. Within a single download
 * session (and especially during stream-URL refresh retries) we can avoid
 * the round-trip to `song.generateAuthToken` by remembering the previous
 * answer.
 *
 * TTL = 5 minutes — well below the real ~6h expiry, but enough of a safety
 * margin that we never serve a stale token, and small enough to keep memory
 * bounded across a long-running app session.
 */
interface CachedSaavnUrl {
  url: string;
  bitrate: number;
  has320kbps: boolean;
  fetchedAt: number;
}

const SAAVN_URL_CACHE_TTL_MS = 5 * 60 * 1000;
const _saavnUrlCache: Map<string, CachedSaavnUrl> = new Map();

/**
 * Clears the in-process Saavn stream-URL cache. Called once at the start of
 * each download pool run so a new session never serves a URL from a previous
 * session whose token could theoretically be on the verge of expiry.
 */
export function clearSaavnUrlCache(): void {
  _saavnUrlCache.clear();
}

/**
 * Resolves the encrypted media URL into a signed, downloadable HTTPS URL.
 *
 * The signed URL is valid for ~6 hours. Caller should download immediately.
 * If `has320kbps` is false on the source we fall back to 160 kbps (Saavn's
 * second-best tier — still generally better than YouTube's typical 128 kbps
 * Opus for vocal-heavy content).
 *
 * The signed URL for a given `(encryptedMediaUrl, has320kbps)` pair is cached
 * in-process for SAAVN_URL_CACHE_TTL_MS — repeated lookups within the TTL skip
 * the network entirely.
 */
export async function getSaavnStreamUrl(
  encryptedMediaUrl: string,
  has320kbps: boolean,
): Promise<AudioStreamInfo> {
  if (!encryptedMediaUrl) {
    throw new Error('Missing encrypted media URL — cannot resolve Saavn stream.');
  }

  const cacheKey = encryptedMediaUrl;
  const cached = _saavnUrlCache.get(cacheKey);
  const now = Date.now();
  if (cached) {
    const fresh = now - cached.fetchedAt < SAAVN_URL_CACHE_TTL_MS;
    if (fresh && cached.has320kbps === has320kbps) {
      return {
        url: cached.url,
        mimeType: 'audio/mp4',
        bitrate: cached.bitrate,
        container: 'm4a',
        needsTranscode: false,
        effectiveBitrate: cached.bitrate,
        durationMs: 0,
        requestHeaders: SAAVN_DOWNLOAD_HEADERS,
      };
    }
    // Stale OR quality-mismatch — evict so a failed refresh below doesn't
    // leave the map permanently bloated with dead entries. Without this the
    // map grew once per unique encryptedMediaUrl for the life of the JS
    // session, even after entries had aged out.
    if (!fresh) _saavnUrlCache.delete(cacheKey);
  }

  const bitrate = has320kbps ? '320' : '160';
  const params = new URLSearchParams({
    __call: 'song.generateAuthToken',
    _format: 'json',
    _marker: '0',
    ctx: 'web6dot0',
    api_version: '4',
    url: encryptedMediaUrl,
    bitrate,
  });

  const url = `${JIOSAAVN_BASE}?${params.toString()}`;
  const data = await fetchJson<AuthTokenResponse>(url);

  // Defensive — JioSaavn's unofficial API has changed shape before. Guard
  // against `data` being null / not an object / missing the expected fields
  // so we throw a clean, traceable error instead of dereferencing undefined.
  if (!data || typeof data !== 'object') {
    throw new Error('[Saavn] auth-token request returned non-object body');
  }
  if (!data.auth_url || typeof data.auth_url !== 'string') {
    throw new Error(
      `[Saavn] auth-token request missing auth_url (status: ${data.status ?? 'unknown'})`,
    );
  }
  if (data.status && data.status !== 'success') {
    throw new Error(`[Saavn] auth-token request failed (status: ${data.status})`);
  }

  const numericBitrate = Number.parseInt(bitrate, 10) * 1000;

  _saavnUrlCache.set(cacheKey, {
    url: data.auth_url,
    bitrate: numericBitrate,
    has320kbps,
    fetchedAt: now,
  });

  logger.info(
    `[SaavnProvider] Resolved stream — bitrate:${bitrate}k url-len:${data.auth_url.length}`,
  );

  return {
    url: data.auth_url,
    mimeType: 'audio/mp4',
    bitrate: numericBitrate,
    container: 'm4a',
    needsTranscode: false,
    effectiveBitrate: numericBitrate,
    durationMs: 0, // duration filled in by caller from search metadata
    requestHeaders: SAAVN_DOWNLOAD_HEADERS,
  };
}
