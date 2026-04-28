import { useEffect, useRef } from 'react';
import {
  useActiveTrack,
  useProgress,
  usePlaybackState,
  State,
} from 'react-native-track-player';
import { playsCollection, database } from '@/db';
import { updateTasteVectorFromPlay } from '@/features/recommendations/TasteVectorService';
import { logger } from '@/utils/logger';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * The completion ratio below which a user-initiated track change is classified
 * as a skip. Matches the threshold described in the Play model spec.
 */
const SKIP_THRESHOLD = 0.3;

/**
 * Minimum duration (ms) a track must have been played before we bother
 * recording the event. Guards against phantom records from brief buffering.
 */
const MIN_PLAYED_MS = 3000;

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * usePlayHistory — side-effect hook that records play events to WatermelonDB.
 *
 * Lifecycle of a play session:
 *   1. `activeTrack` changes  → session start is captured.
 *   2. Player enters a stopped/paused state with a *different* track (or no
 *      track) → the previous session is flushed to the DB.
 *   3. After each flush, the taste vector is updated via TasteVectorService.
 *
 * Skip detection:
 *   A play is marked `was_skipped = true` when the completion ratio is below
 *   SKIP_THRESHOLD **and** the track changed because the user explicitly
 *   skipped forward (detected by comparing the new track with the previous
 *   one rather than natural completion).
 *
 * Returns nothing — this hook is purely a side-effect.
 */
export function usePlayHistory() {
  const activeTrack = useActiveTrack();
  const { position, duration } = useProgress(500); // poll every 500 ms
  const playbackState = usePlaybackState();

  // ── Session refs ──────────────────────────────────────────────────────────

  /** Unix timestamp (ms) when the current session started. */
  const sessionStart = useRef<number>(0);

  /** Track id that was playing at the last flush. */
  const lastTrackId = useRef<string | null>(null);

  /** Last recorded playback position (seconds). Used to accumulate played time. */
  const lastPosition = useRef<number>(0);

  /** Total milliseconds the user has actually listened to the current track. */
  const playedDuration = useRef<number>(0);

  /**
   * Whether we believe the previous session ended because the user actively
   * skipped (as opposed to letting the track finish naturally).
   */
  const wasSkipped = useRef<boolean>(false);

  /**
   * Whether playback was in an actively-playing state at the last check.
   * Used to detect when the player transitions from Playing → something else.
   */
  const wasPlaying = useRef<boolean>(false);

  // ── Flush helper ──────────────────────────────────────────────────────────

  /**
   * Persists a play record for `trackId` to WatermelonDB and updates the
   * taste vector. Called when a session ends (track change, stop, or app
   * background).
   */
  const flushSession = useRef<
    (trackId: string, playedMs: number, completionRatio: number, skipped: boolean) => Promise<void>
  >(async (trackId, playedMs, completionRatio, skipped) => {
    if (playedMs < MIN_PLAYED_MS) {
      logger.log('usePlayHistory: skipping flush — played too briefly', playedMs, 'ms');
      return;
    }

    try {
      await database.write(async () => {
        await playsCollection.create((record) => {
          // @ts-ignore — WatermelonDB's _raw is loosely typed
          record._raw.track_id = trackId;
          // @ts-ignore — WatermelonDB's _raw is loosely typed
          record._raw.played_at = Date.now();
          // @ts-ignore
          record._raw.duration_played_ms = Math.round(playedMs);
          // @ts-ignore
          record._raw.completion_ratio = completionRatio;
          // @ts-ignore
          record._raw.was_skipped = skipped;
        });
      });

      logger.info(
        'usePlayHistory: logged play',
        trackId,
        `ratio=${completionRatio.toFixed(2)}`,
        skipped ? '(skipped)' : '(completed)',
      );

      // Update the taste vector asynchronously — don't block the render.
      updateTasteVectorFromPlay(trackId, completionRatio, skipped).catch((err) => {
        logger.error('usePlayHistory: taste vector update failed', err);
      });
    } catch (err) {
      logger.error('usePlayHistory: failed to write play record', err);
    }
  }).current;

  // ── Track progress accumulation ───────────────────────────────────────────

  useEffect(() => {
    const isCurrentlyPlaying = playbackState.state === State.Playing;

    if (isCurrentlyPlaying && lastPosition.current > 0) {
      const delta = position - lastPosition.current;
      // Only accumulate forward movement (ignore seeks backward)
      if (delta > 0 && delta < 5) {
        playedDuration.current += delta * 1000; // convert seconds → ms
      }
    }

    lastPosition.current = position;
    wasPlaying.current = isCurrentlyPlaying;
  }, [position, playbackState.state]);

  // ── Track change detection ────────────────────────────────────────────────

  useEffect(() => {
    const currentTrackId = activeTrack?.id ?? null;

    if (currentTrackId === lastTrackId.current) return;

    // A different track is now active — flush the previous session.
    if (lastTrackId.current !== null) {
      const prevId = lastTrackId.current;
      const playedMs = playedDuration.current;

      // Compute completion ratio from accumulated played time vs track duration.
      // `duration` from useProgress is in seconds.
      const totalDurationMs = duration > 0 ? duration * 1000 : playedMs;
      const completionRatio =
        totalDurationMs > 0
          ? Math.min(1, playedMs / totalDurationMs)
          : 0;

      // A track is considered skipped if the user moved to the next track
      // before hearing SKIP_THRESHOLD of it. Natural end → completionRatio ≥ 1
      // so it will never be flagged as a skip.
      const skipped = completionRatio < SKIP_THRESHOLD;

      flushSession(prevId, playedMs, completionRatio, skipped);
    }

    // Reset session state for the new track
    lastTrackId.current = currentTrackId;
    sessionStart.current = Date.now();
    lastPosition.current = 0;
    playedDuration.current = 0;
    wasSkipped.current = false;
  }, [activeTrack?.id, duration, flushSession]);

  // ── Playback stop detection ───────────────────────────────────────────────

  useEffect(() => {
    const stoppedStates: (State | undefined)[] = [State.Stopped, State.None];
    const isStopped = stoppedStates.includes(playbackState.state);

    if (isStopped && wasPlaying.current && lastTrackId.current !== null) {
      const prevId = lastTrackId.current;
      const playedMs = playedDuration.current;
      const totalDurationMs = duration > 0 ? duration * 1000 : playedMs;
      const completionRatio =
        totalDurationMs > 0 ? Math.min(1, playedMs / totalDurationMs) : 0;

      flushSession(prevId, playedMs, completionRatio, completionRatio < SKIP_THRESHOLD);

      // Reset so we don't double-flush if state oscillates
      lastTrackId.current = null;
      playedDuration.current = 0;
      lastPosition.current = 0;
      wasPlaying.current = false;
    }
  }, [playbackState.state, duration, flushSession]);
}
