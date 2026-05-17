/**
 * iTunes Search API client (Apple, no API key required).
 *
 * Endpoint: https://itunes.apple.com/search?term=<query>&entity=song&limit=5
 *
 * Returns track metadata + a `artworkUrl100` thumbnail which we rewrite to
 * `1000x1000bb` for high-resolution artwork.
 */

import { logger } from '@/utils/logger';

const ENDPOINT = 'https://itunes.apple.com/search';
const TIMEOUT_MS = 4000;

// ── Result types ──────────────────────────────────────────────────────────

export type ITunesArtworkResult = {
  url: string;
  width: number;
  source: 'itunes';
};

export type ITunesMetadata = {
  album?: string;
  releaseDate?: string;
  genre?: string;
  trackTime?: number;
};

// ── Type guards ───────────────────────────────────────────────────────────

type ITunesTrack = {
  artworkUrl100?: string;
  collectionName?: string;
  releaseDate?: string;
  primaryGenreName?: string;
  trackTimeMillis?: number;
  trackName?: string;
  artistName?: string;
};

type ITunesResponse = {
  results: ITunesTrack[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isITunesResponse(value: unknown): value is ITunesResponse {
  if (!isRecord(value)) return false;
  return Array.isArray(value.results);
}

function asTrack(value: unknown): ITunesTrack | null {
  if (!isRecord(value)) return null;
  const t: ITunesTrack = {};
  if (typeof value.artworkUrl100 === 'string') t.artworkUrl100 = value.artworkUrl100;
  if (typeof value.collectionName === 'string') t.collectionName = value.collectionName;
  if (typeof value.releaseDate === 'string') t.releaseDate = value.releaseDate;
  if (typeof value.primaryGenreName === 'string') t.primaryGenreName = value.primaryGenreName;
  if (typeof value.trackTimeMillis === 'number') t.trackTimeMillis = value.trackTimeMillis;
  if (typeof value.trackName === 'string') t.trackName = value.trackName;
  if (typeof value.artistName === 'string') t.artistName = value.artistName;
  return t;
}

// ── HTTP helper ───────────────────────────────────────────────────────────

async function fetchITunes(title: string, artist: string): Promise<ITunesTrack[] | null> {
  const term = encodeURIComponent(`${artist} ${title}`.trim());
  const url = `${ENDPOINT}?term=${term}&entity=song&limit=5`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) {
      logger.warn(`[iTunes] non-2xx ${res.status} for "${title}" / "${artist}"`);
      return null;
    }
    const json: unknown = await res.json();
    if (!isITunesResponse(json)) return null;

    const tracks: ITunesTrack[] = [];
    for (const item of json.results) {
      const t = asTrack(item);
      if (t) tracks.push(t);
    }
    return tracks;
  } catch (err) {
    logger.warn('[iTunes] request failed:', err);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Look up high-resolution cover art via iTunes Search.
 * Rewrites the 100x100 thumbnail to 1000x1000.
 */
export async function lookupITunesArtwork(
  title: string,
  artist: string,
): Promise<ITunesArtworkResult | null> {
  const tracks = await fetchITunes(title, artist);
  if (!tracks || tracks.length === 0) return null;

  for (const t of tracks) {
    if (!t.artworkUrl100) continue;
    // Upscale by replacing the size segment. Apple serves much larger versions
    // from the same CDN — `1000x1000bb` is widely available.
    const hiRes = t.artworkUrl100.replace(/100x100bb/i, '1000x1000bb');
    return { url: hiRes, width: 1000, source: 'itunes' };
  }
  return null;
}

/**
 * Pull richer track metadata (album, release date, genre, runtime) from the
 * same iTunes Search response.
 */
export async function lookupITunesMetadata(
  title: string,
  artist: string,
): Promise<ITunesMetadata | null> {
  const tracks = await fetchITunes(title, artist);
  if (!tracks || tracks.length === 0) return null;

  const t = tracks[0];
  if (!t) return null;

  const meta: ITunesMetadata = {};
  if (t.collectionName) meta.album = t.collectionName;
  if (t.releaseDate) meta.releaseDate = t.releaseDate;
  if (t.primaryGenreName) meta.genre = t.primaryGenreName;
  if (typeof t.trackTimeMillis === 'number') meta.trackTime = t.trackTimeMillis;

  // Return null if we got nothing useful so callers can fall through.
  if (Object.keys(meta).length === 0) return null;
  return meta;
}
