import TrackPlayer, { Event } from 'react-native-track-player';

/**
 * PlaybackService runs in a headless JS context registered via
 * TrackPlayer.registerPlaybackService(). It must be the default export of
 * whichever module is passed to registerPlaybackService, and it must return a
 * Promise that resolves only after all event listeners have been registered
 * (i.e. never resolves while the app is alive).
 *
 * All Remote* events are forwarded directly to the TrackPlayer API.
 * RemoteDuck handles audio-focus loss (e.g. phone call, other app audio).
 * PlaybackQueueEnded restarts playback from the top when repeat=queue is set.
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

  // ── Audio focus / ducking ───────────────────────────────────────────────
  // ANY focus loss (phone call, WhatsApp call, navigation prompt, another
  // app starting playback) → pause and stay paused. We deliberately do NOT
  // auto-resume when focus comes back: the user explicitly asked that the
  // song should only resume when they tap play again, so a missed call or
  // a passing notification doesn't pop music back into their ear.
  TrackPlayer.addEventListener(
    Event.RemoteDuck,
    async ({ paused, permanent }: { paused: boolean; permanent: boolean }) => {
      if (permanent || paused) {
        await TrackPlayer.pause();
      }
      // paused === false (focus returned): intentionally a no-op.
    },
  );

  // ── Queue ended ─────────────────────────────────────────────────────────
  // RNTP fires this when the last track finishes and RepeatMode is Off.
  // When the user has set repeat=queue we restart from track 0 manually,
  // because RepeatMode.Queue in RNTP restarts automatically only in some
  // versions. We read the current repeat mode from TrackPlayer itself to
  // avoid importing the Zustand store (not available in headless context).
  TrackPlayer.addEventListener(Event.PlaybackQueueEnded, async () => {
    try {
      const repeatMode = await TrackPlayer.getRepeatMode();
      // RepeatMode.Queue === 2 in react-native-track-player v4
      if (repeatMode === 2) {
        await TrackPlayer.skip(0);
        await TrackPlayer.play();
      }
    } catch {
      // Queue may be empty or player may be in a bad state – ignore.
    }
  });
}
