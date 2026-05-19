import TrackPlayer, {
  usePlaybackState,
  State,
  RepeatMode,
  Event,
} from 'react-native-track-player';
import type { Track as RNTPTrack } from 'react-native-track-player';
import { useCallback, useEffect, useState } from 'react';
import * as Haptics from 'expo-haptics';
import { usePlayerStore } from '@/stores/playerStore';

// ── Types ──────────────────────────────────────────────────────────────────

export type RepeatModeKey = 'off' | 'track' | 'queue';

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
  };
}
