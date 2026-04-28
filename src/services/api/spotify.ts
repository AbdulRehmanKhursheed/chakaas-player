/**
 * Spotify Web API client — Client Credentials flow (no user login).
 *
 * Credentials are read from settingsStorage at call-time so that they can be
 * updated in the Settings screen without restarting the app.
 * The access token is cached in tokenStorage (MMKV) and automatically
 * refreshed when it has expired.
 */

import axios, { type InternalAxiosRequestConfig } from 'axios';
import { tokenStorage } from '@/services/storage/mmkv';
import { logger } from '@/utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpotifyArtist {
  id: string;
  name: string;
}

export interface SpotifyAlbum {
  id: string;
  name: string;
  images: { url: string; width: number; height: number }[];
}

export interface SpotifyTrack {
  id: string;
  name: string;
  artists: SpotifyArtist[];
  album: SpotifyAlbum;
  preview_url: string | null;
  duration_ms: number;
}

export interface AudioFeatures {
  id: string;
  energy: number;
  valence: number;
  danceability: number;
  tempo: number;
  acousticness: number;
  instrumentalness: number;
}

// ---------------------------------------------------------------------------
// Token cache keys
// ---------------------------------------------------------------------------

const TOKEN_KEY = 'spotify_access_token';
const TOKEN_EXPIRY_KEY = 'spotify_token_expiry';

// ---------------------------------------------------------------------------
// Credential helpers — read from the settings store at call-time so that
// credentials updated in the Settings screen take effect immediately.
// We import lazily via getState() to avoid a circular-dependency at module
// evaluation time.
// ---------------------------------------------------------------------------

function getClientId(): string {
  // Lazy import to avoid circular deps at module init
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useSettingsStore } = require('@/stores/settingsStore') as typeof import('@/stores/settingsStore');
  return useSettingsStore.getState().spotifyClientId;
}

function getClientSecret(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useSettingsStore } = require('@/stores/settingsStore') as typeof import('@/stores/settingsStore');
  return useSettingsStore.getState().spotifyClientSecret;
}

// ---------------------------------------------------------------------------
// Token management
// ---------------------------------------------------------------------------

/**
 * Fetches a new Client-Credentials token from Spotify accounts service.
 * Stores the token and its expiry (Unix ms) in MMKV.
 */
async function fetchNewToken(): Promise<string> {
  const clientId = getClientId();
  const clientSecret = getClientSecret();

  if (!clientId || !clientSecret) {
    throw new Error('[Spotify] Missing client_id or client_secret in settings.');
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const response = await axios.post<{
    access_token: string;
    expires_in: number;
    token_type: string;
  }>(
    'https://accounts.spotify.com/api/token',
    'grant_type=client_credentials',
    {
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    },
  );

  const { access_token, expires_in } = response.data;
  // Store expiry with a 60-second safety buffer
  const expiryMs = Date.now() + (expires_in - 60) * 1000;

  tokenStorage.set(TOKEN_KEY, access_token);
  tokenStorage.set(TOKEN_EXPIRY_KEY, String(expiryMs));

  logger.info('[Spotify] Fetched new access token, expires in', expires_in, 'seconds');
  return access_token;
}

/**
 * Returns a valid Spotify access token, refreshing it if expired or absent.
 */
export async function getSpotifyToken(): Promise<string> {
  const cached = tokenStorage.getString(TOKEN_KEY);
  const expiryStr = tokenStorage.getString(TOKEN_EXPIRY_KEY);

  if (cached && expiryStr) {
    const expiry = parseInt(expiryStr, 10);
    if (Date.now() < expiry) {
      return cached;
    }
  }

  return fetchNewToken();
}

// ---------------------------------------------------------------------------
// Axios instance
// ---------------------------------------------------------------------------

export const spotifyApi = axios.create({
  baseURL: 'https://api.spotify.com/v1',
});

/**
 * Request interceptor — injects a valid Bearer token before every request.
 */
spotifyApi.interceptors.request.use(
  async (config: InternalAxiosRequestConfig): Promise<InternalAxiosRequestConfig> => {
    const token = await getSpotifyToken();
    config.headers.set('Authorization', `Bearer ${token}`);
    return config;
  },
  (error: unknown) => Promise.reject(error),
);

// ---------------------------------------------------------------------------
// API methods
// ---------------------------------------------------------------------------

/**
 * Searches for tracks matching `query`.
 * Returns up to 5 results scoped to the Indian market.
 */
export async function searchTrack(query: string): Promise<SpotifyTrack[]> {
  type SearchResponse = {
    tracks: {
      items: SpotifyTrack[];
    };
  };

  const response = await spotifyApi.get<SearchResponse>('/search', {
    params: {
      q: query,
      type: 'track',
      market: 'IN',
      limit: 5,
    },
  });

  return response.data.tracks.items.map((item) => ({
    id: item.id,
    name: item.name,
    artists: item.artists,
    album: item.album,
    preview_url: item.preview_url,
    duration_ms: item.duration_ms,
  }));
}

/**
 * Fetches audio features for a batch of track IDs.
 * Spotify's endpoint accepts up to 100 IDs per call.
 */
export async function getAudioFeatures(trackIds: string[]): Promise<AudioFeatures[]> {
  if (trackIds.length === 0) return [];

  type AudioFeaturesResponse = {
    audio_features: (AudioFeatures | null)[];
  };

  const response = await spotifyApi.get<AudioFeaturesResponse>('/audio-features', {
    params: { ids: trackIds.join(',') },
  });

  // Filter out null entries (can occur for locally-matched tracks)
  return response.data.audio_features.filter((f): f is AudioFeatures => f !== null);
}

/**
 * Fetches track recommendations seeded by up to 5 track IDs.
 * Optional `targetFeatures` are forwarded as `target_*` query parameters.
 */
export async function getRecommendations(
  seedTrackIds: string[],
  targetFeatures: Partial<Omit<AudioFeatures, 'id'>> = {},
  limit = 20,
): Promise<SpotifyTrack[]> {
  if (seedTrackIds.length === 0) {
    throw new Error('[Spotify] At least one seed track ID is required for recommendations.');
  }

  // Spotify accepts at most 5 seeds in total
  const seeds = seedTrackIds.slice(0, 5);

  // Build target_* params from supplied features
  const targetParams: Record<string, number> = {};
  for (const [key, value] of Object.entries(targetFeatures)) {
    if (value !== undefined) {
      targetParams[`target_${key}`] = value;
    }
  }

  type RecommendationsResponse = {
    tracks: SpotifyTrack[];
  };

  const response = await spotifyApi.get<RecommendationsResponse>('/recommendations', {
    params: {
      seed_tracks: seeds.join(','),
      market: 'IN',
      limit,
      ...targetParams,
    },
  });

  return response.data.tracks.map((item) => ({
    id: item.id,
    name: item.name,
    artists: item.artists,
    album: item.album,
    preview_url: item.preview_url,
    duration_ms: item.duration_ms,
  }));
}
