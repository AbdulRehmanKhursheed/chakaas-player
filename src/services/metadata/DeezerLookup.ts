/**
 * Deezer public search API client (no API key required).
 *
 * Endpoint: https://api.deezer.com/search?q=<query>&limit=5
 *
 * Returns track results with `album.cover_xl` — a 1000x1000 JPEG hosted on
 * Deezer's CDN. Great fallback for non-Indian-Western catalogue overlap.
 */

import { logger } from '@/utils/logger';

const ENDPOINT = 'https://api.deezer.com/search';
const TIMEOUT_MS = 4000;

// ── Result types ──────────────────────────────────────────────────────────

export type DeezerArtworkResult = {
  url: string;
  width: 1000;
  source: 'deezer';
};

export type DeezerMetadata = {
  album?: string;
  artistId?: number;
  releaseDate?: string;
};

// ── Type guards ───────────────────────────────────────────────────────────

type DeezerAlbum = {
  title?: string;
  cover_xl?: string;
  release_date?: string;
};

type DeezerArtist = {
  id?: number;
  name?: string;
};

type DeezerTrack = {
  album?: DeezerAlbum;
  artist?: DeezerArtist;
  title?: string;
  release_date?: string;
};

type DeezerResponse = {
  data: DeezerTrack[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asAlbum(value: unknown): DeezerAlbum | undefined {
  if (!isRecord(value)) return undefined;
  const a: DeezerAlbum = {};
  if (typeof value.title === 'string') a.title = value.title;
  if (typeof value.cover_xl === 'string') a.cover_xl = value.cover_xl;
  if (typeof value.release_date === 'string') a.release_date = value.release_date;
  return a;
}

function asArtist(value: unknown): DeezerArtist | undefined {
  if (!isRecord(value)) return undefined;
  const a: DeezerArtist = {};
  if (typeof value.id === 'number') a.id = value.id;
  if (typeof value.name === 'string') a.name = value.name;
  return a;
}

function asTrack(value: unknown): DeezerTrack | null {
  if (!isRecord(value)) return null;
  const t: DeezerTrack = {};
  if (typeof value.title === 'string') t.title = value.title;
  if (typeof value.release_date === 'string') t.release_date = value.release_date;
  const album = asAlbum(value.album);
  if (album) t.album = album;
  const artist = asArtist(value.artist);
  if (artist) t.artist = artist;
  return t;
}

function isDeezerResponse(value: unknown): value is DeezerResponse {
  if (!isRecord(value)) return false;
  return Array.isArray(value.data);
}

// ── HTTP helper ───────────────────────────────────────────────────────────

async function fetchDeezer(title: string, artist: string): Promise<DeezerTrack[] | null> {
  const q = encodeURIComponent(`${artist} ${title}`.trim());
  const url = `${ENDPOINT}?q=${q}&limit=5`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) {
      logger.warn(`[Deezer] non-2xx ${res.status} for "${title}" / "${artist}"`);
      return null;
    }
    const json: unknown = await res.json();
    if (!isDeezerResponse(json)) return null;

    const tracks: DeezerTrack[] = [];
    for (const item of json.data) {
      const t = asTrack(item);
      if (t) tracks.push(t);
    }
    return tracks;
  } catch (err) {
    logger.warn('[Deezer] request failed:', err);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Look up high-resolution cover art (1000x1000) via Deezer.
 */
export async function lookupDeezerArtwork(
  title: string,
  artist: string,
): Promise<DeezerArtworkResult | null> {
  const tracks = await fetchDeezer(title, artist);
  if (!tracks || tracks.length === 0) return null;

  for (const t of tracks) {
    const cover = t.album?.cover_xl;
    if (typeof cover === 'string' && cover.length > 0) {
      return { url: cover, width: 1000, source: 'deezer' };
    }
  }
  return null;
}

/**
 * Pull album + artist metadata from the Deezer search response.
 */
export async function lookupDeezerMetadata(
  title: string,
  artist: string,
): Promise<DeezerMetadata | null> {
  const tracks = await fetchDeezer(title, artist);
  if (!tracks || tracks.length === 0) return null;

  const t = tracks[0];
  if (!t) return null;

  const meta: DeezerMetadata = {};
  if (t.album?.title) meta.album = t.album.title;
  if (typeof t.artist?.id === 'number') meta.artistId = t.artist.id;
  const release = t.album?.release_date ?? t.release_date;
  if (release) meta.releaseDate = release;

  if (Object.keys(meta).length === 0) return null;
  return meta;
}
