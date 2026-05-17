import { useMemo } from 'react';
import { isNonMusicTrack } from '@/utils/audioFilter';
import { useAllTracks } from './useTrackDB';
import type { Track } from '@/db/models/Track';

/** Last path segment of a file:// or content:// URI, decoded; '' for empty. */
function filenameFromPath(path: string): string {
  if (!path) return '';
  const lastSlash = path.lastIndexOf('/');
  const segment = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Like `useAllTracks` but filters out non-music tracks (WhatsApp voices,
 * status music clips, UUID-named files, ringtones). Use this everywhere a
 * user-visible list of tracks is rendered. The underlying observable is
 * shared with `useAllTracks` — no extra DB query.
 *
 * Derives the candidate `filename` from `filePath` so the filename-regex
 * layer of `isNonMusicTrack` (WhatsApp `WA<digits>`, Telegram, UUID, voice
 * extensions) fires here too — matching the behaviour of the boot-time
 * cleanup in `db/cleanup.ts`.
 */
export function useSafeTracks(): Track[] {
  const allTracks = useAllTracks();
  return useMemo(
    () =>
      allTracks.filter((t) => {
        if (t.source === 'saavn' || t.source === 'youtube') return true;
        const filename = filenameFromPath(t.filePath ?? '');
        return !isNonMusicTrack({
          path: t.filePath,
          uri: t.filePath,
          filename,
          name: filename,
          title: t.title,
          artist: t.artist,
          album: t.album,
          durationMs: t.durationMs,
        }).blocked;
      }),
    [allTracks],
  );
}
