/**
 * WatermelonDB reactive hooks.
 *
 * Each hook subscribes to a WatermelonDB Observable and re-renders when the
 * underlying rows change. The shared `useStableObservable` helper skips
 * re-renders when the emitted value's "structural" signature is unchanged —
 * a like-toggle no longer storms every screen that consumes `useAllTracks`.
 */

import { useState, useEffect, useRef } from 'react';
import { Q } from '@nozbe/watermelondb';
import type { Observable } from '@nozbe/watermelondb/utils/rx';
import {
  tracksCollection,
  playsCollection,
  playlistTracksCollection,
} from '@/db';
import type { Track } from '@/db/models/Track';
import type { Play } from '@/db/models/Play';
import { logger } from '@/utils/logger';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Subscribes to a WatermelonDB Observable and re-emits to React only when
 * `signature(v)` changes between consecutive emissions. The default signature
 * always changes, so this behaves like a plain subscribe — pass a `signature`
 * function to suppress no-op re-renders.
 */
function useStableObservable<T>(
  observable: Observable<T>,
  signature: (v: T) => string = () => String(Math.random()),
): T | undefined {
  const [value, setValue] = useState<T | undefined>(undefined);
  const lastSigRef = useRef<string | null>(null);

  useEffect(() => {
    const subscription = observable.subscribe({
      next: (v) => {
        const sig = signature(v);
        if (sig !== lastSigRef.current) {
          lastSigRef.current = sig;
          setValue(v);
        }
      },
      error: (err: unknown) => logger.error('[useTrackDB] Observable error:', err),
    });
    return () => subscription.unsubscribe();
    // observable reference is stable for the lifetime of each hook call
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return value;
}

/**
 * Signature for the track list that captures structural changes but ignores
 * `liked` flips. Counts + the first/last track IDs + their addedAt give us a
 * cheap-to-compute fingerprint: any add/remove/reorder flips at least one
 * component without doing O(N) work per emit.
 */
function trackListSignature(tracks: Track[]): string {
  if (tracks.length === 0) return 'empty';
  const first = tracks[0];
  const last = tracks[tracks.length - 1];
  return `${tracks.length}:${first.id}:${first.addedAt}:${last.id}:${last.addedAt}`;
}

// ---------------------------------------------------------------------------
// Public hooks
// ---------------------------------------------------------------------------

/**
 * Returns all tracks in the library, ordered by most recently added.
 *
 * Re-emits only when the list **structurally** changes (add / remove / reorder).
 * Pure metadata flips like `liked` or `last played at` do NOT re-render
 * consumers — the array reference stays stable, so downstream memoised work
 * (Fuse index, artist groupings) doesn't churn.
 */
export function useAllTracks(): Track[] {
  const observable = tracksCollection
    .query(Q.sortBy('added_at', Q.desc))
    .observe();

  return useStableObservable(observable, trackListSignature) ?? [];
}

/**
 * Returns the single track matching `id`. Re-renders on every change to the
 * row — used by NowPlaying for live like/duration sync.
 */
export function useTrackById(id: string): Track | undefined {
  const observable = tracksCollection.findAndObserve(id);
  return useStableObservable(
    observable as unknown as Observable<Track>,
    (t) => (t ? `${t.id}:${t.liked}:${t.durationMs}:${t.filePath}` : 'none'),
  );
}

/**
 * Returns the tracks belonging to `playlistId`, ordered by their position in
 * the playlist. Re-renders when the playlist composition changes.
 */
export function usePlaylistTracks(playlistId: string): Track[] {
  const [tracks, setTracks] = useState<Track[]>([]);

  useEffect(() => {
    const subscription = playlistTracksCollection
      .query(Q.where('playlist_id', playlistId), Q.sortBy('position', Q.asc))
      .observe()
      .subscribe({
        next: async (playlistTrackRows) => {
          try {
            const trackIds = playlistTrackRows.map((pt) => pt.trackId);
            if (trackIds.length === 0) {
              setTracks([]);
              return;
            }
            const fetched = await tracksCollection
              .query(Q.where('id', Q.oneOf(trackIds)))
              .fetch();

            const idToTrack = new Map(fetched.map((t) => [t.id, t]));
            const ordered = trackIds
              .map((id) => idToTrack.get(id))
              .filter((t): t is Track => t !== undefined);

            setTracks(ordered);
          } catch (err) {
            logger.error('[usePlaylistTracks] Failed to fetch tracks:', err);
          }
        },
        error: (err: unknown) =>
          logger.error('[usePlaylistTracks] Observable error:', err),
      });

    return () => subscription.unsubscribe();
  }, [playlistId]);

  return tracks;
}

/**
 * Returns the most recently played tracks, de-duplicated by track ID. Only
 * re-renders when the *top-N* set changes — repeated plays of the same track
 * keep the cached array reference intact.
 */
export function useRecentlyPlayed(limit = 20): Track[] {
  const [tracks, setTracks] = useState<Track[]>([]);
  const lastTopIdsRef = useRef<string>('');

  useEffect(() => {
    const subscription = playsCollection
      .query(Q.sortBy('played_at', Q.desc), Q.take(limit * 5))
      .observe()
      .subscribe({
        next: async (plays: Play[]) => {
          try {
            const seen = new Set<string>();
            const recentTrackIds: string[] = [];
            for (const play of plays) {
              if (!seen.has(play.trackId)) {
                seen.add(play.trackId);
                recentTrackIds.push(play.trackId);
                if (recentTrackIds.length >= limit) break;
              }
            }

            const sig = recentTrackIds.join('|');
            if (sig === lastTopIdsRef.current) return;
            lastTopIdsRef.current = sig;

            if (recentTrackIds.length === 0) {
              setTracks([]);
              return;
            }

            const fetched = await tracksCollection
              .query(Q.where('id', Q.oneOf(recentTrackIds)))
              .fetch();

            const idToTrack = new Map(fetched.map((t) => [t.id, t]));
            const ordered = recentTrackIds
              .map((id) => idToTrack.get(id))
              .filter((t): t is Track => t !== undefined);

            setTracks(ordered);
          } catch (err) {
            logger.error('[useRecentlyPlayed] Failed to fetch tracks:', err);
          }
        },
        error: (err: unknown) =>
          logger.error('[useRecentlyPlayed] Observable error:', err),
      });

    return () => subscription.unsubscribe();
  }, [limit]);

  return tracks;
}

/**
 * Returns the tracks with the most play events, ordered by play count
 * descending. Only re-emits when the top-N ranking actually changes.
 */
export function useMostPlayed(limit = 20): Track[] {
  const [tracks, setTracks] = useState<Track[]>([]);
  const lastTopIdsRef = useRef<string>('');

  useEffect(() => {
    const subscription = playsCollection
      .query()
      .observe()
      .subscribe({
        next: async (plays: Play[]) => {
          try {
            const counts = new Map<string, number>();
            for (const play of plays) {
              counts.set(play.trackId, (counts.get(play.trackId) ?? 0) + 1);
            }

            const topIds = [...counts.entries()]
              .sort((a, b) => b[1] - a[1])
              .slice(0, limit)
              .map(([id]) => id);

            const sig = topIds.join('|');
            if (sig === lastTopIdsRef.current) return;
            lastTopIdsRef.current = sig;

            if (topIds.length === 0) {
              setTracks([]);
              return;
            }

            const fetched = await tracksCollection
              .query(Q.where('id', Q.oneOf(topIds)))
              .fetch();

            const idToTrack = new Map(fetched.map((t) => [t.id, t]));
            const ordered = topIds
              .map((id) => idToTrack.get(id))
              .filter((t): t is Track => t !== undefined);

            setTracks(ordered);
          } catch (err) {
            logger.error('[useMostPlayed] Failed to fetch tracks:', err);
          }
        },
        error: (err: unknown) =>
          logger.error('[useMostPlayed] Observable error:', err),
      });

    return () => subscription.unsubscribe();
  }, [limit]);

  return tracks;
}

/**
 * Returns play counts per track id. Lightweight — used by Library's
 * "Most Played" sort to avoid re-emitting full Track objects.
 */
export function usePlayCounts(): Map<string, number> {
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const lastSigRef = useRef<string>('');

  useEffect(() => {
    const subscription = playsCollection
      .query()
      .observe()
      .subscribe({
        next: (plays: Play[]) => {
          const map = new Map<string, number>();
          for (const play of plays) {
            map.set(play.trackId, (map.get(play.trackId) ?? 0) + 1);
          }
          // Only update when the {id → count} map actually differs.
          const sig = [...map.entries()]
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([id, c]) => `${id}:${c}`)
            .join('|');
          if (sig === lastSigRef.current) return;
          lastSigRef.current = sig;
          setCounts(map);
        },
        error: (err: unknown) => logger.error('[usePlayCounts] Observable error:', err),
      });
    return () => subscription.unsubscribe();
  }, []);

  return counts;
}

/**
 * Returns all tracks the user has liked, ordered by most recently added.
 * Re-renders whenever the like set changes (add/remove).
 */
export function useLikedTracks(): Track[] {
  const observable = tracksCollection
    .query(Q.where('liked', true), Q.sortBy('added_at', Q.desc))
    .observe();

  return useStableObservable(observable, trackListSignature) ?? [];
}
