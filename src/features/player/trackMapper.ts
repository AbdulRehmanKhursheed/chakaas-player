import type { Track as RNTPTrack } from 'react-native-track-player';
import { Track as TrackType } from '@/types/track';

function toAudioUrl(pathOrUri: string): string {
  if (
    pathOrUri.startsWith('file://') ||
    pathOrUri.startsWith('content://') ||
    pathOrUri.startsWith('http://') ||
    pathOrUri.startsWith('https://')
  ) {
    return pathOrUri;
  }

  return `file://${pathOrUri}`;
}

function toArtworkUrl(pathOrUri: string | null): string | undefined {
  if (!pathOrUri) return undefined;
  return toAudioUrl(pathOrUri);
}

/**
 * trackMapper — converts a Chakaas `Track` (the app's canonical type, which
 * mirrors the WatermelonDB model shape) into an RNTP `Track` object ready to
 * be passed to `TrackPlayer.add()`.
 *
 * Field notes:
 * - `url`      → `file://` prefix is prepended so RNTP resolves the path as a
 *               local file URI on both Android and iOS.
 * - `artwork`  → `file://` prefix likewise; undefined when no artwork cached.
 * - `duration` → RNTP expects seconds, Chakaas stores milliseconds.
 * - `id`       → RNTP uses this as a stable identifier for queue operations;
 *               pass-through from the app's UUID.
 *
 * Any extra fields (genre, features, etc.) not consumed by RNTP are simply
 * omitted — they live in WatermelonDB and are accessed via the DB layer.
 */
export function trackMapper(track: TrackType): RNTPTrack {
  return {
    id: track.id,
    url: toAudioUrl(track.file_path),
    title: track.title,
    artist: track.artist,
    album: track.album ?? undefined,
    artwork: toArtworkUrl(track.artwork_path),
    // RNTP wants seconds; track.duration_ms is in milliseconds.
    // Guard against 0 / NaN to avoid RNTP choking on a bad value.
    duration:
      track.duration_ms > 0 ? track.duration_ms / 1000 : undefined,
    // Pass-through extras that some RNTP UI widgets / lock-screen metadata
    // providers can optionally display.
    genre: track.genre ?? undefined,
  };
}
