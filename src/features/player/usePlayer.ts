import TrackPlayer, {
  useActiveTrack,
  usePlaybackState,
  State,
  RepeatMode,
} from 'react-native-track-player';
import { useCallback } from 'react';
import * as Haptics from 'expo-haptics';
import { usePlayerStore } from '@/stores/playerStore';

// ── Types ──────────────────────────────────────────────────────────────────

export type RepeatModeKey = 'off' | 'track' | 'queue';

const REPEAT_MODE_MAP: Record<RepeatModeKey, RepeatMode> = {
  off: RepeatMode.Off,
  track: RepeatMode.Track,
  queue: RepeatMode.Queue,
};

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
  const activeTrack = useActiveTrack();
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
