/**
 * playTracker — feeds the artist-affinity engine with real listening data.
 *
 * RNTP fires `Event.PlaybackActiveTrackChanged` whenever the active track
 * changes (skip, next, previous, queue advance). At that moment we know:
 *   - which track was just playing  (`lastTrack` ref)
 *   - the position it was at        (`TrackPlayer.getProgress()`)
 *   - the duration                  (from the track metadata)
 *
 * From that we compute completionRatio = position / duration and feed it to
 * `bumpArtistFromPlay`. We also write a Plays row so MostPlayed / RecentlyPlayed
 * surfaces stay accurate.
 *
 * Why a module-level subscription (not a hook):
 *   We want this to fire even when no React component is mounted on the
 *   foreground (e.g. screen off, MiniPlayer hidden). A single module-level
 *   listener registered at app boot is the cleanest way to guarantee that.
 */
import { AppState } from 'react-native';
import TrackPlayer, { Event } from 'react-native-track-player';
import { database, playsCollection, tracksCollection } from '@/db';
import { Q } from '@nozbe/watermelondb';
import { bumpArtistFromPlay } from './artistAffinity';
import { logger } from '@/utils/logger';

interface LastTrackSnapshot {
  /** RNTP track id — matches our DB Track.id when added via trackMapper. */
  id: string;
  artist: string;
  durationSec: number;
}

let lastTrack: LastTrackSnapshot | null = null;
let unsubscribe: (() => void) | null = null;

/**
 * Records a finished/skipped play event for the previously active track.
 * Called both by the active-track-changed event and on queue-ended.
 */
async function flushLastPlay(positionSec: number): Promise<void> {
  if (!lastTrack) return;
  const { id, artist, durationSec } = lastTrack;
  lastTrack = null;

  const completionRatio =
    durationSec > 0 ? Math.min(1, Math.max(0, positionSec / durationSec)) : 0;
  // Heuristic: if user moved on with > 30% played, treat as a real listen.
  // < 30% with the user advancing is a skip.
  const wasSkipped = completionRatio < 0.3;

  // 1. Persist a Plays row (best-effort; failure is non-fatal).
  try {
    const tracks = await tracksCollection.query(Q.where('id', id)).fetch();
    if (tracks.length > 0) {
      await database.write(async () => {
        await playsCollection.create((play) => {
          (play as any).trackId = id;
          (play as any).playedAt = Math.floor(Date.now() / 1000);
          (play as any).durationPlayedMs = Math.round(positionSec * 1000);
          (play as any).completionRatio = completionRatio;
          (play as any).wasSkipped = wasSkipped;
        });
      });
    }
  } catch (err) {
    logger.warn('[playTracker] Could not write Plays row:', err);
  }

  // 2. Update artist affinity.
  bumpArtistFromPlay(artist, completionRatio, wasSkipped);
  logger.info(
    `[playTracker] Logged play: artist="${artist}" ` +
    `completion=${(completionRatio * 100).toFixed(0)}% skipped=${wasSkipped}`,
  );
}

/**
 * Begin listening for RNTP track-change events. Idempotent — calling twice
 * returns the same teardown function.
 */
export function startPlayTracker(): () => void {
  if (unsubscribe) return unsubscribe;

  const sub = TrackPlayer.addEventListener(
    Event.PlaybackActiveTrackChanged,
    async (event) => {
      const { track, lastPosition } = event as {
        track?: { id?: string; artist?: string; duration?: number } | null;
        lastPosition?: number;
      };
      // Flush the previously active track first.
      const position =
        typeof lastPosition === 'number' && lastPosition >= 0
          ? lastPosition
          : 0;
      await flushLastPlay(position);

      // Capture the new active track.
      if (track && typeof track.id === 'string') {
        lastTrack = {
          id: track.id,
          artist: typeof track.artist === 'string' ? track.artist : 'Unknown Artist',
          durationSec:
            typeof track.duration === 'number' && track.duration > 0
              ? track.duration
              : 0,
        };
      } else {
        lastTrack = null;
      }
    },
  );

  const queueEndedSub = TrackPlayer.addEventListener(
    Event.PlaybackQueueEnded,
    async () => {
      // Queue ran out → the last track played to its end.
      if (lastTrack) {
        await flushLastPlay(lastTrack.durationSec);
      }
    },
  );

  // Flush on app background so the final session-ending play is recorded
  // even when the user kills the app on the last song.
  const appStateSub = AppState.addEventListener('change', async (state) => {
    if (state !== 'active' && lastTrack) {
      try {
        const progress = await TrackPlayer.getProgress();
        await flushLastPlay(progress.position);
      } catch {
        await flushLastPlay(0);
      }
    }
  });

  unsubscribe = () => {
    sub.remove();
    queueEndedSub.remove();
    appStateSub.remove();
    unsubscribe = null;
    lastTrack = null;
  };
  return unsubscribe;
}
