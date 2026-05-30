import TrackPlayer, {
  usePlaybackState,
  State,
  RepeatMode,
  Event,
} from 'react-native-track-player';
import type { Track as RNTPTrack } from 'react-native-track-player';
import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';
import * as Haptics from 'expo-haptics';
import { usePlayerStore } from '@/stores/playerStore';
import { Track } from '@/types/track';
import { resolveAudioStream } from '@/features/download/MultiSourceResolver';
import type { ResolveParams } from '@/features/download/MultiSourceResolver';
import { trackMapper } from './trackMapper';
import {
  bumpQueueVersion,
  clearOnlineContext,
  setOnlineContext,
  setStreamMeta,
} from './useQueue';
import type { OnlineQueueItem } from './useQueue';

// ── Types ──────────────────────────────────────────────────────────────────

export type RepeatModeKey = 'off' | 'track' | 'queue';

/**
 * Input to `playOrStream`. The canonical `Track` (`@/types/track`) has no
 * streaming-hint fields, so we accept them here as optional extras alongside
 * the standard track shape rather than mutating the shared type. Browse/catalog
 * screens that surface online (not-yet-downloaded) rows pass the provider hints
 * so the resolver can fetch a fresh CDN URL; downloaded rows just pass a `Track`
 * with a real `file_path` and the hints are ignored.
 */
export interface PlayableTrack extends Track {
  /** Which backend this catalog row came from. */
  provider?: 'youtube' | 'saavn';
  /** Saavn song id (when `provider === 'saavn'`). */
  saavnId?: string;
  /** Saavn `encrypted_media_url` captured at search time — fastest Saavn path. */
  saavnEncryptedUrl?: string;
  /** Whether the Saavn 320 kbps tier is available. */
  saavnHas320kbps?: boolean;
}

/** A `file_path` is "usable" when it points at an on-device file, not a remote URL. */
function hasLocalFile(filePath: string | null | undefined): boolean {
  if (!filePath) return false;
  const v = filePath.trim();
  if (!v) return false;
  // Remote URLs are stream-only — treat anything else (absolute path,
  // file://, content://) as a downloaded local file.
  return !v.startsWith('http://') && !v.startsWith('https://');
}

/** Resolves which provider a catalog row came from, defaulting on hint presence. */
function resolveProvider(track: PlayableTrack): 'youtube' | 'saavn' {
  return track.provider ?? (track.youtube_id ? 'youtube' : 'saavn');
}

/** Builds `resolveAudioStream` params from a catalog row's hints. */
function buildResolveParams(track: PlayableTrack): ResolveParams {
  const provider = resolveProvider(track);
  return {
    query: `${track.title} ${track.artist}`,
    hints: {
      youtubeId: provider === 'youtube' ? track.youtube_id ?? undefined : undefined,
      saavnId: provider === 'saavn' ? track.saavnId ?? undefined : undefined,
      saavnEncryptedUrl: track.saavnEncryptedUrl,
      saavnHas320kbps: track.saavnHas320kbps,
    },
  };
}

/** The provider id used as the `stream:<id>` suffix for a catalog row. */
function streamIdFor(track: PlayableTrack): string {
  return track.saavnId ?? track.youtube_id ?? track.id;
}

/** Album label fallback consistent with SearchScreen. */
function albumFor(track: PlayableTrack): string {
  const provider = resolveProvider(track);
  return provider === 'saavn' ? track.album || 'JioSaavn' : track.album || 'YouTube';
}

/** Maps a catalog row into an `OnlineQueueItem` for the autoplay context. */
function toOnlineQueueItem(track: PlayableTrack): OnlineQueueItem {
  return {
    id: streamIdFor(track),
    title: track.title,
    artist: track.artist,
    album: albumFor(track),
    artwork: track.artwork_path ?? undefined,
    durationMs: track.duration_ms > 0 ? track.duration_ms : undefined,
    resolve: buildResolveParams(track),
  };
}

const REPEAT_MODE_MAP: Record<RepeatModeKey, RepeatMode> = {
  off: RepeatMode.Off,
  track: RepeatMode.Track,
  queue: RepeatMode.Queue,
};

// ── Stable active-track hook ───────────────────────────────────────────────
//
// RNTP's bundled `useActiveTrack` rebuilds its event subscription on every
// render because `useTrackPlayerEvents` uses the inline `[Event.X]` array as
// its effect-dep array (a fresh array literal on every render). In components
// that re-render at high frequency — e.g. MiniPlayer, which subscribes to
// `useProgress(250)` — the listener is torn down and re-added every 250 ms.
// If a `PlaybackActiveTrackChanged` event fires during that tiny gap, the
// component MISSES it and stays stuck on the previous track. Library, which
// re-renders far less, catches the event — producing the user-visible
// "Library highlights track 5, MiniPlayer shows track 1" desync after
// rapidly tapping a new track in a long queue.
//
// `useStableActiveTrack` fixes this with one module-level subscription that
// fans out to all mounted hooks. The subscription never tears down on
// re-render, so events are never dropped — Library + MiniPlayer + NowPlaying
// all see the same truth.
//
// We initialise from `TrackPlayer.getActiveTrack()` once on first import so
// late mounts (e.g. opening NowPlaying mid-playback) get the current track
// synchronously after the very first event tick.

type ActiveTrackSnapshot = RNTPTrack | undefined;

let currentActiveTrack: ActiveTrackSnapshot = undefined;
const activeTrackSubscribers = new Set<(t: ActiveTrackSnapshot) => void>();
let activeTrackBootstrapped = false;
let activeTrackEventSub: { remove: () => void } | null = null;

function bootstrapActiveTrackSubscription(): void {
  if (activeTrackBootstrapped) return;
  activeTrackBootstrapped = true;

  // Seed with whatever RNTP says is currently active. May resolve after the
  // first listener fires — the `??` in the setter below handles that case.
  TrackPlayer.getActiveTrack()
    .then((t) => {
      if (currentActiveTrack === undefined && t) {
        currentActiveTrack = t;
        activeTrackSubscribers.forEach((cb) => cb(currentActiveTrack));
      }
    })
    .catch(() => {
      // Not yet setup or no active — fine, listener will populate later.
    });

  // Single, never-torn-down listener. The whole point: re-renders in
  // consumers do NOT touch this subscription.
  activeTrackEventSub = TrackPlayer.addEventListener(
    Event.PlaybackActiveTrackChanged,
    (payload) => {
      // RNTP 4.x payload shape: { track, index, lastTrack, lastPosition, ... }
      const next = (payload as { track?: RNTPTrack | null }).track ?? undefined;
      currentActiveTrack = next;
      activeTrackSubscribers.forEach((cb) => cb(currentActiveTrack));
    },
  );
}

/**
 * Stable single-source-of-truth replacement for RNTP's `useActiveTrack`.
 * Use this in ALL player UI (MiniPlayer, NowPlayingScreen, etc.) — the
 * Library/Search screens may keep using RNTP's hook directly, but the value
 * will be the same because they share the underlying RNTP event stream.
 */
export function useStableActiveTrack(): ActiveTrackSnapshot {
  const [track, setTrack] = useState<ActiveTrackSnapshot>(currentActiveTrack);

  useEffect(() => {
    bootstrapActiveTrackSubscription();
    // Sync immediately in case the snapshot already changed between render
    // and effect — without this, late mounts could sit on the old `undefined`
    // until the next event arrives.
    if (track !== currentActiveTrack) {
      setTrack(currentActiveTrack);
    }
    const cb = (t: ActiveTrackSnapshot) => setTrack(t);
    activeTrackSubscribers.add(cb);
    return () => {
      activeTrackSubscribers.delete(cb);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return track;
}

/**
 * Used by tests / re-init flows to drop the module-level subscription so a
 * fresh RNTP setup picks up clean state. Production code does not call this.
 */
export function __resetStableActiveTrackForTest(): void {
  if (activeTrackEventSub) {
    activeTrackEventSub.remove();
    activeTrackEventSub = null;
  }
  activeTrackBootstrapped = false;
  currentActiveTrack = undefined;
  activeTrackSubscribers.clear();
}

// ── Hook ───────────────────────────────────────────────────────────────────

/**
 * usePlayer — primary hook for driving playback UI.
 *
 * Wraps react-native-track-player's reactive hooks and exposes a stable,
 * haptic-feedback-enabled API surface. The Zustand playerStore is kept in
 * sync so that non-RNTP parts of the app (e.g. recommendation engine) can
 * read playback state without importing RNTP.
 */
export function usePlayer() {
  // Use the stable, module-singleton subscription rather than RNTP's
  // `useActiveTrack` — see the comment block above `useStableActiveTrack`.
  // This eliminates the high-frequency-render listener-resubscribe race that
  // caused MiniPlayer to drop active-track-changed events.
  const activeTrack = useStableActiveTrack();
  const playbackState = usePlaybackState();
  // INTENTIONALLY no useProgress here — polling caused every consumer of
  // usePlayer (NowPlayingScreen, MiniPlayer, PlayerControls) to re-render
  // every 1 s, producing button-flicker / "buttons reload" during slider
  // drag. Components that genuinely need live progress should call
  // useProgress() themselves in a leaf wrapper (see ConnectedProgressSlider).

  const isPlaying = playbackState.state === State.Playing;
  const isLoading =
    playbackState.state === State.Loading ||
    playbackState.state === State.Buffering;

  // Use selectors so this hook only re-renders when these specific store
  // fields change. Subscribing to the whole store would re-render every
  // consumer (MiniPlayer, NowPlayingScreen, PlayerControls) on any unrelated
  // store update — adding noticeable lag to play/pause taps.
  const repeatMode = usePlayerStore((s) => s.repeatMode);
  const storeSetRepeatMode = usePlayerStore((s) => s.setRepeatMode);

  // ── Playback controls ──────────────────────────────────────────────────

  const play = useCallback(async () => {
    await TrackPlayer.play();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, []);

  const pause = useCallback(async () => {
    await TrackPlayer.pause();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const togglePlayPause = useCallback(() => {
    if (isPlaying) {
      return pause();
    }
    return play();
  }, [isPlaying, play, pause]);

  const skipToNext = useCallback(async () => {
    await TrackPlayer.skipToNext();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, []);

  const skipToPrevious = useCallback(async () => {
    // If we're more than 3 seconds into the track, seek to the start instead
    // of jumping to the previous track — standard music-player behaviour.
    // Read position on demand so we don't subscribe to live progress here.
    let position = 0;
    try {
      const p = await TrackPlayer.getProgress();
      position = p.position;
    } catch {
      // RNTP not initialised or no active track — fall through to previous
    }
    if (position > 3) {
      await TrackPlayer.seekTo(0);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      return;
    }
    await TrackPlayer.skipToPrevious();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, []);

  const seekTo = useCallback((position: number) => {
    return TrackPlayer.seekTo(position);
  }, []);

  const setVolume = useCallback((volume: number) => {
    // Clamp to [0, 1] before forwarding to the player.
    const clamped = Math.min(1, Math.max(0, volume));
    return TrackPlayer.setVolume(clamped);
  }, []);

  // ── Repeat mode ────────────────────────────────────────────────────────

  /**
   * Sets RNTP's native repeat mode AND mirrors it into the Zustand store so
   * that the notification service (headless) and UI both see the same value.
   *
   * 'off'   → RepeatMode.Off   (0) – play queue once and stop
   * 'track' → RepeatMode.Track (1) – loop the current track
   * 'queue' → RepeatMode.Queue (2) – loop the whole queue
   */
  const setRepeatMode = useCallback(
    async (mode: RepeatModeKey) => {
      const rntp = REPEAT_MODE_MAP[mode];
      await TrackPlayer.setRepeatMode(rntp);
      storeSetRepeatMode(mode);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    [storeSetRepeatMode],
  );

  /**
   * Cycles through repeat modes: off → track → queue → off
   */
  const cycleRepeatMode = useCallback(async () => {
    const cycle: RepeatModeKey[] = ['off', 'track', 'queue'];
    const current = cycle.indexOf(repeatMode);
    const next = cycle[(current + 1) % cycle.length];
    await setRepeatMode(next);
  }, [repeatMode, setRepeatMode]);

  // ── Play-or-stream (Spotify-like stream-everywhere) ─────────────────────

  /**
   * Single entry point browse/catalog screens call to play a track regardless
   * of whether it's been downloaded.
   *
   * - Downloaded (usable local `file_path`) → the existing local play path:
   *   resets the queue to the single track and plays it.
   * - Online / catalog row (no local file) → resolve a fresh CDN stream via the
   *   MultiSourceResolver using the track's hints, then play it transiently as
   *   `stream:<id>` (no DB row, no download). Mirrors SearchScreen's resolve +
   *   streamTrack flow.
   *
   * `context` (optional) is the ordered list the track was tapped from (e.g. an
   * album or playlist). When the chosen track is online, the context's online
   * rows become the autoplay context so playback continues song-to-song; later
   * items are resolved lazily as playback advances (see `useQueue`). Passing no
   * context plays a single track — matching the required
   * `playOrStream(track): Promise<void>` contract.
   *
   * Note: we drive RNTP directly here (rather than calling `usePlayerQueue`)
   * so this hook doesn't subscribe to the live queue snapshot — that would add
   * a re-render to every `usePlayer` consumer (MiniPlayer, NowPlaying, …) on
   * any queue change. `bumpQueueVersion()` still notifies the queue hooks.
   */
  const playOrStream = useCallback(
    async (track: PlayableTrack, context?: PlayableTrack[]): Promise<void> => {
      // ── Downloaded → local play ──
      if (hasLocalFile(track.file_path)) {
        try {
          clearOnlineContext();
          await TrackPlayer.reset();
          await TrackPlayer.add(trackMapper(track));
          await TrackPlayer.play();
          bumpQueueVersion();
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        } catch (err) {
          const message =
            err instanceof Error ? err.message : 'Playback failed. Please try again.';
          Alert.alert('Cannot play this song', message);
        }
        return;
      }

      // ── Online → resolve + stream ──
      const resolve = buildResolveParams(track);
      const streamId = streamIdFor(track);
      const album = albumFor(track);

      try {
        const stream = await resolveAudioStream(resolve);
        const fullId = `stream:${streamId}`;
        const rntpTrack: RNTPTrack = {
          id: fullId,
          url: stream.url,
          title: track.title,
          artist: track.artist,
          album,
          artwork: track.artwork_path ?? undefined,
          duration:
            track.duration_ms > 0
              ? track.duration_ms / 1000
              : stream.durationMs
                ? stream.durationMs / 1000
                : undefined,
          // Saavn's CDN needs Referer/User-Agent; RNTP forwards these natively.
          headers: stream.requestHeaders,
        };
        // Stash so PlaybackError can re-resolve an expired CDN URL.
        setStreamMeta(fullId, {
          resolve,
          title: track.title,
          artist: track.artist,
          album,
          artwork: track.artwork_path ?? undefined,
          durationMs: track.duration_ms > 0 ? track.duration_ms : stream.durationMs,
        });
        // `reset` inside this path clears any prior online context; re-establish
        // it AFTER so continuous autoplay has the full list to draw from.
        clearOnlineContext();
        await TrackPlayer.reset();
        await TrackPlayer.add(rntpTrack);
        await TrackPlayer.play();

        // Establish the online autoplay context from the tapped list (online
        // rows only — downloaded rows in the list aren't part of the streaming
        // context). Single-track calls leave no context, so playback stops at
        // the end of the one track.
        if (context && context.length > 1) {
          const onlineItems = context
            .filter((t) => !hasLocalFile(t.file_path))
            .map(toOnlineQueueItem);
          if (onlineItems.length > 1) {
            setOnlineContext(onlineItems, streamId);
          }
        }

        bumpQueueVersion();
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } catch (err) {
        console.warn('[usePlayer] playOrStream failed', err);
        Alert.alert(
          'Could not play this song',
          'Try a different track, or download it instead.',
        );
      }
    },
    [],
  );

  return {
    // State
    activeTrack,
    playbackState,
    isPlaying,
    isLoading,
    repeatMode,

    // Controls
    play,
    pause,
    togglePlayPause,
    skipToNext,
    skipToPrevious,
    seekTo,
    setVolume,
    setRepeatMode,
    cycleRepeatMode,
    playOrStream,
  };
}
