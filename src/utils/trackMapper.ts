import type { Track as TrackModel } from '@/db/models/Track';
import type { Track, TrackFeatures } from '@/types/track';

/**
 * Converts a WatermelonDB Track model instance into the plain Track interface
 * used throughout the UI / player layer. Maps camelCase columns to snake_case
 * fields and aggregates audio features into a single object.
 */
export function modelToTrack(m: TrackModel): Track {
  const features: TrackFeatures | null =
    m.energy !== null && m.energy !== undefined
      ? {
          energy: m.energy,
          valence: m.valence ?? 0,
          danceability: m.danceability ?? 0,
          tempo: m.tempo ?? 120,
          acousticness: m.acousticness ?? 0,
          instrumentalness: m.instrumentalness ?? 0,
        }
      : null;

  return {
    id: m.id,
    title: m.title,
    artist: m.artist,
    album: m.album ?? '',
    genre: m.genre ?? '',
    duration_ms: m.durationMs,
    file_path: m.filePath,
    artwork_path: m.artworkPath ?? null,
    youtube_id: m.youtubeId ?? null,
    spotify_id: m.spotifyId ?? null,
    features,
    added_at: m.addedAt,
    source: m.source as 'youtube' | 'local',
    liked: m.liked,
  };
}

/** Convenience for arrays. */
export function modelsToTracks(arr: TrackModel[]): Track[] {
  return arr.map(modelToTrack);
}
