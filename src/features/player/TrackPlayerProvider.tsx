import React, { useEffect, useRef } from 'react';
import { Alert, Platform, ToastAndroid } from 'react-native';
import TrackPlayer, {
  AppKilledPlaybackBehavior,
  Capability,
  Event,
  RepeatMode,
  State,
} from 'react-native-track-player';
import type { Track as RNTPTrack } from 'react-native-track-player';
import { usePlayerStore } from '@/stores/playerStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { CrossfadeManager } from '@/features/player/CrossfadeManager';
import { ColorThemeListener } from '@/features/player/ColorTheme';
import { SleepTimer } from '@/features/player/SleepTimer';
import {
  getStreamMeta,
  isStreamTrack,
  resolveAndEnqueueNextOnline,
  syncOnlinePlayingPosition,
} from '@/features/player/useQueue';
import { resolveAudioStream } from '@/features/download/MultiSourceResolver';
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

    // `autoHandleInterruptions: false` — the headless PlaybackService
    // (playerService.ts) owns audio-focus/ducking via its manual `RemoteDuck`
    // handler. Enabling RNTP's auto-handler too would double-pause on every
    // interruption (call, other-app audio). Single owner = the manual handler.
    TrackPlayer.setupPlayer({
      autoHandleInterruptions: false,
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

        // Hydrate persisted volume so the user's last level survives cold
        // start. Clamp defensively in case a malformed value was persisted.
        const persistedVolume = usePlayerStore.getState().volume;
        const clampedVolume = Math.min(1, Math.max(0, persistedVolume));
        await TrackPlayer.setVolume(clampedVolume).catch(() => {});
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
        let activeIndex: number | null = null;
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
          const idx = await TrackPlayer.getActiveTrackIndex();
          activeIndex = typeof idx === 'number' ? idx : null;
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

        // ── Re-resolve expired CDN URL for a stream track ──────────────────
        // Streamed (online) tracks carry signed CDN URLs that expire within
        // minutes. Rather than skip a perfectly-good song whose URL merely
        // went stale, re-run the resolver with the stashed params and patch
        // the current queue item's url in place, then resume playback.
        if (isStreamTrack(failedId) && activeIndex != null) {
          const meta = getStreamMeta(failedId as string);
          if (meta) {
            try {
              const fresh = await resolveAudioStream(meta.resolve);
              const patched: RNTPTrack = {
                id: failedId as string,
                url: fresh.url,
                title: meta.title,
                artist: meta.artist,
                album: meta.album,
                artwork: meta.artwork,
                duration:
                  meta.durationMs && meta.durationMs > 0
                    ? meta.durationMs / 1000
                    : fresh.durationMs
                      ? fresh.durationMs / 1000
                      : undefined,
                headers: fresh.requestHeaders,
              };
              // Replace the dead item in place and resume from the top of it.
              await TrackPlayer.remove(activeIndex);
              await TrackPlayer.add(patched, activeIndex);
              await TrackPlayer.skip(activeIndex);
              await TrackPlayer.play();
              logger.info('[TrackPlayerProvider] re-resolved stream URL after error', {
                id: failedId,
              });
              return; // Recovered — do not skip / toast.
            } catch (reErr) {
              logger.warn('[TrackPlayerProvider] stream re-resolve failed', reErr);
              // Fall through to the normal skip path below.
            }
          }
        }

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

    // ── Mirror RNTP state into the Zustand player store ──────────────────
    // Non-RNTP consumers (recommendation engine, etc.) read
    // `usePlayerStore().currentTrack` / `isPlaying` instead of importing RNTP.
    const setCurrentTrack = usePlayerStore.getState().setCurrentTrack;
    const setIsPlaying = usePlayerStore.getState().setIsPlaying;

    const activeTrackSub = TrackPlayer.addEventListener(
      Event.PlaybackActiveTrackChanged,
      (payload) => {
        const next = (payload as { track?: RNTPTrack | null }).track ?? undefined;
        if (!next || next.id == null) {
          setCurrentTrack(null);
          return;
        }
        const id = String(next.id);
        setCurrentTrack({
          id,
          title: typeof next.title === 'string' ? next.title : '',
          artist: typeof next.artist === 'string' ? next.artist : '',
          album: typeof next.album === 'string' ? next.album : undefined,
          artwork: typeof next.artwork === 'string' ? next.artwork : undefined,
        });
        // Continuous online autoplay: when a streamed item becomes active,
        // pre-resolve + enqueue the next item in the online context so the
        // user can skip forward and playback flows on without a gap.
        if (isStreamTrack(id)) {
          void syncOnlinePlayingPosition(id.slice('stream:'.length));
        }
      },
    );

    const playbackStateSub = TrackPlayer.addEventListener(
      Event.PlaybackState,
      ({ state }) => {
        setIsPlaying(state === State.Playing);
      },
    );

    // ── Continuous online autoplay ───────────────────────────────────────
    // When a streamed queue ends, lazily resolve + enqueue (and play) the next
    // item in the active online context so streaming isn't single-track-only.
    // No-op when there is no online context or no next item.
    const queueEndedSub = TrackPlayer.addEventListener(
      Event.PlaybackQueueEnded,
      () => {
        void resolveAndEnqueueNextOnline(true);
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
      activeTrackSub.remove();
      playbackStateSub.remove();
      queueEndedSub.remove();
      unsubCrossfade();
      CrossfadeManager.dispose();
      ColorThemeListener.dispose();
    };
  }, []);

  return <>{children}</>;
}
