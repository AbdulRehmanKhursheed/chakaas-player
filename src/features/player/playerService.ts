import TrackPlayer, { Event } from 'react-native-track-player';

/**
 * PlaybackService runs in a headless JS context. It must be registered via
 * TrackPlayer.registerPlaybackService(); it returns a Promise that never
 * resolves while listeners are active.
 *
 * Every Remote* event is forwarded to the TrackPlayer API. RemoteDuck handles
 * focus loss (call, other app audio). PlaybackQueueEnded restarts from the
 * top when repeat=queue is configured at the native level.
 */
export async function PlaybackService(): Promise<void> {
  // ── Transport controls ───────────────────────────────────────────────────
  TrackPlayer.addEventListener(Event.RemotePlay, () => {
    TrackPlayer.play();
  });

  TrackPlayer.addEventListener(Event.RemotePause, () => {
    TrackPlayer.pause();
  });

  TrackPlayer.addEventListener(Event.RemoteStop, () => {
    TrackPlayer.stop();
  });

  TrackPlayer.addEventListener(Event.RemoteNext, () => {
    TrackPlayer.skipToNext();
  });

  TrackPlayer.addEventListener(Event.RemotePrevious, () => {
    TrackPlayer.skipToPrevious();
  });

  // ── Seek ────────────────────────────────────────────────────────────────
  TrackPlayer.addEventListener(Event.RemoteSeek, async ({ position }) => {
    await TrackPlayer.seekTo(position);
  });

  // ── Headphone media keys ─────────────────────────────────────────────────
  // Bluetooth headphones / Android Auto often emit JumpForward / JumpBackward
  // for the side controls. Treat them as next/previous so triple-click skips
  // work — without these, those buttons do nothing.
  TrackPlayer.addEventListener(Event.RemoteJumpForward, async () => {
    try {
      await TrackPlayer.skipToNext();
    } catch {
      // No next track — fall back to seeking forward 15 s.
      const progress = await TrackPlayer.getProgress().catch(() => null);
      if (progress) await TrackPlayer.seekTo(progress.position + 15);
    }
  });

  TrackPlayer.addEventListener(Event.RemoteJumpBackward, async () => {
    const progress = await TrackPlayer.getProgress().catch(() => null);
    if (progress && progress.position > 3) {
      await TrackPlayer.seekTo(Math.max(0, progress.position - 15));
    } else {
      try {
        await TrackPlayer.skipToPrevious();
      } catch {
        // No previous track — restart current.
        await TrackPlayer.seekTo(0);
      }
    }
  });

  // ── Audio focus / ducking ───────────────────────────────────────────────
  TrackPlayer.addEventListener(
    Event.RemoteDuck,
    async ({ paused, permanent }: { paused: boolean; permanent: boolean }) => {
      if (permanent || paused) {
        await TrackPlayer.pause();
      }
      // Resume is intentional no-op — user must tap play to resume.
    },
  );

  // ── Queue ended ─────────────────────────────────────────────────────────
  TrackPlayer.addEventListener(Event.PlaybackQueueEnded, async () => {
    try {
      const repeatMode = await TrackPlayer.getRepeatMode();
      if (repeatMode === 2 /* RepeatMode.Queue */) {
        await TrackPlayer.skip(0);
        await TrackPlayer.seekTo(0);
        await TrackPlayer.play();
      }
    } catch {
      // Queue may be empty or player in a bad state – ignore.
    }
  });
}
