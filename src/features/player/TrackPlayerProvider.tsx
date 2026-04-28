import React, { useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import TrackPlayer, {
  AppKilledPlaybackBehavior,
  Capability,
  Event,
} from 'react-native-track-player';

interface TrackPlayerProviderProps {
  children: React.ReactNode;
}

/**
 * TrackPlayerProvider — bootstraps react-native-track-player exactly once.
 *
 * Place this near the root of the component tree (inside any navigation
 * provider but outside any screen-specific trees). It is safe to render
 * multiple times because the `isSetup` ref gates the effect to a single
 * execution.
 *
 * TrackPlayer is a native singleton: we deliberately do NOT call
 * `TrackPlayer.destroy()` on unmount because that would kill the audio
 * session for the lifetime of the process, breaking background playback.
 *
 * Configuration rationale:
 *  - `autoHandleInterruptions: true`  → delegates audio-focus negotiation to
 *    the native layer; the JS PlaybackService still receives RemoteDuck for
 *    any custom handling we need.
 *  - `progressUpdateEventInterval: 1` → fires Event.PlaybackProgressUpdated
 *    every second, keeping the seek-bar smooth without hammering the bridge.
 *  - `AppKilledPlaybackBehavior.StopPlaybackAndRemoveNotification` → on
 *    Android, swiping away the app stops audio and clears the notification.
 *    Change to `ContinuePlayback` if you want persistent background audio
 *    after the user swipes away.
 */
export function TrackPlayerProvider({ children }: TrackPlayerProviderProps) {
  const isSetup = useRef(false);

  useEffect(() => {
    if (isSetup.current) return;
    isSetup.current = true;

    TrackPlayer.setupPlayer({
      // Let the native layer handle audio interruptions (calls, etc.).
      // Our JS PlaybackService still receives RemoteDuck events for extra
      // control logic.
      autoHandleInterruptions: true,
    })
      .then(() => {
        return TrackPlayer.updateOptions({
          // ── Notification / lock-screen buttons ──────────────────────────
          capabilities: [
            Capability.Play,
            Capability.Pause,
            Capability.Stop,
            Capability.SkipToNext,
            Capability.SkipToPrevious,
            Capability.SeekTo,
          ],

          // Buttons shown in the collapsed Android notification.
          compactCapabilities: [
            Capability.Play,
            Capability.Pause,
            Capability.SkipToNext,
          ],

          // iOS lock-screen / Control Centre commands.
          notificationCapabilities: [
            Capability.Play,
            Capability.Pause,
            Capability.SkipToNext,
            Capability.SkipToPrevious,
            Capability.Stop,
          ],

          // Emit PlaybackProgressUpdated every second.
          progressUpdateEventInterval: 1,

          android: {
            // Swiping the app away stops playback and removes the media
            // notification. Set to ContinuePlayback for "music app" UX.
            appKilledPlaybackBehavior:
              AppKilledPlaybackBehavior.StopPlaybackAndRemoveNotification,
          },
        });
      })
      .catch((err: unknown) => {
        // setupPlayer rejects with 'The player has already been initialized'
        // when hot-reloaded in development — that error is harmless.
        const message = err instanceof Error ? err.message : String(err);
        if (!message.includes('already been initialized')) {
          console.error('[TrackPlayerProvider] setup failed:', err);
        }
      });

    const playbackErrorSub = TrackPlayer.addEventListener(
      Event.PlaybackError,
      (event) => {
        const message =
          event.message ||
          event.code ||
          'The selected audio file could not be played.';
        console.error('[TrackPlayerProvider] playback error:', event);
        Alert.alert('Cannot play this song', message);
      },
    );

    // No cleanup: TrackPlayer must not be destroyed while the app is running.
    return () => {
      playbackErrorSub.remove();
    };
  }, []);

  return <>{children}</>;
}
