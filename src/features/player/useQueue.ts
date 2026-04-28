import TrackPlayer, { Event } from 'react-native-track-player';
import { useCallback, useEffect, useState } from 'react';
import type { Track as RNTPTrack } from 'react-native-track-player';
import { Track } from '@/types/track';
import { trackMapper } from './trackMapper';

/**
 * Custom replacement for RNTP's removed `useQueue` hook (no longer exported in
 * the version we use). Polls `getQueue()` once on mount and re-fetches
 * whenever a queue mutation event fires so consumers re-render with the
 * latest snapshot.
 */
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

    const subs = [
      TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, refresh),
      TrackPlayer.addEventListener(Event.PlaybackQueueEnded, refresh),
      TrackPlayer.addEventListener(Event.PlaybackState, refresh),
    ];

    return () => {
      mounted = false;
      subs.forEach((s) => s.remove());
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
    await TrackPlayer.add(trackMapper(track));
  }, []);

  /**
   * Inserts a single track immediately after the currently active track so
   * it plays next, without interrupting the track that is currently playing.
   */
  const playNext = useCallback(async (track: Track) => {
    const activeIndex = await TrackPlayer.getActiveTrackIndex();
    const insertAt = activeIndex != null ? activeIndex + 1 : undefined;
    await TrackPlayer.add(trackMapper(track), insertAt);
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
    await TrackPlayer.remove(index);
  }, []);

  /**
   * Moves a track from `fromIndex` to `toIndex` within the queue.
   * Useful for drag-to-reorder in the queue UI.
   */
  const moveInQueue = useCallback(
    async (fromIndex: number, toIndex: number) => {
      await TrackPlayer.move(fromIndex, toIndex);
    },
    [],
  );

  /**
   * Clears the entire queue and stops playback.
   */
  const clearQueue = useCallback(async () => {
    await TrackPlayer.reset();
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
