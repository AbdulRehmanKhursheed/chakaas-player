import type { Track as TrackModel } from '@/db/models/Track';
import type { Track } from '@/types/track';

/**
 * Converts a WatermelonDB Track model instance into the plain Track interface
 * used by the player layer. Mostly a snake_case ↔ camelCase shim.
 */
export function modelToTrack(m: TrackModel): Track {
  const source =
    m.source === 'youtube' || m.source === 'saavn' || m.source === 'local'
      ? m.source
      : 'youtube';

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
    added_at: m.addedAt,
    source,
    liked: m.liked,
  };
}

export function modelsToTracks(arr: TrackModel[]): Track[] {
  return arr.map(modelToTrack);
}
