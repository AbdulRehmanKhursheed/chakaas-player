import React, { useEffect, useRef } from 'react';
import { Alert, Platform, ToastAndroid } from 'react-native';
import TrackPlayer, {
  AppKilledPlaybackBehavior,
  Capability,
  Event,
  RepeatMode,
} from 'react-native-track-player';
import { usePlayerStore } from '@/stores/playerStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { CrossfadeManager } from '@/features/player/CrossfadeManager';
import { ColorThemeListener } from '@/features/player/ColorTheme';
import { SleepTimer } from '@/features/player/SleepTimer';
import { logger } from '@/utils/logger';

/**
 * Surface a short toast to the user.
 *
 * Android: native `ToastAndroid`. iOS: no native toast primitive, so fall
 * back to an `Alert` (auto-dismiss after a short delay would require an
 * extra dep; the simple alert is acceptable on iOS where toasts are rare).
 */
function showToast(message: string): void {
  if (Platform.OS === 'android') {
    ToastAndroid.showWithGravity(
      message,
      ToastAndroid.SHORT,
      ToastAndroid.BOTTOM,
    );
  } else if (Platform.OS === 'ios') {
    Alert.alert('', message);
  }
}

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
 * - On PlaybackError: always logs + skips to next + shows a toast. The
 *   modal Alert is deduped (one per 5 s) so a queue of broken files doesn't
 *   bombard the user with popups, but the toast + skip happens every time
 *   so the user always gets feedback that the track failed.
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
      async (event) => {
        // Look up the failing track so the user/logs know what failed.
        let failedTitle = 'this song';
        let failedId: string | number | undefined;
        try {
          const active = await TrackPlayer.getActiveTrack();
          if (active) {
            if (typeof active.title === 'string' && active.title.length > 0) {
              failedTitle = active.title;
            }
            if (
              typeof active.id === 'string' ||
              typeof active.id === 'number'
            ) {
              failedId = active.id;
            }
          }
        } catch {
          // Active track lookup failed — fall back to generic title.
        }

        // Always log, so a stale Saavn URL or other backend failure is
        // visible in logcat / dev console.
        logger.warn('[TrackPlayerProvider] playback error:', {
          id: failedId,
          title: failedTitle,
          code: event.code,
          message: event.message,
        });

        // Try to skip to next so the user doesn't sit on a dead track.
        // RNTP throws (or no-ops) when there's no next item — detect that
        // so we can tailor the user-facing toast accordingly.
        let didSkip = false;
        try {
          const queue = await TrackPlayer.getQueue();
          const activeIdx = await TrackPlayer.getActiveTrackIndex();
          const hasNext =
            typeof activeIdx === 'number' &&
            activeIdx >= 0 &&
            activeIdx + 1 < queue.length;
          if (hasNext) {
            await TrackPlayer.skipToNext();
            didSkip = true;
          }
        } catch {
          // No next track or queue lookup failed — treat as end of queue.
        }

        // Tailor the toast to whether we actually skipped. Saying "skipping"
        // when there's nothing to skip to is just noise — instead tell the
        // user the song failed and that we're at the end of the queue.
        showToast(
          didSkip
            ? `Couldn't play '${failedTitle}' — skipping`
            : `Couldn't play '${failedTitle}'`,
        );

        // Modal alert is still deduped: at most one popup per 5 s to avoid
        // stacking when an entire queue is broken.
        const now = Date.now();
        if (now - lastErrorAtRef.current >= 5000) {
          lastErrorAtRef.current = now;
          const message =
            event.message ||
            event.code ||
            'The selected audio file could not be played.';
          Alert.alert('Cannot play this song', message);
        }
      },
    );

    // ── Premium player wiring ────────────────────────────────────────────
    // ColorTheme listens to active-track changes and publishes dominant
    // colours into its Zustand store. Idempotent.
    ColorThemeListener.setup();

    // Resume any persisted duration-based sleep timer from before the
    // last JS reload. End-of-track timers do not resume (track context lost).
    SleepTimer.resumeFromPersisted();

    // Subscribe to settings so toggling crossfade on/off attaches /
    // detaches the manager live without needing a restart.
    const applyCrossfade = (enabled: boolean) => {
      if (enabled) CrossfadeManager.setupCrossfade();
      else CrossfadeManager.dispose();
    };
    applyCrossfade(useSettingsStore.getState().crossfadeEnabled);
    const unsubCrossfade = useSettingsStore.subscribe((s, prev) => {
      if (s.crossfadeEnabled !== prev.crossfadeEnabled) {
        applyCrossfade(s.crossfadeEnabled);
      }
      if (s.albumColorThemingEnabled !== prev.albumColorThemingEnabled) {
        // Re-publish so the UI flips between gold and album-tinted instantly.
        ColorThemeListener.refresh();
      }
    });

    return () => {
      playbackErrorSub.remove();
      unsubCrossfade();
      CrossfadeManager.dispose();
      ColorThemeListener.dispose();
    };
  }, []);

  return <>{children}</>;
}
