/**
 * InvidiousProvider — alternative YouTube proxy. Invidious is older than
 * Piped and exposes a different REST shape, but the same goal: bypass
 * direct YouTube without needing the cipher/po_token dance.
 *
 * Endpoints:
 *   GET /api/v1/search?q=<query>&type=video      → search hits
 *   GET /api/v1/videos/<id>                      → adaptiveFormats[]
 */
import { logger } from '@/utils/logger';
import { HttpError, httpGetJson } from '@/utils/http';
import type { YouTubeSearchResult } from '@/types/track';
import type { AudioStreamInfo } from './types';

const INSTANCES = [
  'https://invidious.io.lol',
  'https://vid.puffyan.us',
  'https://invidious.fdn.fr',
  'https://yewtu.be',
  'https://invidious.snopyta.org',
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

function pickBestThumbnail(thumbnails: unknown): string {
  if (!Array.isArray(thumbnails) || thumbnails.length === 0) return '';
  // Prefer the highest-width entry.
  let bestUrl = '';
  let bestWidth = -1;
  for (const t of thumbnails) {
    if (!isRecord(t)) continue;
    const url = asString(t.url);
    const width = asNumber(t.width);
    if (url && width > bestWidth) {
      bestUrl = url;
      bestWidth = width;
    }
  }
  return bestUrl;
}

function mapInvidiousSearchItem(raw: unknown): YouTubeSearchResult | null {
  if (!isRecord(raw)) return null;
  if (asString(raw.type) && asString(raw.type) !== 'video') return null;

  const id = asString(raw.videoId);
  if (!id) return null;

  const title = asString(raw.title);
  if (!title) return null;

  const durationSec = asNumber(raw.lengthSeconds);
  return {
    id,
    title,
    author: asString(raw.author) || 'YouTube',
    duration_ms: durationSec > 0 ? durationSec * 1000 : 0,
    thumbnail: pickBestThumbnail(raw.videoThumbnails),
    view_count:
      typeof raw.viewCount === 'number'
        ? `${(raw.viewCount as number).toLocaleString()} views`
        : asString(raw.viewCountText) || 'YouTube',
    provider: 'youtube',
  };
}

export async function searchInvidiousMusic(
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
      const url = `${base}/api/v1/search?q=${encodeURIComponent(trimmed)}&type=video`;
      const data = await httpGetJson<unknown>(url, { timeoutMs: 6000 });
      const items = Array.isArray(data) ? data : asArray(isRecord(data) ? data.results : []);

      const out: YouTubeSearchResult[] = [];
      const seen = new Set<string>();
      for (const raw of items) {
        const mapped = mapInvidiousSearchItem(raw);
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
        `[Invidious] instance "${base}" search failed${status}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Reset the failure tracking when every instance has been exhausted so the
  // very next call retries from scratch instead of going permanently dark.
  if (_failedInstances.size >= INSTANCES.length) {
    resetFailedInstances();
  }

  if (lastError) throw lastError instanceof Error ? lastError : new Error('All Invidious instances failed');
  return [];
}

// ── Stream resolution ───────────────────────────────────────────────────────

interface InvidiousAdaptiveFormat {
  url?: unknown;
  bitrate?: unknown;
  type?: unknown;
  container?: unknown;
  encoding?: unknown;
  audioQuality?: unknown;
}

function containerFromInvidiousType(type: string, fallback: string): 'm4a' | 'webm' {
  const t = (type || fallback || '').toLowerCase();
  if (t.includes('mp4') || t.includes('m4a') || t.includes('aac')) return 'm4a';
  return 'webm';
}

export async function getInvidiousStreamUrl(videoId: string): Promise<AudioStreamInfo> {
  if (!videoId) throw new Error('Invidious: missing videoId');

  // Age out any stale failure marks before we decide which instances to skip.
  expireOldFailures();

  let lastError: unknown = null;

  for (const base of orderedInstances()) {
    try {
      const url = `${base}/api/v1/videos/${encodeURIComponent(videoId)}`;
      const data = await httpGetJson<unknown>(url, { timeoutMs: 8000 });
      if (!isRecord(data)) {
        markInstanceFailed(base);
        continue;
      }

      const adaptiveFormats = asArray(data.adaptiveFormats) as InvidiousAdaptiveFormat[];
      // Filter audio-only — Invidious marks them with type containing "audio".
      const audioFormats = adaptiveFormats.filter((f) => {
        const type = asString(f.type);
        return type.startsWith('audio/');
      });

      if (audioFormats.length === 0) {
        markInstanceFailed(base);
        continue;
      }

      const durationMs = asNumber(data.lengthSeconds) * 1000;

      const scored = audioFormats
        .map((f) => {
          const sUrl = asString(f.url);
          const bitrate = asNumber(f.bitrate);
          const type = asString(f.type);
          const container = asString(f.container);
          const isAAC = /mp4|aac|m4a/i.test(type) || /mp4|m4a|aac/i.test(container);
          return { url: sUrl, bitrate, type, container, isAAC };
        })
        .filter((s) => s.url && s.bitrate > 0);

      if (scored.length === 0) {
        markInstanceFailed(base);
        continue;
      }

      scored.sort((a, b) => {
        if (a.isAAC !== b.isAAC) return a.isAAC ? -1 : 1;
        return b.bitrate - a.bitrate;
      });

      const best = scored[0];
      markInstanceHealthy(base);
      const container = containerFromInvidiousType(best.type, best.container);

      return {
        url: best.url,
        mimeType: best.type || (container === 'm4a' ? 'audio/mp4' : 'audio/webm'),
        bitrate: best.bitrate,
        container,
        needsTranscode: container !== 'm4a',
        effectiveBitrate: best.bitrate,
        durationMs,
        source: 'invidious',
      };
    } catch (err) {
      lastError = err;
      markInstanceFailed(base);
      const status = err instanceof HttpError ? ` (HTTP ${err.status})` : '';
      logger.warn(
        `[Invidious] instance "${base}" stream failed${status}: ${err instanceof Error ? err.message : String(err)}`,
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
    : new Error(`Invidious: no instance could resolve video ${videoId}`);
}
