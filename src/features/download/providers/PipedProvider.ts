/**
 * PipedProvider — YouTube proxy. Piped is a public, privacy-respecting
 * frontend that re-exposes the YouTube backend. Many open-source music apps
 * (NewPipe, Tubular, Hyperpipe …) rely on the same network of public
 * instances.
 *
 * We try each instance in priority order — the first one that responds
 * becomes the session-wide preferred instance. Known-failed instances are
 * skipped for the rest of the session.
 *
 * Endpoints used:
 *   GET /search?q=<query>&filter=music_songs   → search hits
 *   GET /streams/<videoId>                     → audio streams + metadata
 */
import { logger } from '@/utils/logger';
import { HttpError, httpGetJson } from '@/utils/http';
import type { YouTubeSearchResult } from '@/types/track';
import type { AudioStreamInfo } from './types';

const INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.tokhmi.xyz',
  'https://piped-api.privacy.com.de',
  'https://api-piped.mha.fi',
  'https://piped-api.hostux.net',
];

let _preferredInstanceIndex: number | null = null;
const _failedInstances = new Set<number>();
/** Wall-clock ms when each instance was last marked failed — used to age entries out. */
const _failedAt = new Map<number, number>();
/** How long a "known-failed" mark sticks before we let the instance be retried. */
const FAILURE_TTL_MS = 5 * 60 * 1000;

function expireOldFailures(): void {
  const now = Date.now();
  for (const [idx, ts] of _failedAt) {
    if (now - ts >= FAILURE_TTL_MS) {
      _failedAt.delete(idx);
      _failedInstances.delete(idx);
    }
  }
}

function resetFailedInstances(): void {
  _failedInstances.clear();
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

function orderedInstances(): string[] {
  const order: string[] = [];
  if (_preferredInstanceIndex !== null && !_failedInstances.has(_preferredInstanceIndex)) {
    order.push(INSTANCES[_preferredInstanceIndex]);
  }
  for (let i = 0; i < INSTANCES.length; i += 1) {
    if (_failedInstances.has(i)) continue;
    if (i === _preferredInstanceIndex) continue;
    order.push(INSTANCES[i]);
  }
  return order;
}

function markInstanceFailed(base: string): void {
  const idx = INSTANCES.indexOf(base);
  if (idx >= 0) {
    _failedInstances.add(idx);
    _failedAt.set(idx, Date.now());
  }
}

function markInstanceHealthy(base: string): void {
  const idx = INSTANCES.indexOf(base);
  if (idx >= 0) _preferredInstanceIndex = idx;
}

// ── Search ──────────────────────────────────────────────────────────────────

interface PipedSearchItem {
  url?: unknown;
  title?: unknown;
  uploaderName?: unknown;
  uploaderUrl?: unknown;
  duration?: unknown;
  thumbnail?: unknown;
  views?: unknown;
  type?: unknown;
}

function extractVideoId(url: string): string {
  // Piped returns paths like "/watch?v=<id>"
  const match = url.match(/[?&]v=([A-Za-z0-9_-]{6,})/);
  if (match) return match[1];
  // Some instances return the bare videoId.
  const bare = url.match(/^([A-Za-z0-9_-]{11})$/);
  return bare ? bare[1] : '';
}

function mapPipedSearchItem(raw: unknown): YouTubeSearchResult | null {
  if (!isRecord(raw)) return null;
  const item = raw as PipedSearchItem;
  if (item.type && item.type !== 'stream') return null;

  const url = asString(item.url);
  const id = extractVideoId(url);
  if (!id) return null;

  const title = asString(item.title);
  if (!title) return null;

  const durationSec = asNumber(item.duration);
  const durationMs = durationSec > 0 ? durationSec * 1000 : 0;

  return {
    id,
    title,
    author: asString(item.uploaderName) || 'YouTube',
    duration_ms: durationMs,
    thumbnail: asString(item.thumbnail),
    view_count:
      typeof item.views === 'number'
        ? `${item.views.toLocaleString()} views`
        : asString(item.views) || 'YouTube',
    provider: 'youtube',
  };
}

/**
 * Searches Piped's music-songs index. Returns up to `limit` results in the
 * canonical YouTubeSearchResult shape. Cycles through instances until one
 * responds with usable data.
 */
export async function searchPipedMusic(
  query: string,
  limit = 15,
): Promise<YouTubeSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  // Age out any stale failure marks before we decide which instances to skip.
  expireOldFailures();

  let lastError: unknown = null;

  for (const base of orderedInstances()) {
    try {
      const url = `${base}/search?q=${encodeURIComponent(trimmed)}&filter=music_songs`;
      const data = await httpGetJson<unknown>(url, { timeoutMs: 6000 });
      const items = isRecord(data) ? asArray(data.items) : [];

      const out: YouTubeSearchResult[] = [];
      const seen = new Set<string>();
      for (const raw of items) {
        const mapped = mapPipedSearchItem(raw);
        if (!mapped || seen.has(mapped.id)) continue;
        seen.add(mapped.id);
        out.push(mapped);
        if (out.length >= limit) break;
      }

      if (out.length > 0) {
        markInstanceHealthy(base);
        return out;
      }
      markInstanceFailed(base);
    } catch (err) {
      lastError = err;
      markInstanceFailed(base);
      const status = err instanceof HttpError ? ` (HTTP ${err.status})` : '';
      logger.warn(
        `[Piped] instance "${base}" search failed${status}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // If we exhausted every instance, reset the failure tracking so the very
  // next call can retry from scratch (otherwise one bad network minute kills
  // the provider for the rest of the JS session).
  if (_failedInstances.size >= INSTANCES.length) {
    resetFailedInstances();
  }

  if (lastError) throw lastError instanceof Error ? lastError : new Error('All Piped instances failed');
  return [];
}

// ── Stream resolution ───────────────────────────────────────────────────────

interface PipedAudioStream {
  url?: unknown;
  bitrate?: unknown;
  mimeType?: unknown;
  codec?: unknown;
  format?: unknown;
}

function containerFromMime(mime: string): 'm4a' | 'webm' {
  if (mime.includes('mp4') || mime.includes('m4a') || mime.includes('aac')) return 'm4a';
  return 'webm';
}

/**
 * Resolves the best audio stream for a YouTube `videoId` via Piped. Iterates
 * through the instance list — the first instance to return a usable
 * audioStreams[] wins. Picks the highest-bitrate AAC stream when available,
 * otherwise the highest-bitrate stream overall.
 */
export async function getPipedStreamUrl(videoId: string): Promise<AudioStreamInfo> {
  if (!videoId) throw new Error('Piped: missing videoId');

  // Age out any stale failure marks before we decide which instances to skip.
  expireOldFailures();

  let lastError: unknown = null;

  for (const base of orderedInstances()) {
    try {
      const url = `${base}/streams/${encodeURIComponent(videoId)}`;
      const data = await httpGetJson<unknown>(url, { timeoutMs: 8000 });
      if (!isRecord(data)) {
        markInstanceFailed(base);
        continue;
      }

      const audioStreams = asArray(data.audioStreams) as PipedAudioStream[];
      if (audioStreams.length === 0) {
        markInstanceFailed(base);
        continue;
      }

      const durationMs = asNumber(data.duration) * 1000;

      const scored = audioStreams
        .map((s): {
          url: string;
          bitrate: number;
          mime: string;
          isAAC: boolean;
        } => {
          const sUrl = asString(s.url);
          const bitrate = asNumber(s.bitrate);
          const mime = asString(s.mimeType) || asString(s.format);
          const codec = asString(s.codec);
          const isAAC =
            /mp4|aac|m4a/i.test(mime) || /aac|mp4a/i.test(codec);
          return { url: sUrl, bitrate, mime, isAAC };
        })
        .filter((s) => s.url && s.bitrate > 0);

      if (scored.length === 0) {
        markInstanceFailed(base);
        continue;
      }

      // Prefer AAC for downstream compatibility, then bitrate.
      scored.sort((a, b) => {
        if (a.isAAC !== b.isAAC) return a.isAAC ? -1 : 1;
        return b.bitrate - a.bitrate;
      });

      const best = scored[0];
      markInstanceHealthy(base);

      const container = containerFromMime(best.mime);
      return {
        url: best.url,
        mimeType: best.mime || (container === 'm4a' ? 'audio/mp4' : 'audio/webm'),
        bitrate: best.bitrate,
        container,
        needsTranscode: container !== 'm4a',
        effectiveBitrate: best.bitrate,
        durationMs,
        source: 'piped',
      };
    } catch (err) {
      lastError = err;
      markInstanceFailed(base);
      const status = err instanceof HttpError ? ` (HTTP ${err.status})` : '';
      logger.warn(
        `[Piped] instance "${base}" stream failed${status}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Reset the failure tracking when every instance has been exhausted so the
  // very next call retries from scratch instead of going permanently dark.
  if (_failedInstances.size >= INSTANCES.length) {
    resetFailedInstances();
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Piped: no instance could resolve video ${videoId}`);
}
