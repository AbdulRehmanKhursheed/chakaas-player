import TrackPlayer, { Event } from 'react-native-track-player';
import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';
import type { Track as RNTPTrack } from 'react-native-track-player';
import { Track } from '@/types/track';
import { trackMapper } from './trackMapper';

function showPlaybackError(err: unknown): void {
  const message = err instanceof Error ? err.message : 'Playback failed. Please try again.';
  Alert.alert('Cannot play this song', message);
}

/**
 * Custom replacement for RNTP's removed `useQueue` hook. Maintains a local
 * snapshot of the queue, refreshed when:
 *   - the active track changes (skip / next / previous)
 *   - the queue ends
 *   - a queue-mutating action in this hook is called (add / remove / move /
 *     reset) — `bumpQueueVersion` is invoked from those callbacks so
 *     consumers re-render with the latest snapshot.
 *
 * Subscriber model: every mounted `usePlayerQueue` registers a callback in
 * a module-level Set. `bumpQueueVersion()` fans out to all of them, so
 * multiple screens (NowPlaying, Library, QueueScreen, MiniPlayer, …) can
 * use the hook concurrently without the latest mount overwriting earlier
 * subscriptions.
 *
 * Crucially we do NOT subscribe to `Event.PlaybackState`. That event fires
 * for every play/pause/buffer/loading transition and would force a native
 * `getQueue()` round-trip plus a re-render of every screen using
 * `usePlayerQueue` — including `LibraryScreen` — making play/pause feel
 * laggy. Queue contents do not change when the playback state changes, so
 * there's no reason to listen for it.
 */
const queueSubscribers = new Set<() => void>();

export function bumpQueueVersion(): void {
  queueSubscribers.forEach((fn) => fn());
}

/**
 * Backwards-compatible alias. Older code may import `{ queueVersion }` and
 * call `queueVersion.bump()`. Keep this around so external callers keep
 * working without modification.
 */
export const queueVersion: { bump: () => void } = {
  bump: bumpQueueVersion,
};

function useRNTPQueue(): RNTPTrack[] {
  const [queue, setQueue] = useState<RNTPTrack[]>([]);

  useEffect(() => {
    let mounted = true;

    const refresh = async () => {
      try {
        const q = await TrackPlayer.getQueue();
        if (mounted) setQueue(q);
      } catch {
        // RNTP not yet initialised; ignore.
      }
    };

    refresh();

    const onBump = (): void => {
      if (mounted) void refresh();
    };
    queueSubscribers.add(onBump);

    const subs = [
      TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, refresh),
      TrackPlayer.addEventListener(Event.PlaybackQueueEnded, refresh),
    ];

    return () => {
      mounted = false;
      subs.forEach((s) => s.remove());
      queueSubscribers.delete(onBump);
    };
  }, []);

  return queue;
}

/**
 * usePlayerQueue — queue management hook.
 *
 * Provides a stable API for adding, playing, reordering, and removing tracks
 * from the RNTP queue. Wraps RNTP's `useQueue` reactive hook so consumers
 * automatically re-render when the queue changes.
 */
export function usePlayerQueue() {
  /** Live reactive snapshot of the current RNTP queue. */
  const queue = useRNTPQueue();

  // ── Single-track add ───────────────────────────────────────────────────

  /**
   * Appends a single track to the end of the current queue without
   * interrupting playback.
   */
  const addTrack = useCallback(async (track: Track) => {
    try {
      await TrackPlayer.add(trackMapper(track));
      bumpQueueVersion();
    } catch (err) {
      showPlaybackError(err);
    }
  }, []);

  /**
   * Inserts a single track immediately after the currently active track so
   * it plays next, without interrupting the track that is currently playing.
   */
  const playNext = useCallback(async (track: Track) => {
    try {
      const activeIndex = await TrackPlayer.getActiveTrackIndex();
      const insertAt = activeIndex != null ? activeIndex + 1 : undefined;
      await TrackPlayer.add(trackMapper(track), insertAt);
      bumpQueueVersion();
    } catch (err) {
      showPlaybackError(err);
    }
  }, []);

  // ── Context-aware play ─────────────────────────────────────────────────

  /**
   * Replaces the entire queue and begins playing `track`.
   *
   * When `context` is provided (e.g. an album or playlist), the full context
   * is loaded into the queue and RNTP skips to the index of `track` so the
   * user hears the chosen track first but can still skip forwards/backwards
   * through the rest of the context.
   *
   * When no context is provided the queue is reset to just the single track.
   */
  const playTrack = useCallback(
    async (track: Track, context?: Track[]) => {
      try {
        await TrackPlayer.reset();

        if (context && context.length > 0) {
          // Load the full context array into the queue.
          await TrackPlayer.add(context.map(trackMapper));

          // Jump to the requested track if it isn't the first item.
          const idx = context.findIndex((t) => t.id === track.id);
          if (idx > 0) {
            await TrackPlayer.skip(idx);
          }
        } else {
          // Single-track play: just add the one track.
          await TrackPlayer.add(trackMapper(track));
        }

        await TrackPlayer.play();
        bumpQueueVersion();
      } catch (err) {
        showPlaybackError(err);
      }
    },
    [],
  );

  // ── Queue mutation ─────────────────────────────────────────────────────

  /**
   * Removes the track at `index` from the queue.
   * RNTP will handle the case where the active track is removed by
   * automatically advancing to the next item.
   */
  const removeFromQueue = useCallback(async (index: number) => {
    try {
      await TrackPlayer.remove(index);
      bumpQueueVersion();
    } catch (err) {
      showPlaybackError(err);
    }
  }, []);

  /**
   * Moves a track from `fromIndex` to `toIndex` within the queue.
   * Useful for drag-to-reorder in the queue UI.
   */
  const moveInQueue = useCallback(
    async (fromIndex: number, toIndex: number) => {
      try {
        await TrackPlayer.move(fromIndex, toIndex);
        bumpQueueVersion();
      } catch (err) {
        showPlaybackError(err);
      }
    },
    [],
  );

  /**
   * Clears the entire queue and stops playback.
   */
  const clearQueue = useCallback(async () => {
    try {
      await TrackPlayer.reset();
      bumpQueueVersion();
    } catch (err) {
      showPlaybackError(err);
    }
  }, []);

  /**
   * Returns the zero-based index of the currently active track, or null if
   * the queue is empty.
   */
  const getActiveIndex = useCallback(async (): Promise<number | null> => {
    const idx = await TrackPlayer.getActiveTrackIndex();
    return idx ?? null;
  }, []);

  return {
    queue,
    addTrack,
    playNext,
    playTrack,
    removeFromQueue,
    moveInQueue,
    clearQueue,
    getActiveIndex,
  };
}
