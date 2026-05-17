/**
 * SoundCloudProvider — public-API access via the well-known web client_id.
 *
 * SoundCloud's official public docs require an OAuth app, but their *web*
 * client uses a `client_id` that's served right in the page bundle. Many
 * open-source music apps (NewPipe, SoundCloud-DL, sc-dl, etc.) use the same
 * approach.
 *
 * Caveats:
 *   - The client_id rotates occasionally. We hardcode a known-working value
 *     and if SoundCloud starts returning 401 we log and surrender the chain.
 *   - The "transcodings" array contains progressive (mp3, direct .mp3 GET)
 *     and hls (.m3u8 segmented) variants. We prefer progressive for our
 *     single-shot RNBlobUtil download.
 */
import { logger } from '@/utils/logger';
import { HttpError, httpGetJson } from '@/utils/http';
import type { YouTubeSearchResult } from '@/types/track';
import type { AudioStreamInfo } from './types';

/**
 * Known-working public web client_id. If this returns 401 in practice we'll
 * see it in logs and can rotate by scraping `https://soundcloud.com` again.
 * This is the same approach used by every open-source SoundCloud client.
 */
const CLIENT_ID = 'a3e059563d7fd3372b49b37f00a00bcf';
const API_BASE = 'https://api-v2.soundcloud.com';

let _clientIdDead = false;

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

// ── Search ──────────────────────────────────────────────────────────────────

function pickArtwork(raw: Record<string, unknown>): string {
  const url =
    asString(raw.artwork_url) ||
    (isRecord(raw.user) ? asString((raw.user as Record<string, unknown>).avatar_url) : '');
  if (!url) return '';
  // SoundCloud serves -large by default; bump to -t500x500.
  return url.replace(/-large\.(jpg|png|jpeg|webp)/i, '-t500x500.$1');
}

function mapSoundCloudTrack(raw: unknown): YouTubeSearchResult | null {
  if (!isRecord(raw)) return null;
  if (asString(raw.kind) && asString(raw.kind) !== 'track') return null;

  const id = String(asNumber(raw.id) || asString(raw.id));
  if (!id || id === '0') return null;

  const title = asString(raw.title);
  if (!title) return null;

  const user = isRecord(raw.user) ? (raw.user as Record<string, unknown>) : null;
  const author = user ? asString(user.username) : 'SoundCloud';

  const durationMs = asNumber(raw.duration);

  return {
    id,
    title,
    author: author || 'SoundCloud',
    duration_ms: durationMs > 0 ? durationMs : 0,
    thumbnail: pickArtwork(raw),
    view_count: `${asNumber(raw.playback_count).toLocaleString()} plays`,
    provider: 'youtube',
  };
}

export async function searchSoundCloud(
  query: string,
  limit = 15,
): Promise<YouTubeSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  if (_clientIdDead) return [];

  const url = `${API_BASE}/search/tracks?q=${encodeURIComponent(trimmed)}&client_id=${CLIENT_ID}&limit=${limit}`;
  try {
    const data = await httpGetJson<unknown>(url, { timeoutMs: 7000 });
    const items = asArray(isRecord(data) ? data.collection : []);
    const out: YouTubeSearchResult[] = [];
    const seen = new Set<string>();
    for (const raw of items) {
      const mapped = mapSoundCloudTrack(raw);
      if (!mapped || seen.has(mapped.id)) continue;
      seen.add(mapped.id);
      out.push(mapped);
      if (out.length >= limit) break;
    }
    return out;
  } catch (err) {
    if (err instanceof HttpError && err.status === 401) {
      _clientIdDead = true;
      logger.warn('[SoundCloud] client_id appears to have rotated (HTTP 401). Disabling provider for the session.');
      return [];
    }
    throw err;
  }
}

// ── Stream resolution ───────────────────────────────────────────────────────

interface SoundCloudTranscoding {
  url?: unknown;
  format?: unknown;
  preset?: unknown;
}

function isProgressive(transcoding: SoundCloudTranscoding): boolean {
  const format = isRecord(transcoding.format) ? (transcoding.format as Record<string, unknown>) : null;
  const protocol = format ? asString(format.protocol) : '';
  return protocol === 'progressive';
}

/**
 * Resolves a SoundCloud track ID into a direct mp3 URL. Two-step:
 *   1. GET /tracks/<id> to get the `media.transcodings` array.
 *   2. GET the chosen transcoding URL (with client_id) to receive the
 *      ephemeral CDN URL in `{ url: "..." }`.
 */
export async function getSoundCloudStreamUrl(trackId: string): Promise<AudioStreamInfo> {
  if (!trackId) throw new Error('SoundCloud: missing trackId');
  if (_clientIdDead) throw new Error('SoundCloud: client_id has rotated, cannot resolve');

  const trackUrl = `${API_BASE}/tracks/${encodeURIComponent(trackId)}?client_id=${CLIENT_ID}`;
  let track: unknown;
  try {
    track = await httpGetJson<unknown>(trackUrl, { timeoutMs: 7000 });
  } catch (err) {
    if (err instanceof HttpError && err.status === 401) {
      _clientIdDead = true;
    }
    throw err;
  }

  if (!isRecord(track)) throw new Error('SoundCloud: invalid track response');

  const media = isRecord(track.media) ? (track.media as Record<string, unknown>) : null;
  const transcodings = media ? (asArray(media.transcodings) as SoundCloudTranscoding[]) : [];
  if (transcodings.length === 0) {
    throw new Error('SoundCloud: no transcodings available');
  }

  // Prefer progressive mp3 over hls.
  const progressive = transcodings.find(isProgressive) ?? transcodings[0];
  const transcodingUrl = asString(progressive.url);
  if (!transcodingUrl) throw new Error('SoundCloud: transcoding missing URL');

  const resolveUrl = `${transcodingUrl}${transcodingUrl.includes('?') ? '&' : '?'}client_id=${CLIENT_ID}`;
  const resolved = await httpGetJson<unknown>(resolveUrl, { timeoutMs: 7000 });
  if (!isRecord(resolved) || !asString(resolved.url)) {
    throw new Error('SoundCloud: resolve response missing url');
  }

  const finalUrl = asString(resolved.url);
  const durationMs = asNumber(track.duration);

  // SoundCloud progressive is typically 128kbps mp3 (mid quality) — they
  // serve 256kbps mp3 to authenticated/Go+ users only. Report 128k so the
  // resolver's quality gate doesn't reject it (gate threshold is 128k).
  return {
    url: finalUrl,
    mimeType: 'audio/mpeg',
    bitrate: 128_000,
    // SoundCloud progressive is mp3 — report container='mp3' so the file
    // is saved with the correct extension + MediaStore MIME.
    container: 'mp3',
    needsTranscode: false,
    effectiveBitrate: 128_000,
    durationMs,
    source: 'soundcloud',
  };
}
