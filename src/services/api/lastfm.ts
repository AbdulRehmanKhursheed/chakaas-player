/**
 * Last.fm API client.
 *
 * All methods are read-only (no user auth required). The API key is read from
 * settingsStorage at call-time so it can be updated without restarting the app.
 * All requests use format=json.
 */

import axios from 'axios';
import { logger } from '@/utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LastFmSimilarTrack {
  name: string;
  artist: string;
  /** Similarity score in the range [0, 1]. */
  match: number;
}

export interface LastFmTrackInfo {
  name: string;
  artist: string;
  album: string | null;
  /** URL of the best available image (extra-large preferred). */
  image: string | null;
  /** List of tag names associated with the track. */
  tags: string[];
}

export interface LastFmTopTrack {
  name: string;
  artist: string;
  /** Raw listener count string as returned by the API. */
  listeners: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const BASE_URL = 'https://ws.audioscrobbler.com/2.0/';

/**
 * Reads the Last.fm API key from the settings store at call-time so that a
 * newly entered key takes effect without an app restart.
 */
function getApiKey(): string {
  // Lazy import to avoid circular deps at module init
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useSettingsStore } = require('@/stores/settingsStore') as typeof import('@/stores/settingsStore');
  return useSettingsStore.getState().lastFmApiKey;
}

const lastfmClient = axios.create({ baseURL: BASE_URL });

/**
 * Constructs the shared query params present on every Last.fm request.
 */
function baseParams(method: string): Record<string, string> {
  return {
    method,
    api_key: getApiKey(),
    format: 'json',
  };
}

// ---------------------------------------------------------------------------
// API methods
// ---------------------------------------------------------------------------

/**
 * Returns up to `limit` tracks similar to the given artist + track pair.
 */
export async function getSimilarTracks(
  artist: string,
  track: string,
  limit = 10,
): Promise<LastFmSimilarTrack[]> {
  type ApiResponse = {
    similartracks?: {
      track?: Array<{
        name: string;
        artist: { name: string } | string;
        match: string | number;
      }>;
    };
    error?: number;
    message?: string;
  };

  const response = await lastfmClient.get<ApiResponse>('', {
    params: {
      ...baseParams('track.getSimilar'),
      artist,
      track,
      limit: String(limit),
      autocorrect: '1',
    },
  });

  if (response.data.error) {
    logger.warn('[Last.fm] getSimilarTracks error', response.data.message);
    return [];
  }

  const items = response.data.similartracks?.track ?? [];
  return items.map((item) => ({
    name: item.name,
    artist: typeof item.artist === 'string' ? item.artist : item.artist.name,
    match: typeof item.match === 'string' ? parseFloat(item.match) : item.match,
  }));
}

/**
 * Returns metadata for the given artist + track pair, including the best
 * available artwork URL and a list of tag names.
 */
export async function getTrackInfo(
  artist: string,
  track: string,
): Promise<LastFmTrackInfo | null> {
  type ImageEntry = { '#text': string; size: string };
  type ApiResponse = {
    track?: {
      name: string;
      artist: { name: string } | string;
      album?: {
        title: string;
        image?: ImageEntry[];
      };
      toptags?: {
        tag?: Array<{ name: string }>;
      };
    };
    error?: number;
    message?: string;
  };

  const response = await lastfmClient.get<ApiResponse>('', {
    params: {
      ...baseParams('track.getInfo'),
      artist,
      track,
      autocorrect: '1',
    },
  });

  if (response.data.error || !response.data.track) {
    logger.warn('[Last.fm] getTrackInfo error', response.data.message);
    return null;
  }

  const t = response.data.track;

  // Pick the best image: prefer 'extralarge', fallback down the size ladder
  const sizePreference = ['extralarge', 'large', 'medium', 'small'];
  let bestImage: string | null = null;

  if (t.album?.image) {
    for (const size of sizePreference) {
      const entry = t.album.image.find((img) => img.size === size);
      if (entry?.['#text']) {
        bestImage = entry['#text'];
        break;
      }
    }
  }

  return {
    name: t.name,
    artist: typeof t.artist === 'string' ? t.artist : t.artist.name,
    album: t.album?.title ?? null,
    image: bestImage,
    tags: (t.toptags?.tag ?? []).map((tag) => tag.name),
  };
}

/**
 * Returns the top tracks for a given country.
 * Defaults to `'india'` which is the correct Last.fm country name for India.
 */
export async function getTopTracks(
  country = 'india',
  limit = 50,
): Promise<LastFmTopTrack[]> {
  type ApiResponse = {
    tracks?: {
      track?: Array<{
        name: string;
        artist: { name: string } | string;
        listeners: string;
      }>;
    };
    error?: number;
    message?: string;
  };

  const response = await lastfmClient.get<ApiResponse>('', {
    params: {
      ...baseParams('geo.getTopTracks'),
      country,
      limit: String(limit),
    },
  });

  if (response.data.error) {
    logger.warn('[Last.fm] getTopTracks error', response.data.message);
    return [];
  }

  const items = response.data.tracks?.track ?? [];
  return items.map((item) => ({
    name: item.name,
    artist: typeof item.artist === 'string' ? item.artist : item.artist.name,
    listeners: item.listeners,
  }));
}
