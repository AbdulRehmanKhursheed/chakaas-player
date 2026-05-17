/**
 * AudiusProvider — decentralized music network. Audius exposes a fully
 * public discovery API; the official client library is just a thin wrapper
 * over these endpoints.
 *
 * Endpoints:
 *   GET /v1/tracks/search?query=<q>&app_name=Chakaas   → tracks[]
 *   GET /v1/tracks/<id>/stream                          → 302 redirect to mp3
 *
 * The `/stream` endpoint redirects to a signed URL. We can either return the
 * `/stream` URL directly (the player follows the redirect) or do a HEAD to
 * resolve. For download/playback we just return the canonical /stream URL —
 * RNBlobUtil follows redirects transparently.
 */
import { logger } from '@/utils/logger';
import { HttpError, httpGetJson } from '@/utils/http';
import type { YouTubeSearchResult } from '@/types/track';
import type { AudioStreamInfo } from './types';

const DISCOVERY_PROVIDERS = [
  'https://discoveryprovider.audius.co',
  'https://discoveryprovider2.audius.co',
  'https://discoveryprovider3.audius.co',
];

const APP_NAME = 'Chakaas';

let _preferredProviderIndex: number | null = null;
const _failedProviders = new Set<number>();
/** Wall-clock ms when each provider was last marked failed — used to age entries out. */
const _failedAt = new Map<number, number>();
/** How long a "known-failed" mark sticks before we let the provider be retried. */
const FAILURE_TTL_MS = 5 * 60 * 1000;

function expireOldFailures(): void {
  const now = Date.now();
  for (const [idx, ts] of _failedAt) {
    if (now - ts >= FAILURE_TTL_MS) {
      _failedAt.delete(idx);
      _failedProviders.delete(idx);
    }
  }
}

function resetFailedProviders(): void {
  _failedProviders.clear();
  _failedAt.clear();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function orderedProviders(): string[] {
  const order: string[] = [];
  if (_preferredProviderIndex !== null && !_failedProviders.has(_preferredProviderIndex)) {
    order.push(DISCOVERY_PROVIDERS[_preferredProviderIndex]);
  }
  for (let i = 0; i < DISCOVERY_PROVIDERS.length; i += 1) {
    if (_failedProviders.has(i)) continue;
    if (i === _preferredProviderIndex) continue;
    order.push(DISCOVERY_PROVIDERS[i]);
  }
  return order;
}

function markFailed(base: string): void {
  const idx = DISCOVERY_PROVIDERS.indexOf(base);
  if (idx >= 0) {
    _failedProviders.add(idx);
    _failedAt.set(idx, Date.now());
  }
}

function markHealthy(base: string): void {
  const idx = DISCOVERY_PROVIDERS.indexOf(base);
  if (idx >= 0) _preferredProviderIndex = idx;
}

// ── Search ──────────────────────────────────────────────────────────────────

interface AudiusUser {
  name?: unknown;
  handle?: unknown;
}

interface AudiusArtwork {
  ['480x480']?: unknown;
  ['150x150']?: unknown;
  ['1000x1000']?: unknown;
}

function pickArtwork(artwork: unknown): string {
  if (!isRecord(artwork)) return '';
  const a = artwork as AudiusArtwork;
  return (
    asString(a['1000x1000']) ||
    asString(a['480x480']) ||
    asString(a['150x150'])
  );
}

function mapAudiusTrack(raw: unknown): YouTubeSearchResult | null {
  if (!isRecord(raw)) return null;
  const id = asString(raw.id);
  if (!id) return null;

  const title = asString(raw.title);
  if (!title) return null;

  const user = isRecord(raw.user) ? (raw.user as AudiusUser) : null;
  const author = (user && asString(user.name)) || (user && asString(user.handle)) || 'Audius';

  const durationSec = asNumber(raw.duration);
  return {
    id,
    title,
    author,
    duration_ms: durationSec > 0 ? durationSec * 1000 : 0,
    thumbnail: pickArtwork(raw.artwork),
    view_count: `${asNumber(raw.play_count).toLocaleString()} plays`,
    // Audius lives outside the saavn/youtube discriminant, so we tag it as
    // youtube to fit the existing shape — the resolver routes by URL hint.
    provider: 'youtube',
  };
}

/**
 * Searches Audius. Returns up to `limit` tracks. Audius IDs are
 * base-encoded strings (e.g. "abc12").
 */
export async function searchAudius(query: string, limit = 15): Promise<YouTubeSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  // Age out any stale failure marks before we decide which providers to skip.
  expireOldFailures();

  let lastError: unknown = null;

  for (const base of orderedProviders()) {
    try {
      const url = `${base}/v1/tracks/search?query=${encodeURIComponent(trimmed)}&app_name=${APP_NAME}`;
      const data = await httpGetJson<unknown>(url, { timeoutMs: 7000 });
      const items = asArray(isRecord(data) ? data.data : []);

      const out: YouTubeSearchResult[] = [];
      const seen = new Set<string>();
      for (const raw of items) {
        const mapped = mapAudiusTrack(raw);
        if (!mapped || seen.has(mapped.id)) continue;
        seen.add(mapped.id);
        out.push(mapped);
        if (out.length >= limit) break;
      }

      if (out.length > 0) {
        markHealthy(base);
        return out;
      }
      markFailed(base);
    } catch (err) {
      lastError = err;
      markFailed(base);
      const status = err instanceof HttpError ? ` (HTTP ${err.status})` : '';
      logger.warn(
        `[Audius] provider "${base}" search failed${status}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Reset the failure tracking when every provider has been exhausted so the
  // very next call retries from scratch instead of going permanently dark.
  if (_failedProviders.size >= DISCOVERY_PROVIDERS.length) {
    resetFailedProviders();
  }

  if (lastError) throw lastError instanceof Error ? lastError : new Error('All Audius providers failed');
  return [];
}

// ── Stream resolution ───────────────────────────────────────────────────────

/**
 * Returns the canonical Audius /stream URL for the given trackId. Audius
 * issues a 302 to the actual signed mp3 on a CDN — RNBlobUtil follows
 * redirects, so downstream callers don't need to do anything special.
 *
 * We pick the discovery provider that is currently healthy (or the first
 * one) so the resolver doesn't have to retry on download.
 */
export async function getAudiusStreamUrl(trackId: string): Promise<AudioStreamInfo> {
  if (!trackId) throw new Error('Audius: missing trackId');
  // Age out any stale failure marks before we decide which providers to skip.
  expireOldFailures();
  const providers = orderedProviders();
  const base = providers[0] ?? DISCOVERY_PROVIDERS[0];
  const url = `${base}/v1/tracks/${encodeURIComponent(trackId)}/stream?app_name=${APP_NAME}`;

  // Audius tracks ship as 320kbps mp3 for high-quality uploads. We can't be
  // 100% sure without inspecting headers, so default to 320 and let the
  // downloader validate file size.
  return {
    url,
    mimeType: 'audio/mpeg',
    // Use 320 kbps as the nominal high-quality value Audius advertises.
    bitrate: 320_000,
    // Audius serves real mp3 bytes. We report container='mp3' so the
    // download pipeline saves the file with a .mp3 extension and publishes
    // the correct audio/mpeg MIME to Android's MediaStore. ExoPlayer / RNTP
    // play mp3 natively.
    container: 'mp3',
    needsTranscode: false,
    effectiveBitrate: 320_000,
    durationMs: 0,
    source: 'audius',
  };
}
