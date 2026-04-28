/**
 * WatermelonDB reactive hooks.
 *
 * Each hook returns a live Observable that re-renders its subscriber whenever
 * the underlying database rows change. withObservables wires the Observable
 * into the React component lifecycle automatically.
 *
 * These hooks use the low-level `useObservable` pattern rather than the HOC
 * form of withObservables, so they work cleanly with functional components and
 * React hooks conventions.
 */

import { useState, useEffect } from 'react';
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
// Internal helper — subscribe to a WatermelonDB Observable inside a hook
// ---------------------------------------------------------------------------

/**
 * Generic hook that subscribes to a WatermelonDB Observable and returns the
 * latest emitted value (initially `undefined` until the first emission).
 */
function useObservable<T>(observable: Observable<T>): T | undefined {
  const [value, setValue] = useState<T | undefined>(undefined);

  useEffect(() => {
    const subscription = observable.subscribe({
      next: (v) => setValue(v),
      error: (err: unknown) => logger.error('[useTrackDB] Observable error:', err),
    });
    return () => subscription.unsubscribe();
  // observable reference is stable for the lifetime of each hook call
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return value;
}

// ---------------------------------------------------------------------------
// Public hooks
// ---------------------------------------------------------------------------

/**
 * Returns all tracks in the library, ordered by most recently added.
 * Re-renders whenever any track row changes.
 */
export function useAllTracks(): Track[] {
  const observable = tracksCollection
    .query(Q.sortBy('added_at', Q.desc))
    .observe();

  return useObservable(observable) ?? [];
}

/**
 * Returns the single track matching `id`, or `undefined` while loading /
 * when not found. Re-renders if the track row changes.
 */
export function useTrackById(id: string): Track | undefined {
  const observable = tracksCollection.findAndObserve(id);
  return useObservable(observable as unknown as Observable<Track>);
}

/**
 * Returns the tracks belonging to `playlistId`, ordered by their position in
 * the playlist. Re-renders when the playlist or any member track changes.
 *
 * The join is performed client-side: we first observe the PlaylistTrack
 * junction rows for the playlist, then map to their associated Track records.
 *
 * Note: Because this involves a two-step join, the hook returns Track[] rather
 * than an Observable directly.
 */
export function usePlaylistTracks(playlistId: string): Track[] {
  const [tracks, setTracks] = useState<Track[]>([]);

  useEffect(() => {
    const subscription = playlistTracksCollection
      .query(
        Q.where('playlist_id', playlistId),
        Q.sortBy('position', Q.asc),
      )
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

            // Re-order fetched tracks to match the playlist position order
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
 * Returns the most recently played tracks, de-duplicated by track ID.
 * The result contains at most `limit` distinct tracks.
 *
 * Re-renders when any play row is inserted or deleted.
 */
export function useRecentlyPlayed(limit = 20): Track[] {
  const [tracks, setTracks] = useState<Track[]>([]);

  useEffect(() => {
    // Observe the play log sorted newest-first
    const subscription = playsCollection
      .query(Q.sortBy('played_at', Q.desc))
      .observe()
      .subscribe({
        next: async (plays: Play[]) => {
          try {
            // De-duplicate track IDs preserving recency order
            const seen = new Set<string>();
            const recentTrackIds: string[] = [];

            for (const play of plays) {
              if (!seen.has(play.trackId)) {
                seen.add(play.trackId);
                recentTrackIds.push(play.trackId);
                if (recentTrackIds.length >= limit) break;
              }
            }

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
 * descending. The result contains at most `limit` tracks.
 *
 * Re-renders when any play row changes.
 */
export function useMostPlayed(limit = 20): Track[] {
  const [tracks, setTracks] = useState<Track[]>([]);

  useEffect(() => {
    const subscription = playsCollection
      .query()
      .observe()
      .subscribe({
        next: async (plays: Play[]) => {
          try {
            // Tally play counts per track
            const counts = new Map<string, number>();
            for (const play of plays) {
              counts.set(play.trackId, (counts.get(play.trackId) ?? 0) + 1);
            }

            // Sort by count descending and take top `limit` IDs
            const topIds = [...counts.entries()]
              .sort((a, b) => b[1] - a[1])
              .slice(0, limit)
              .map(([id]) => id);

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
 * Returns all tracks the user has liked (hearted), ordered by most recently
 * added. Re-renders whenever a track's `liked` field changes.
 */
export function useLikedTracks(): Track[] {
  const observable = tracksCollection
    .query(
      Q.where('liked', true),
      Q.sortBy('added_at', Q.desc),
    )
    .observe();

  return useObservable(observable) ?? [];
}
