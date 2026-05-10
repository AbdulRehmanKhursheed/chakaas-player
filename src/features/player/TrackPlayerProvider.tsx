import React, { useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import TrackPlayer, {
  AppKilledPlaybackBehavior,
  Capability,
  Event,
  RepeatMode,
} from 'react-native-track-player';
import { usePlayerStore } from '@/stores/playerStore';

interface TrackPlayerProviderProps {
  children: React.ReactNode;
}

const REPEAT_TO_RNTP: Record<'off' | 'track' | 'queue', RepeatMode> = {
  off: RepeatMode.Off,
  track: RepeatMode.Track,
  queue: RepeatMode.Queue,
};

/**
 * TrackPlayerProvider — bootstraps react-native-track-player exactly once.
 *
 * - Continues playing when the user swipes the app away (standard music-app UX).
 * - Restores persisted repeat mode on cold start.
 * - Dedupes PlaybackError alerts so a queue of broken files doesn't bombard
 *   the user with a popup per track.
 */
export function TrackPlayerProvider({ children }: TrackPlayerProviderProps) {
  const isSetup = useRef(false);
  const lastErrorAtRef = useRef(0);

  useEffect(() => {
    if (isSetup.current) return;
    isSetup.current = true;

    TrackPlayer.setupPlayer({
      autoHandleInterruptions: true,
    })
      .then(async () => {
        await TrackPlayer.updateOptions({
          capabilities: [
            Capability.Play,
            Capability.Pause,
            Capability.Stop,
            Capability.SkipToNext,
            Capability.SkipToPrevious,
            Capability.SeekTo,
          ],
          compactCapabilities: [
            Capability.Play,
            Capability.Pause,
            Capability.SkipToNext,
          ],
          notificationCapabilities: [
            Capability.Play,
            Capability.Pause,
            Capability.SkipToNext,
            Capability.SkipToPrevious,
            Capability.Stop,
          ],
          progressUpdateEventInterval: 1,
          android: {
            // Music apps should keep playing when the user swipes the app
            // away — they explicitly stop via the notification's stop button.
            appKilledPlaybackBehavior: AppKilledPlaybackBehavior.ContinuePlayback,
          },
        });

        // Hydrate persisted repeat mode into the native player.
        const repeat = usePlayerStore.getState().repeatMode;
        await TrackPlayer.setRepeatMode(REPEAT_TO_RNTP[repeat]).catch(() => {});
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        if (!message.includes('already been initialized')) {
          console.error('[TrackPlayerProvider] setup failed:', err);
        }
      });

    const playbackErrorSub = TrackPlayer.addEventListener(
      Event.PlaybackError,
      (event) => {
        // Dedupe: when 50 broken queue items fail in sequence, we don't want
        // 50 alerts on top of each other. Suppress within 5 s of the last.
        const now = Date.now();
        if (now - lastErrorAtRef.current < 5000) return;
        lastErrorAtRef.current = now;
        const message =
          event.message ||
          event.code ||
          'The selected audio file could not be played.';
        console.error('[TrackPlayerProvider] playback error:', event);
        Alert.alert('Cannot play this song', message);
      },
    );

    return () => {
      playbackErrorSub.remove();
    };
  }, []);

  return <>{children}</>;
}
