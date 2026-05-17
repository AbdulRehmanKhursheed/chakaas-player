/**
 * CrossfadeManager — JS-side approximation of crossfade for RNTP.
 *
 * react-native-track-player has no native crossfade. We approximate by:
 *   1. Watching `Event.PlaybackProgressUpdated` (1 Hz from
 *      `progressUpdateEventInterval`).
 *   2. When the current track gets within `crossfadeMs` of the end AND
 *      there is a next track in the queue, fade volume down in a small
 *      number of stepped `setVolume` calls (no JS timer storm).
 *   3. Skip to next, then fade volume back up over ~1 s.
 *
 * Settings are read live from `useSettingsStore` so toggles take effect
 * without needing to reinitialise.
 *
 * Public API:
 *   CrossfadeManager.setupCrossfade()  // idempotent
 *   CrossfadeManager.dispose()
 */

import TrackPlayer, { Event } from 'react-native-track-player';
import { useSettingsStore } from '@/stores/settingsStore';
import { logger } from '@/utils/logger';
import { SleepTimer } from './SleepTimer';

/**
 * SleepTimer runs its own 30-second volume fade during the final lead-in to a
 * pause. If a crossfade window overlaps that fade, our snapshot of the
 * "saved volume" captures SleepTimer's already-ducked value (e.g. 0.3) and
 * restores playback to that ducked level forever. Within this window we bail
 * out of the crossfade entirely and just do an instant `skipToNext` so
 * SleepTimer owns the volume.
 */
const SLEEP_TIMER_FADE_GUARD_MS = 35_000;

// ── Constants ───────────────────────────────────────────────────────────────

const FADE_STEPS = 5;
const FADE_STEP_MS = 200; // 5 × 200 = 1 s fade window
const FADE_UP_TOTAL_MS = 1_000;

// ── State ───────────────────────────────────────────────────────────────────

let progressSub: { remove: () => void } | null = null;
let trackChangeSub: { remove: () => void } | null = null;
let isFading = false;
let lastFadeAtTrackIndex: number | null = null;
let savedVolume = 1;
/**
 * Per-`setupCrossfade` epoch. Incremented every time the manager is disposed.
 * The `fadeOutAndSkip` async loop checks this epoch between every step so a
 * `dispose()` call (e.g. the user toggling crossfade OFF mid-fade) actually
 * stops the in-flight fade instead of letting it run to completion — which
 * previously would still call `skipToNext()` and finish the fade even though
 * the user just turned the feature off.
 */
let fadeEpoch = 0;

// ── Helpers ─────────────────────────────────────────────────────────────────

async function readVolume(): Promise<number> {
  try {
    const tp = TrackPlayer as unknown as { getVolume?: () => Promise<number> };
    if (typeof tp.getVolume === 'function') return await tp.getVolume();
  } catch {
    // ignore
  }
  return 1;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fadeOutAndSkip(): Promise<void> {
  if (isFading) return;

  // Defer to SleepTimer when it's already fading out the final 30 seconds
  // of playback. Reading the volume now would snapshot SleepTimer's ducked
  // value and we'd restore to that level forever after the crossfade.
  // Instead, just skip immediately and leave volume to SleepTimer.
  const sleepState = SleepTimer.getState();
  if (
    sleepState.isActive &&
    sleepState.mode === 'duration' &&
    sleepState.remainingMs > 0 &&
    sleepState.remainingMs <= SLEEP_TIMER_FADE_GUARD_MS
  ) {
    try {
      await TrackPlayer.skipToNext();
    } catch {
      // No next track or RNTP not ready — nothing to do.
    }
    return;
  }

  isFading = true;
  // Snapshot the epoch at fade start. If `dispose()` is called mid-fade the
  // epoch is bumped, our `aborted` checks fire, and we bail out — restoring
  // the user's volume — instead of running the fade to completion and
  // (worse) calling `skipToNext()` after the user already disabled the
  // feature.
  const myEpoch = fadeEpoch;
  const aborted = (): boolean => myEpoch !== fadeEpoch;

  // Capture the active track index at fade start. If it changes during the
  // fade window (because the user tapped MiniPlayer.skipToNext or the like),
  // we must NOT call skipToNext ourselves — the user already advanced the
  // queue. Doing both would skip TWO tracks.
  let startIdx: number | null = null;
  try {
    try {
      const idx = await TrackPlayer.getActiveTrackIndex();
      if (typeof idx === 'number') startIdx = idx;
    } catch {
      // ignore — startIdx stays null, treat as "unknown" and skip safely.
    }
    savedVolume = await readVolume();
    for (let step = 1; step <= FADE_STEPS; step++) {
      if (aborted()) {
        await TrackPlayer.setVolume(savedVolume).catch(() => {});
        return;
      }
      const ratio = 1 - step / FADE_STEPS;
      await TrackPlayer.setVolume(savedVolume * ratio).catch(() => {});
      await delay(FADE_STEP_MS);
    }

    if (aborted()) {
      await TrackPlayer.setVolume(savedVolume).catch(() => {});
      return;
    }

    // Re-check the active index. If the user's manual skip already advanced
    // the queue, the index will differ — restore volume and exit without
    // calling skipToNext (it would skip the new song too).
    let userSkipped = false;
    try {
      const nowIdx = await TrackPlayer.getActiveTrackIndex();
      if (
        typeof nowIdx === 'number' &&
        startIdx !== null &&
        nowIdx !== startIdx
      ) {
        userSkipped = true;
      }
    } catch {
      // ignore — fall through to attempt skipToNext.
    }

    if (userSkipped) {
      await TrackPlayer.setVolume(savedVolume).catch(() => {});
      return;
    }

    try {
      await TrackPlayer.skipToNext();
    } catch {
      // No next track — restore volume and bail.
      await TrackPlayer.setVolume(savedVolume).catch(() => {});
      return;
    }
    // Fade back up over ~1 s, stepped.
    const upSteps = FADE_STEPS;
    const upStepMs = FADE_UP_TOTAL_MS / upSteps;
    for (let step = 1; step <= upSteps; step++) {
      if (aborted()) {
        await TrackPlayer.setVolume(savedVolume).catch(() => {});
        return;
      }
      const ratio = step / upSteps;
      await TrackPlayer.setVolume(savedVolume * ratio).catch(() => {});
      await delay(upStepMs);
    }
  } catch (err) {
    logger.warn('[CrossfadeManager] fade error:', err);
    await TrackPlayer.setVolume(savedVolume).catch(() => {});
  } finally {
    isFading = false;
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

export const CrossfadeManager = {
  setupCrossfade(): void {
    if (progressSub != null) return; // already set up

    progressSub = TrackPlayer.addEventListener(
      Event.PlaybackProgressUpdated,
      async (data) => {
        const { crossfadeEnabled, crossfadeMs } = useSettingsStore.getState();
        if (!crossfadeEnabled) return;
        if (isFading) return;

        const position = typeof data.position === 'number' ? data.position : 0;
        const duration = typeof data.duration === 'number' ? data.duration : 0;
        if (duration <= 0) return;

        const remainingMs = (duration - position) * 1000;
        if (remainingMs > crossfadeMs) return;

        // Only fade if there's a next track.
        try {
          const activeIdx = await TrackPlayer.getActiveTrackIndex();
          if (typeof activeIdx !== 'number') return;
          const queue = await TrackPlayer.getQueue();
          if (activeIdx + 1 >= queue.length) return;

          // De-dupe — Progress fires several times within the final window.
          if (lastFadeAtTrackIndex === activeIdx) return;
          lastFadeAtTrackIndex = activeIdx;

          await fadeOutAndSkip();
        } catch (err) {
          logger.warn('[CrossfadeManager] progress handler error:', err);
        }
      },
    );

    // Reset the de-dup guard whenever the active track actually changes.
    trackChangeSub = TrackPlayer.addEventListener(
      Event.PlaybackActiveTrackChanged,
      () => {
        lastFadeAtTrackIndex = null;
      },
    );

    logger.info('[CrossfadeManager] setup complete');
  },

  dispose(): void {
    if (progressSub) {
      progressSub.remove();
      progressSub = null;
    }
    if (trackChangeSub) {
      trackChangeSub.remove();
      trackChangeSub = null;
    }
    // Bump the epoch so any in-flight `fadeOutAndSkip` aborts at its next
    // checkpoint. Without this, toggling crossfade OFF mid-fade would let
    // the loop run to completion — fading to silence, calling
    // `skipToNext()`, then fading back up — even though the user just
    // disabled the feature.
    fadeEpoch += 1;
    // Best-effort volume restore in case the abort happens before the
    // in-flight fade's own `aborted()` check sees it. Cheap and idempotent
    // (the fade loop also restores).
    if (isFading) {
      void TrackPlayer.setVolume(savedVolume).catch(() => {});
    }
    lastFadeAtTrackIndex = null;
    isFading = false;
    logger.info('[CrossfadeManager] disposed');
  },

  isActive(): boolean {
    return progressSub != null;
  },
};
