/**
 * SaavnMirrorsProvider — unofficial JioSaavn API mirrors used as a fallback
 * when the direct `www.jiosaavn.com/api.php` endpoint is unreachable or
 * rate-limited. Same surface as SaavnProvider so the resolver can swap them
 * transparently.
 *
 * Mirrors are tried in priority order; the first one that responds becomes
 * the cached preferred mirror for the rest of the session.
 *
 * NOTE: These are community-maintained — schema occasionally drifts. We
 * validate every field before access so a mirror returning a slightly
 * different shape just falls through to the next mirror instead of crashing.
 */
import { logger } from '@/utils/logger';
import { HttpError, httpGetJson } from '@/utils/http';
import type { YouTubeSearchResult } from '@/types/track';
import type { AudioStreamInfo } from './types';
import { SAAVN_DOWNLOAD_HEADERS } from './SaavnProvider';

interface MirrorConfig {
  /** Base URL — no trailing slash. */
  base: string;
  /** Mirror schema variant. */
  schema: 'saavn-dev' | 'privatecvc';
}

const MIRRORS: MirrorConfig[] = [
  { base: 'https://saavn.dev/api', schema: 'saavn-dev' },
  { base: 'https://jiosaavn-api-privatecvc2.vercel.app', schema: 'privatecvc' },
];

/** Index into MIRRORS for the last known healthy mirror in this session. */
let _preferredMirrorIndex: number | null = null;
const _failedMirrors = new Set<number>();
/** Wall-clock ms when each mirror was last marked failed — used to age entries out. */
const _failedAt = new Map<number, number>();
/** How long a "known-failed" mark sticks before we let the mirror be retried. */
const FAILURE_TTL_MS = 5 * 60 * 1000;

function markMirrorFailed(idx: number): void {
  _failedMirrors.add(idx);
  _failedAt.set(idx, Date.now());
}

/** Drop entries older than FAILURE_TTL_MS so transient outages self-heal. */
function expireOldFailures(): void {
  const now = Date.now();
  for (const [idx, ts] of _failedAt) {
    if (now - ts >= FAILURE_TTL_MS) {
      _failedAt.delete(idx);
      _failedMirrors.delete(idx);
    }
  }
}

function resetFailedMirrors(): void {
  _failedMirrors.clear();
  _failedAt.clear();
}

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

function upgradeImageQuality(url: string | undefined): string {
  if (!url) return '';
  return url.replace(/-\d+x\d+\.(jpg|png|jpeg|webp)/i, '-500x500.$1');
}

// ── Type guards for mirror responses ─────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

// ── saavn.dev schema ─────────────────────────────────────────────────────────

interface SaavnDevDownloadUrl {
  quality?: unknown;
  url?: unknown;
}

interface SaavnDevArtist {
  name?: unknown;
}

function mapSaavnDevSong(raw: unknown): YouTubeSearchResult | null {
  if (!isRecord(raw)) return null;
  const id = asString(raw.id);
  if (!id) return null;

  const title = decodeEntities(asString(raw.name) || asString(raw.title));
  if (!title) return null;

  // Artists
  let artist = '';
  const artists = isRecord(raw.artists) ? raw.artists : null;
  const primaryArtists = artists ? asArray((artists as Record<string, unknown>).primary) : [];
  if (primaryArtists.length > 0 && isRecord(primaryArtists[0])) {
    artist = asString((primaryArtists[0] as SaavnDevArtist).name);
  }
  if (!artist) artist = decodeEntities(asString(raw.primaryArtists)) || 'Unknown';

  // Image — array of { quality, url }
  let thumbnail = '';
  const imageArr = asArray(raw.image);
  for (const item of imageArr) {
    if (isRecord(item) && asString(item.url)) {
      thumbnail = asString(item.url);
    }
  }
  thumbnail = upgradeImageQuality(thumbnail);

  // Duration
  const durationRaw = raw.duration;
  const durationSec =
    typeof durationRaw === 'number'
      ? durationRaw
      : Number.parseInt(asString(durationRaw), 10);
  const durationMs =
    Number.isFinite(durationSec) && durationSec > 0 ? durationSec * 1000 : 0;

  // downloadUrl — array of { quality: '320kbps' | '160kbps' | ..., url }
  const downloadUrls = asArray(raw.downloadUrl);
  let has320 = false;
  let bestUrl = '';
  for (const item of downloadUrls) {
    if (!isRecord(item)) continue;
    const q = asString((item as SaavnDevDownloadUrl).quality);
    const u = asString((item as SaavnDevDownloadUrl).url);
    if (!u) continue;
    if (q === '320kbps') {
      has320 = true;
      bestUrl = u;
      break;
    }
    if (!bestUrl) bestUrl = u;
  }

  if (!bestUrl) return null;

  const album = isRecord(raw.album)
    ? decodeEntities(asString((raw.album as Record<string, unknown>).name))
    : '';

  return {
    id,
    title,
    author: decodeEntities(artist),
    duration_ms: durationMs,
    thumbnail,
    view_count: album,
    provider: 'saavn',
    // For saavn.dev mirrors we already have the direct media URL, so we
    // stash it in the same field. The resolver path branches on whether the
    // value looks like an encrypted blob or a direct URL.
    saavnEncryptedUrl: bestUrl,
    saavnHas320kbps: has320,
    saavnAlbum: album,
  };
}

// ── privatecvc schema (similar to saavn.dev) ─────────────────────────────────

function mapPrivateCvcSong(raw: unknown): YouTubeSearchResult | null {
  if (!isRecord(raw)) return null;
  const id = asString(raw.id);
  if (!id) return null;

  const title = decodeEntities(asString(raw.name) || asString(raw.song));
  if (!title) return null;

  const artist = decodeEntities(asString(raw.primaryArtists)) || 'Unknown';
  const thumbnail = upgradeImageQuality(asString(raw.image));

  const durationRaw = raw.duration;
  const durationSec =
    typeof durationRaw === 'number'
      ? durationRaw
      : Number.parseInt(asString(durationRaw), 10);
  const durationMs =
    Number.isFinite(durationSec) && durationSec > 0 ? durationSec * 1000 : 0;

  const downloadUrls = asArray(raw.downloadUrl);
  let has320 = false;
  let bestUrl = '';
  for (const item of downloadUrls) {
    if (!isRecord(item)) continue;
    const q = asString(item.quality);
    const u = asString(item.link) || asString(item.url);
    if (!u) continue;
    if (q.includes('320')) {
      has320 = true;
      bestUrl = u;
      break;
    }
    if (!bestUrl) bestUrl = u;
  }

  if (!bestUrl) return null;

  return {
    id,
    title,
    author: artist,
    duration_ms: durationMs,
    thumbnail,
    view_count: decodeEntities(asString(raw.album)),
    provider: 'saavn',
    saavnEncryptedUrl: bestUrl,
    saavnHas320kbps: has320,
    saavnAlbum: decodeEntities(asString(raw.album)),
  };
}

// ── Mirror helpers ───────────────────────────────────────────────────────────

function buildSearchUrl(mirror: MirrorConfig, query: string, limit: number): string {
  const q = encodeURIComponent(query);
  if (mirror.schema === 'saavn-dev') {
    return `${mirror.base}/search/songs?query=${q}&limit=${limit}`;
  }
  return `${mirror.base}/search/songs?query=${q}&limit=${limit}`;
}

function extractResults(mirror: MirrorConfig, data: unknown): unknown[] {
  if (!isRecord(data)) return [];
  if (mirror.schema === 'saavn-dev') {
    // Shape: { success, data: { results: [...] } } or { data: [...] }
    const inner = isRecord(data.data) ? data.data : data;
    const results = asArray((inner as Record<string, unknown>).results);
    if (results.length > 0) return results;
    return asArray((inner as Record<string, unknown>).data);
  }
  // privatecvc — { status, results: [...] }
  return asArray(data.results);
}

function mapSong(mirror: MirrorConfig, raw: unknown): YouTubeSearchResult | null {
  return mirror.schema === 'saavn-dev'
    ? mapSaavnDevSong(raw)
    : mapPrivateCvcSong(raw);
}

function orderedMirrors(): MirrorConfig[] {
  const order: MirrorConfig[] = [];
  if (_preferredMirrorIndex !== null && !_failedMirrors.has(_preferredMirrorIndex)) {
    const pref = MIRRORS[_preferredMirrorIndex];
    if (pref) order.push(pref);
  }
  for (let i = 0; i < MIRRORS.length; i += 1) {
    if (_failedMirrors.has(i)) continue;
    if (i === _preferredMirrorIndex) continue;
    order.push(MIRRORS[i]);
  }
  return order;
}

// ── Public surface ──────────────────────────────────────────────────────────

export interface SaavnMirrorSearchResult extends YouTubeSearchResult {
  /** True when the URL embedded in `saavnEncryptedUrl` is already a direct media URL. */
  saavnDirectMediaUrl?: boolean;
}

/**
 * Searches Saavn via the mirror chain. Returns up to `limit` songs. Each
 * mirror is bounded by the underlying httpGetJson timeout.
 *
 * Note: mirror responses give us a *direct* media URL rather than an
 * encrypted blob — we still stash it in `saavnEncryptedUrl` so the existing
 * call-site shape matches, and flag it via `saavnDirectMediaUrl` so the
 * resolver knows to skip the `song.generateAuthToken` step.
 */
export async function searchSaavnMirrors(
  query: string,
  limit = 15,
): Promise<SaavnMirrorSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  // Age out any stale failure marks before we decide which mirrors to skip.
  expireOldFailures();

  let lastError: unknown = null;

  for (let i = 0; i < MIRRORS.length; i += 1) {
    const order = orderedMirrors();
    if (order.length === 0) break;
    const mirror = order[0];
    const idx = MIRRORS.indexOf(mirror);

    try {
      const url = buildSearchUrl(mirror, trimmed, limit);
      const data = await httpGetJson<unknown>(url, { timeoutMs: 7000 });
      const rawResults = extractResults(mirror, data);

      const out: SaavnMirrorSearchResult[] = [];
      const seen = new Set<string>();
      for (const raw of rawResults) {
        const mapped = mapSong(mirror, raw);
        if (!mapped || seen.has(mapped.id)) continue;
        seen.add(mapped.id);
        out.push({ ...mapped, saavnDirectMediaUrl: true });
        if (out.length >= limit) break;
      }

      if (out.length > 0) {
        _preferredMirrorIndex = idx;
        return out;
      }
      // Mirror responded but empty — try next.
      markMirrorFailed(idx);
    } catch (err) {
      lastError = err;
      markMirrorFailed(idx);
      const status = err instanceof HttpError ? err.status : undefined;
      logger.warn(
        `[SaavnMirrors] mirror "${mirror.base}" failed${status ? ` (HTTP ${status})` : ''}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      // Reset failed set if all mirrors have been marked as failed.
      if (_failedMirrors.size >= MIRRORS.length) {
        break;
      }
    }
  }

  // If we exhausted every mirror, reset the failure tracking so the very next
  // call can retry from scratch — without this, one bad network minute kills
  // the provider for the rest of the JS session.
  if (_failedMirrors.size >= MIRRORS.length) {
    resetFailedMirrors();
  }

  if (lastError) throw lastError instanceof Error ? lastError : new Error('All Saavn mirrors failed');
  return [];
}

/**
 * Mirrors return direct media URLs from search, so "stream resolution" is a
 * no-op — we just wrap the URL into the canonical AudioStreamInfo shape.
 * `directMediaUrl` is what `searchSaavnMirrors` placed into the search row.
 */
export async function getSaavnMirrorStreamUrl(
  directMediaUrl: string,
  has320kbps: boolean,
): Promise<AudioStreamInfo> {
  if (!directMediaUrl || !/^https?:\/\//i.test(directMediaUrl)) {
    throw new Error('SaavnMirrors: invalid direct media URL');
  }

  const bitrate = (has320kbps ? 320 : 160) * 1000;
  return {
    url: directMediaUrl,
    mimeType: 'audio/mp4',
    bitrate,
    container: 'm4a',
    needsTranscode: false,
    effectiveBitrate: bitrate,
    durationMs: 0,
    requestHeaders: SAAVN_DOWNLOAD_HEADERS,
    source: 'saavn-mirror',
  };
}
