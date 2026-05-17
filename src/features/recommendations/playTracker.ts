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
import type { Track } from '@/db/models/Track';
import { bumpArtistFromPlay } from './artistAffinity';
import { addToSkipMemory, removeFromSkipMemory } from './skipMemory';
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
 *
 * `treatAsSkipCandidate` — when false, we never mark this play as a skip,
 * regardless of position. Used by the AppState background flush where the
 * user may have simply paused; pausing-then-backgrounding shouldn't pollute
 * skip memory or count as a skipped play.
 */
async function flushLastPlay(
  positionSec: number,
  treatAsSkipCandidate: boolean = true,
): Promise<void> {
  if (!lastTrack) return;
  const { id, artist, durationSec } = lastTrack;
  lastTrack = null;

  try {
    const completionRatio =
      durationSec > 0 ? Math.min(1, Math.max(0, positionSec / durationSec)) : 0;
    // Only count as a skip when:
    //   1. The caller permits it (AppState background flushes do NOT — the
    //      user may just have paused), AND
    //   2. The user actually heard at least a second of the track. RNTP can
    //      fire `PlaybackActiveTrackChanged` with `lastPosition === 0` on
    //      auto-advance (queue stepped to the next track before the previous
    //      one's position event landed), which previously marked
    //      perfectly-played tracks as skips and polluted skip memory.
    const wasSkipped =
      treatAsSkipCandidate && positionSec > 1 && completionRatio < 0.3;

    // 1. Persist a Plays row + bump denormalised play_count (best-effort).
    //    Skips (completion < 0.3) still write the Plays row so the engine has
    //    skip signal, but do NOT bump play_count — that surface is meant for
    //    "songs you actually listened to".
    let trackRef: Track | null = null;
    try {
      const track = await tracksCollection.find(id).catch(() => null) as Track | null;
      trackRef = track;
      if (track) {
        await database.write(async () => {
          await playsCollection.create((play) => {
            (play as unknown as {
              trackId: string;
              playedAt: number;
              durationPlayedMs: number;
              completionRatio: number;
              wasSkipped: boolean;
            }).trackId = id;
            const p = play as unknown as {
              trackId: string;
              playedAt: number;
              durationPlayedMs: number;
              completionRatio: number;
              wasSkipped: boolean;
            };
            p.playedAt = Math.floor(Date.now() / 1000);
            p.durationPlayedMs = Math.round(positionSec * 1000);
            p.completionRatio = completionRatio;
            p.wasSkipped = wasSkipped;
          });

          if (!wasSkipped) {
            await track.update((t) => {
              t.playCount = (t.playCount ?? 0) + 1;
            });
          }
        });
      }
    } catch (err) {
      logger.warn('[playTracker] Could not write Plays row:', err);
    }

    // 1b. Record skip memory so the Discover engine never recommends this
    //     track again. Library tracks the user themselves added are already
    //     filtered out of recommendations via the library fingerprint, but
    //     we still record the skip so the cross-source dedupe (same song,
    //     different Saavn id) catches it too.
    //
    //     Conversely, when the track played through to completion we
    //     proactively clear any prior skip entry — the user changed their
    //     mind, and we shouldn't quietly keep a perfectly-loved song out of
    //     Discover forever.
    if (wasSkipped && trackRef) {
      try {
        addToSkipMemory({
          id: trackRef.saavnId ?? trackRef.youtubeId ?? null,
          source: trackRef.source ?? null,
          title: trackRef.title,
          artist: trackRef.artist,
        });
      } catch (err) {
        logger.warn('[playTracker] Could not add to skip memory:', err);
      }
    } else if (!wasSkipped && trackRef) {
      try {
        removeFromSkipMemory({
          id: trackRef.saavnId ?? trackRef.youtubeId ?? null,
          source: trackRef.source ?? null,
          title: trackRef.title,
          artist: trackRef.artist,
        });
      } catch (err) {
        logger.warn('[playTracker] Could not remove from skip memory:', err);
      }
    }

    // 2. Update artist affinity (MMKV write — guarded against storage errors).
    try {
      bumpArtistFromPlay(artist, completionRatio, wasSkipped);
    } catch (err) {
      logger.warn('[playTracker] Could not bump artist affinity:', err);
    }

    logger.info(
      `[playTracker] Logged play: artist="${artist}" ` +
      `completion=${(completionRatio * 100).toFixed(0)}% skipped=${wasSkipped}`,
    );
  } catch (err) {
    logger.warn('[playTracker] flushLastPlay failed:', err);
  }
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
      try {
        const { track, lastPosition } = event as {
          track?: { id?: string; artist?: string; duration?: number } | null;
          lastPosition?: number;
        };
        const position =
          typeof lastPosition === 'number' && lastPosition >= 0
            ? lastPosition
            : 0;
        await flushLastPlay(position);

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
      } catch (err) {
        logger.warn('[playTracker] PlaybackActiveTrackChanged handler error:', err);
      }
    },
  );

  const queueEndedSub = TrackPlayer.addEventListener(
    Event.PlaybackQueueEnded,
    async () => {
      try {
        if (lastTrack) {
          await flushLastPlay(lastTrack.durationSec);
        }
      } catch (err) {
        logger.warn('[playTracker] PlaybackQueueEnded handler error:', err);
      }
    },
  );

  // Flush on app background so the final session-ending play is recorded
  // even when the user kills the app on the last song.
  //
  // IMPORTANT: pass `treatAsSkipCandidate=false`. If the user simply paused
  // mid-song and backgrounded, their play position would otherwise compute
  // completionRatio < 0.3 and be wrongly recorded as a skip — polluting
  // skipMemory and suppressing the song from future Discover recommendations.
  // The skip signal is owned solely by the `PlaybackActiveTrackChanged` path
  // where we know the user actually advanced the queue.
  const appStateSub = AppState.addEventListener('change', async (state) => {
    if (state !== 'active' && lastTrack) {
      try {
        const progress = await TrackPlayer.getProgress();
        await flushLastPlay(progress.position, false);
      } catch {
        await flushLastPlay(0, false);
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
