/**
 * JamendoProvider — Creative Commons music platform with a free public API.
 *
 * Jamendo issues client_ids to anyone with an account, but their public docs
 * demo client_id "975a6ca5" works for read-only track search + download URL
 * resolution and is what many open-source music apps use as a default.
 *
 * Endpoint:
 *   GET https://api.jamendo.com/v3.0/tracks/?client_id=<id>&format=jsonpretty
 *       &search=<q>&audiodownload_allowed=true
 *
 * Returns tracks with `audiodownload` field — a direct mp3 URL.
 */
import { HttpError, httpGetJson } from '@/utils/http';
import { logger } from '@/utils/logger';
import type { YouTubeSearchResult } from '@/types/track';
import type { AudioStreamInfo } from './types';

const CLIENT_ID = '975a6ca5';
const API_BASE = 'https://api.jamendo.com/v3.0';

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

interface JamendoTrack {
  id?: unknown;
  name?: unknown;
  artist_name?: unknown;
  album_name?: unknown;
  duration?: unknown;
  image?: unknown;
  audio?: unknown;
  audiodownload?: unknown;
}

interface JamendoTrackWithUrl extends YouTubeSearchResult {
  jamendoDirectUrl: string;
}

/** Session cache mapping trackId → direct download URL. */
const _trackUrlCache = new Map<string, { url: string; durationMs: number }>();

function mapJamendoTrack(raw: unknown): JamendoTrackWithUrl | null {
  if (!isRecord(raw)) return null;
  const t = raw as JamendoTrack;

  const idVal = t.id;
  const id =
    typeof idVal === 'number' ? String(idVal) : asString(idVal);
  if (!id) return null;

  const title = asString(t.name);
  if (!title) return null;

  const audioUrl = asString(t.audiodownload) || asString(t.audio);
  if (!audioUrl) return null;

  const durationSec = asNumber(t.duration);
  const durationMs = durationSec > 0 ? durationSec * 1000 : 0;

  _trackUrlCache.set(id, { url: audioUrl, durationMs });

  return {
    id,
    title,
    author: asString(t.artist_name) || 'Jamendo',
    duration_ms: durationMs,
    thumbnail: asString(t.image),
    view_count: asString(t.album_name) || 'Jamendo',
    provider: 'youtube',
    jamendoDirectUrl: audioUrl,
  };
}

export async function searchJamendo(
  query: string,
  limit = 15,
): Promise<YouTubeSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const url =
    `${API_BASE}/tracks/?client_id=${CLIENT_ID}` +
    `&format=jsonpretty&limit=${limit}` +
    `&audiodownload_allowed=true` +
    `&search=${encodeURIComponent(trimmed)}`;

  try {
    const data = await httpGetJson<unknown>(url, { timeoutMs: 7000 });
    const results = asArray(isRecord(data) ? data.results : []);
    const out: YouTubeSearchResult[] = [];
    const seen = new Set<string>();
    for (const raw of results) {
      const mapped = mapJamendoTrack(raw);
      if (!mapped || seen.has(mapped.id)) continue;
      seen.add(mapped.id);
      out.push(mapped);
      if (out.length >= limit) break;
    }
    return out;
  } catch (err) {
    if (err instanceof HttpError) {
      logger.warn(`[Jamendo] search HTTP ${err.status}`);
    }
    throw err;
  }
}

/**
 * Looks up the cached download URL for the given trackId. If we don't have
 * it in cache (e.g. resolver was called with a hint without a prior search),
 * we hit `/tracks/?id=<id>` to fetch the single track and pull the
 * `audiodownload` URL from there.
 */
export async function getJamendoStreamUrl(trackId: string): Promise<AudioStreamInfo> {
  if (!trackId) throw new Error('Jamendo: missing trackId');

  let entry = _trackUrlCache.get(trackId);
  if (!entry) {
    const url =
      `${API_BASE}/tracks/?client_id=${CLIENT_ID}` +
      `&format=jsonpretty&id=${encodeURIComponent(trackId)}` +
      `&audiodownload_allowed=true`;
    const data = await httpGetJson<unknown>(url, { timeoutMs: 7000 });
    const results = asArray(isRecord(data) ? data.results : []);
    if (results.length === 0) {
      throw new Error(`Jamendo: no track found for id ${trackId}`);
    }
    const mapped = mapJamendoTrack(results[0]);
    if (!mapped) throw new Error(`Jamendo: track ${trackId} did not map`);
    entry = _trackUrlCache.get(trackId) ?? {
      url: mapped.jamendoDirectUrl,
      durationMs: mapped.duration_ms,
    };
  }

  // Jamendo serves mp3 at 192–320 kbps depending on upload. 192k is the
  // conservative quote that still clears the resolver's 128k bar.
  return {
    url: entry.url,
    mimeType: 'audio/mpeg',
    bitrate: 192_000,
    // Jamendo serves real mp3 bytes — report mp3 so the file is saved with
    // the correct extension and MediaStore MIME (audio/mpeg).
    container: 'mp3',
    needsTranscode: false,
    effectiveBitrate: 192_000,
    durationMs: entry.durationMs,
    source: 'jamendo',
  };
}
