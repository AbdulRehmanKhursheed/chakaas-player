import TrackPlayer, { Event } from 'react-native-track-player';
import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';
import type { Track as RNTPTrack } from 'react-native-track-player';
import { Track } from '@/types/track';
import type { ResolveParams } from '@/features/download/MultiSourceResolver';
import { trackMapper } from './trackMapper';

function showPlaybackError(err: unknown): void {
  const message = err instanceof Error ? err.message : 'Playback failed. Please try again.';
  Alert.alert('Cannot play this song', message);
}

// ── Stream metadata registry ───────────────────────────────────────────────
//
// Streamed (online) tracks carry a synthetic id `stream:<id>`. Two things need
// to outlive the resolve+play call:
//   1. Re-resolving an expired CDN URL on PlaybackError — we stash the original
//      `resolveAudioStream` params keyed by the full stream id so the error
//      handler can re-run the resolver and patch the queue item's url.
//   2. Continuous online autoplay — when an online context (album/playlist of
//      online rows) is playing we keep the ordered list so we can lazily
//      resolve + enqueue the next item when the current one ends.
//
// These live at module scope (not React state) because the RNTP event handlers
// in TrackPlayerProvider are outside React's render tree.

/** Display + resolve info needed to (re)build a streamed RNTP track. */
export interface StreamTrackMeta {
  /** The original resolver params (query + hints) used to fetch the stream. */
  resolve: ResolveParams;
  title: string;
  artist: string;
  album?: string;
  artwork?: string;
  durationMs?: number;
}

/** Keyed by the full RNTP id, e.g. `stream:<saavnId>`. */
const streamMetaById = new Map<string, StreamTrackMeta>();

/** Returns true when an RNTP id refers to a transient online stream. */
export function isStreamTrack(id: string | number | undefined | null): boolean {
  return typeof id === 'string' && id.startsWith('stream:');
}

/** Looks up the stashed resolve/display metadata for a streamed track. */
export function getStreamMeta(id: string | undefined | null): StreamTrackMeta | undefined {
  if (typeof id !== 'string') return undefined;
  return streamMetaById.get(id);
}

/** Stashes the resolve/display metadata for a streamed track. */
export function setStreamMeta(id: string, meta: StreamTrackMeta): void {
  streamMetaById.set(id, meta);
}

// ── Online autoplay context ────────────────────────────────────────────────
//
// A single online "context" (the list the user started from — an album,
// playlist, or just a single search row) so streamed playback is continuous
// rather than single-track. We deliberately resolve lazily (one item ahead,
// on demand) rather than pre-resolving everything: resolver round-trips are
// 1-3s each and most CDN URLs expire within minutes, so resolving the whole
// list up front would be both slow and wasteful.

/** A not-yet-resolved online item waiting in the autoplay context. */
export interface OnlineQueueItem {
  /** Provider-native id (saavn song id / youtube video id). Used as stream id. */
  id: string;
  title: string;
  artist: string;
  album?: string;
  artwork?: string;
  durationMs?: number;
  /** Resolver params used to fetch a fresh CDN URL for this item. */
  resolve: ResolveParams;
}

interface OnlineContextState {
  items: OnlineQueueItem[];
  /** Index within `items` of the track that is currently playing. */
  playingIndex: number;
  /** Highest index within `items` that has been resolved + added to RNTP. */
  enqueuedIndex: number;
}

let onlineContext: OnlineContextState | null = null;
/** Guards against overlapping resolves (queue-end + active-change racing). */
let onlineResolveInFlight = false;

/** Clears any active online autoplay context (e.g. on a fresh local play). */
export function clearOnlineContext(): void {
  onlineContext = null;
}

/**
 * Establishes the online autoplay context. `startId` is the provider id (no
 * `stream:` prefix) of the item that's playing now and is already in the RNTP
 * queue; subsequent items are resolved + enqueued lazily as playback advances.
 */
export function setOnlineContext(items: OnlineQueueItem[], startId: string): void {
  if (items.length === 0) {
    onlineContext = null;
    return;
  }
  const index = items.findIndex((it) => it.id === startId);
  const playingIndex = index >= 0 ? index : 0;
  onlineContext = { items, playingIndex, enqueuedIndex: playingIndex };
}

/**
 * Internal: resolve item at `index` and append it to the RNTP queue. Returns
 * true on success. Updates `enqueuedIndex` so the same item isn't added twice.
 */
async function enqueueOnlineItem(index: number): Promise<boolean> {
  if (!onlineContext) return false;
  const item = onlineContext.items[index];
  if (!item) return false;

  // Import lazily to avoid a static cycle (MultiSourceResolver → providers).
  const { resolveAudioStream } = await import('@/features/download/MultiSourceResolver');

  const stream = await resolveAudioStream(item.resolve);
  const fullId = `stream:${item.id}`;
  const rntpTrack: RNTPTrack = {
    id: fullId,
    url: stream.url,
    title: item.title,
    artist: item.artist,
    album: item.album,
    artwork: item.artwork,
    duration:
      item.durationMs && item.durationMs > 0 ? item.durationMs / 1000 : undefined,
    headers: stream.requestHeaders,
  };
  setStreamMeta(fullId, {
    resolve: item.resolve,
    title: item.title,
    artist: item.artist,
    album: item.album,
    artwork: item.artwork,
    durationMs: item.durationMs,
  });
  await TrackPlayer.add(rntpTrack);
  if (onlineContext && index > onlineContext.enqueuedIndex) {
    onlineContext.enqueuedIndex = index;
  }
  bumpQueueVersion();
  return true;
}

/**
 * Pre-resolves and enqueues the item AFTER the one currently playing so the
 * user can skip forward seamlessly and playback flows continuously. Called when
 * the active track changes. `activeId` is the provider id of the now-playing
 * stream (no `stream:` prefix). No-op when there's no online context, the
 * active id isn't part of it, or the next item is already enqueued.
 */
export async function syncOnlinePlayingPosition(activeId: string): Promise<void> {
  if (!onlineContext) return;
  const idx = onlineContext.items.findIndex((it) => it.id === activeId);
  if (idx < 0) return;
  onlineContext.playingIndex = idx;

  const nextIndex = idx + 1;
  if (nextIndex >= onlineContext.items.length) return; // end of context
  if (nextIndex <= onlineContext.enqueuedIndex) return; // already enqueued
  if (onlineResolveInFlight) return;

  onlineResolveInFlight = true;
  try {
    await enqueueOnlineItem(nextIndex);
  } catch {
    // Resolution failed — leave it; the queue-ended handler retries.
  } finally {
    onlineResolveInFlight = false;
  }
}

/**
 * Resolves + enqueues the next online item and starts playback. Called from the
 * `PlaybackQueueEnded` handler as a fallback when pre-enqueue didn't happen
 * (e.g. a slow resolve, or the user skipped past the buffered item). Returns
 * true when a next item was enqueued. No-op when there's no context / no next
 * item / resolution fails.
 */
export async function resolveAndEnqueueNextOnline(playNow: boolean): Promise<boolean> {
  if (!onlineContext) return false;
  const nextIndex = onlineContext.playingIndex + 1;
  if (nextIndex >= onlineContext.items.length) return false;
  if (onlineResolveInFlight) return false;

  onlineResolveInFlight = true;
  try {
    // If pre-enqueue already added it, just advance + play.
    if (nextIndex > onlineContext.enqueuedIndex) {
      const ok = await enqueueOnlineItem(nextIndex);
      if (!ok) return false;
    }
    onlineContext.playingIndex = nextIndex;
    if (playNow) {
      // The just-enqueued item is the last in the RNTP queue — skip to it.
      try {
        const queue = await TrackPlayer.getQueue();
        await TrackPlayer.skip(queue.length - 1);
      } catch {
        // Best-effort; fall through to play.
      }
      await TrackPlayer.play();
    }
    bumpQueueVersion();
    return true;
  } catch {
    return false;
  } finally {
    onlineResolveInFlight = false;
  }
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
        // Local play replaces playback wholesale — drop any online autoplay
        // context so it doesn't fire a stale stream when this queue ends.
        clearOnlineContext();
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

  // ── Transient streaming play ───────────────────────────────────────────

  /**
   * Plays a remote (HTTP/HTTPS) stream URL without persisting the track to
   * the library or DB. Used by Search when the user taps the "play" button
   * on an online Saavn/YT result — they want to listen, not download.
   *
   * The track is added with a synthetic id like `stream:<saavnId>` so it
   * never collides with real DB UUIDs (queue ops, like, play-history
   * recording all see this is a transient and can ignore it).
   *
   * The queue is reset first so streaming behaves like `playTrack` for a
   * library row: replaces what's playing, jumps straight to it.
   */
  const streamTrack = useCallback(
    async (params: {
      id: string;
      title: string;
      artist: string;
      album?: string;
      artwork?: string;
      url: string;
      durationMs?: number;
      requestHeaders?: Record<string, string>;
      /**
       * The resolver params used to fetch `url`. When provided they're stashed
       * so the player can re-resolve an expired CDN URL on PlaybackError instead
       * of just skipping the track.
       */
      resolve?: ResolveParams;
    }) => {
      try {
        const fullId = `stream:${params.id}`;
        const rntpTrack: RNTPTrack = {
          id: fullId,
          url: params.url,
          title: params.title,
          artist: params.artist,
          album: params.album,
          artwork: params.artwork,
          duration:
            params.durationMs && params.durationMs > 0
              ? params.durationMs / 1000
              : undefined,
          // RNTP forwards these to the native player so signed CDN URLs
          // (Saavn) load with the right Referer/User-Agent.
          headers: params.requestHeaders,
        };
        // Stash resolve + display metadata so the error handler can re-resolve
        // an expired CDN URL for this stream id.
        if (params.resolve) {
          setStreamMeta(fullId, {
            resolve: params.resolve,
            title: params.title,
            artist: params.artist,
            album: params.album,
            artwork: params.artwork,
            durationMs: params.durationMs,
          });
        }
        // Reset clears any online autoplay context; `playOrStream` re-establishes
        // it afterwards when the stream was started from an online list.
        clearOnlineContext();
        await TrackPlayer.reset();
        await TrackPlayer.add(rntpTrack);
        await TrackPlayer.play();
        bumpQueueVersion();
      } catch (err) {
        showPlaybackError(err);
        throw err;
      }
    },
    [],
  );

  return {
    queue,
    addTrack,
    playNext,
    playTrack,
    removeFromQueue,
    moveInQueue,
    clearQueue,
    getActiveIndex,
    streamTrack,
  };
}
