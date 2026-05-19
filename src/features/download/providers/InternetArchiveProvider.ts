/**
 * InternetArchiveProvider — search + stream from archive.org's open audio
 * collection. Catalog is heavy on older music, live concerts, public-domain
 * recordings. Useful as a long-tail fallback when commercial sources don't
 * have a track.
 *
 * Endpoints:
 *   GET https://archive.org/advancedsearch.php?q=mediatype:audio AND <q>
 *       &fl[]=identifier&fl[]=title&fl[]=creator&output=json
 *   GET https://archive.org/metadata/<identifier>     → files[] for picking the audio
 *
 * Audio URL pattern:
 *   https://archive.org/download/<identifier>/<file_name>
 */
import { logger } from '@/utils/logger';
import { HttpError, httpGetJson } from '@/utils/http';
import type { YouTubeSearchResult } from '@/types/track';
import type { AudioStreamInfo } from './types';

const SEARCH_BASE = 'https://archive.org/advancedsearch.php';
const METADATA_BASE = 'https://archive.org/metadata';
const DOWNLOAD_BASE = 'https://archive.org/download';

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

interface IADoc {
  identifier?: unknown;
  title?: unknown;
  creator?: unknown;
}

function mapIADoc(raw: unknown): YouTubeSearchResult | null {
  if (!isRecord(raw)) return null;
  const doc = raw as IADoc;
  const id = asString(doc.identifier);
  if (!id) return null;

  const title = asString(doc.title);
  if (!title) return null;

  // creator can be array or string.
  const rawCreator = doc.creator;
  let author = '';
  if (typeof rawCreator === 'string') author = rawCreator;
  else if (Array.isArray(rawCreator) && rawCreator.length > 0) {
    author = asString(rawCreator[0]);
  }

  return {
    id,
    title,
    author: author || 'Internet Archive',
    duration_ms: 0,
    thumbnail: `https://archive.org/services/img/${encodeURIComponent(id)}`,
    view_count: 'archive.org',
    provider: 'youtube',
  };
}

export async function searchInternetArchive(
  query: string,
  limit = 15,
): Promise<YouTubeSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  // The query MUST be a single string param. We url-encode the whole AND clause.
  const q = encodeURIComponent(`mediatype:audio AND ${trimmed}`);
  const url =
    `${SEARCH_BASE}?q=${q}` +
    `&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=creator` +
    `&rows=${limit}&page=1&output=json`;

  let data: unknown;
  try {
    data = await httpGetJson<unknown>(url, { timeoutMs: 7000 });
  } catch (err) {
    if (err instanceof HttpError) {
      throw new Error(`[InternetArchive] search HTTP ${err.status}`);
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`[InternetArchive] search failed: ${message}`);
  }
  const response = isRecord(data) ? (data.response as unknown) : null;
  const docs = asArray(isRecord(response) ? (response as Record<string, unknown>).docs : []);

  const out: YouTubeSearchResult[] = [];
  const seen = new Set<string>();
  for (const raw of docs) {
    const mapped = mapIADoc(raw);
    if (!mapped || seen.has(mapped.id)) continue;
    seen.add(mapped.id);
    out.push(mapped);
    if (out.length >= limit) break;
  }
  return out;
}

// ── Stream resolution ───────────────────────────────────────────────────────

interface IAFile {
  name?: unknown;
  format?: unknown;
  length?: unknown;
  size?: unknown;
}

const AUDIO_FORMAT_PRIORITY = [
  /VBR MP3/i,
  /MP3/i,
  /Ogg Vorbis/i,
  /AAC/i,
  /Flac/i,
];

function scoreFormat(format: string): number {
  for (let i = 0; i < AUDIO_FORMAT_PRIORITY.length; i += 1) {
    if (AUDIO_FORMAT_PRIORITY[i].test(format)) return AUDIO_FORMAT_PRIORITY.length - i;
  }
  return 0;
}

function isAudioFile(format: string, name: string): boolean {
  if (/(mp3|ogg|aac|m4a|flac|wav)/i.test(format)) return true;
  if (/\.(mp3|ogg|aac|m4a|flac|wav)$/i.test(name)) return true;
  return false;
}

function parseLengthSec(length: unknown): number {
  if (typeof length === 'number') return length;
  const str = asString(length);
  if (!str) return 0;
  // Two formats: "245.6" (seconds) or "4:05" (mm:ss).
  if (/^\d+(\.\d+)?$/.test(str)) return Number.parseFloat(str);
  const parts = str.split(':').map((p) => Number.parseInt(p, 10));
  if (parts.some((p) => !Number.isFinite(p))) return 0;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

export async function getInternetArchiveStreamUrl(identifier: string): Promise<AudioStreamInfo> {
  if (!identifier) throw new Error('InternetArchive: missing identifier');

  const url = `${METADATA_BASE}/${encodeURIComponent(identifier)}`;
  let metadata: unknown;
  try {
    metadata = await httpGetJson<unknown>(url, { timeoutMs: 7000 });
  } catch (err) {
    if (err instanceof HttpError) {
      logger.warn(`[InternetArchive] metadata HTTP ${err.status} for ${identifier}`);
    }
    throw err;
  }

  if (!isRecord(metadata)) throw new Error('InternetArchive: invalid metadata response');

  const files = asArray(metadata.files) as IAFile[];
  const audioFiles = files.filter((f) =>
    isAudioFile(asString(f.format), asString(f.name)),
  );

  if (audioFiles.length === 0) {
    throw new Error('InternetArchive: no audio files in item');
  }

  // Sort by format preference, then by size (descending = better quality).
  audioFiles.sort((a, b) => {
    const fa = asString(a.format);
    const fb = asString(b.format);
    const sa = scoreFormat(fa);
    const sb = scoreFormat(fb);
    if (sa !== sb) return sb - sa;
    return asNumber(b.size) - asNumber(a.size);
  });

  const best = audioFiles[0];
  const name = asString(best.name);
  if (!name) throw new Error('InternetArchive: best file has no name');

  const audioUrl = `${DOWNLOAD_BASE}/${encodeURIComponent(identifier)}/${encodeURIComponent(name)}`;
  const format = asString(best.format);
  const durationSec = parseLengthSec(best.length);
  const isMp3 = /mp3/i.test(format) || /\.mp3$/i.test(name);
  const bitrate = isMp3 ? 192_000 : 192_000; // archive.org mp3s are typically VBR ~192k

  // archive.org typically serves mp3; non-mp3 fallback is ogg-in-webm. We
  // report the actual container so the download pipeline can save with the
  // right extension and publish the right MediaStore MIME.
  return {
    url: audioUrl,
    mimeType: isMp3 ? 'audio/mpeg' : 'audio/ogg',
    bitrate,
    container: isMp3 ? 'mp3' : 'webm',
    needsTranscode: false,
    effectiveBitrate: bitrate,
    durationMs: durationSec > 0 ? Math.round(durationSec * 1000) : 0,
    source: 'internet_archive',
  };
}
