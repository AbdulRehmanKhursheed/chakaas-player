/**
 * SleepTimer — singleton manager that pauses playback after a duration
 * or at the end of the current track.
 *
 * Two modes:
 *   - `duration`: setTimeout-based; over the final 30 s the volume is
 *     stepped down to zero, then playback is paused and volume restored.
 *   - `end-of-track`: subscribes to RNTP `Event.PlaybackTrackChanged` and
 *     pauses the very next time the active track index changes (or the
 *     queue ends).
 *
 * Active timer state is persisted to MMKV so the timer survives a JS
 * reload — on cold start, `resumeFromPersisted()` is called by the
 * TrackPlayerProvider and the remaining time is recomputed.
 *
 * Public API:
 *   SleepTimer.start(minutes)        // 5/15/30/45/60
 *   SleepTimer.startEndOfTrack()
 *   SleepTimer.cancel()
 *   SleepTimer.getRemainingMs()
 *   SleepTimer.subscribe(cb)         // returns unsubscribe
 *   SleepTimer.resumeFromPersisted() // call once at app boot
 */

import TrackPlayer, { Event } from 'react-native-track-player';
import { MMKV } from 'react-native-mmkv';
import { logger } from '@/utils/logger';

// ── Types ────────────────────────────────────────────────────────────────────

export type SleepTimerMode = 'duration' | 'end-of-track' | null;

export interface SleepTimerState {
  isActive: boolean;
  mode: SleepTimerMode;
  remainingMs: number;
  totalMs: number;
}

type Listener = (state: SleepTimerState) => void;

interface PersistedState {
  mode: 'duration' | 'end-of-track';
  /** Wall-clock ms at which the timer should fire. */
  endsAtEpochMs: number;
  totalMs: number;
}

/**
 * Validate that a value parsed from MMKV matches the `PersistedState` shape
 * we expect. MMKV can hold leftovers from older app versions or corrupted
 * writes; without this guard, `JSON.parse` returning `{}` or an array would
 * propagate `undefined` into arithmetic and produce NaN timeouts.
 */
function isPersistedState(value: unknown): value is PersistedState {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  const modeOk = v.mode === 'duration' || v.mode === 'end-of-track';
  const endsAtOk =
    typeof v.endsAtEpochMs === 'number' && Number.isFinite(v.endsAtEpochMs);
  const totalOk =
    typeof v.totalMs === 'number' && Number.isFinite(v.totalMs);
  return modeOk && endsAtOk && totalOk;
}

// ── Storage ──────────────────────────────────────────────────────────────────

const storage = new MMKV({ id: 'chakaas-sleep-timer' });
const STORAGE_KEY = 'sleep_timer_state';

function persist(state: PersistedState | null): void {
  try {
    if (state) {
      storage.set(STORAGE_KEY, JSON.stringify(state));
    } else {
      storage.delete(STORAGE_KEY);
    }
  } catch {
    // Persistence is best-effort.
  }
}

function loadPersisted(): PersistedState | null {
  try {
    const raw = storage.getString(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isPersistedState(parsed)) {
      // Corrupted or legacy shape — drop it so we don't crash later.
      try { storage.delete(STORAGE_KEY); } catch { /* ignore */ }
      return null;
    }
    return parsed;
  } catch {
    // Bad JSON — wipe it so subsequent boots aren't poisoned.
    try { storage.delete(STORAGE_KEY); } catch { /* ignore */ }
    return null;
  }
}

// ── Constants ────────────────────────────────────────────────────────────────

const FADE_LEAD_MS = 30_000; // last 30 s — volume fade
const FADE_STEPS = 30;
const TICK_INTERVAL_MS = 1_000;

// ── Implementation ───────────────────────────────────────────────────────────

class SleepTimerManager {
  private listeners = new Set<Listener>();
  private mode: SleepTimerMode = null;
  private totalMs = 0;
  private endsAtEpochMs = 0;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private fadeStartTimer: ReturnType<typeof setTimeout> | null = null;
  private fadeInterval: ReturnType<typeof setInterval> | null = null;
  private finalTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * EOT subscriptions: we listen on BOTH `PlaybackActiveTrackChanged` AND
   * `PlaybackQueueEnded`. If the queue is a single track (or the user is on
   * the last track with repeat=off), the active-track-changed event never
   * fires when the song ends — only `PlaybackQueueEnded` does — and without
   * this second listener the EOT timer would silently never trigger.
   */
  private eotSubscriptions: Array<{ remove: () => void }> = [];
  private savedVolume = 1;
  /**
   * True only once `beginFadeOut` has actually grabbed the current volume
   * and started lowering it. Without this flag, cancelling a fresh timer
   * before any fade has occurred would still call `setVolume(savedVolume)`
   * — but `savedVolume` is its default 1.0, which would *overwrite* the
   * user's chosen volume.
   */
  private fadeStarted = false;

  // ── Public API ──────────────────────────────────────────────────────────

  start(minutes: number): void {
    this.cancel();
    const ms = Math.max(0, Math.round(minutes * 60_000));
    if (ms <= 0) return;

    this.mode = 'duration';
    this.totalMs = ms;
    this.endsAtEpochMs = Date.now() + ms;
    this.scheduleDurationFlow(ms);

    persist({ mode: 'duration', endsAtEpochMs: this.endsAtEpochMs, totalMs: ms });
    this.publish();
    this.startTicker();
    logger.info('[SleepTimer] started duration timer:', minutes, 'min');
  }

  startEndOfTrack(): void {
    this.cancel();
    this.mode = 'end-of-track';
    this.totalMs = 0;
    this.endsAtEpochMs = 0;

    const onTrackEnd = () => {
      // Fired whenever the active track changes — which is what we want:
      // when the current track finishes naturally, RNTP advances and we pause.
      void this.fireEndOfTrack();
    };

    this.eotSubscriptions = [
      TrackPlayer.addEventListener(
        Event.PlaybackActiveTrackChanged,
        onTrackEnd,
      ),
      // Single-track queues (or last track w/ repeat=off) never fire an
      // ActiveTrackChanged event — only QueueEnded — so we must listen
      // to both to be sure the timer trips at end of playback.
      TrackPlayer.addEventListener(
        Event.PlaybackQueueEnded,
        onTrackEnd,
      ),
    ];

    persist({ mode: 'end-of-track', endsAtEpochMs: 0, totalMs: 0 });
    this.publish();
    logger.info('[SleepTimer] started end-of-track timer');
  }

  cancel(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    if (this.fadeStartTimer) {
      clearTimeout(this.fadeStartTimer);
      this.fadeStartTimer = null;
    }
    if (this.fadeInterval) {
      clearInterval(this.fadeInterval);
      this.fadeInterval = null;
    }
    if (this.finalTimer) {
      clearTimeout(this.finalTimer);
      this.finalTimer = null;
    }
    if (this.eotSubscriptions.length > 0) {
      for (const sub of this.eotSubscriptions) {
        try { sub.remove(); } catch { /* ignore */ }
      }
      this.eotSubscriptions = [];
    }

    // Restore the volume ONLY if we actually started fading. Without the
    // `fadeStarted` guard, cancelling a freshly-armed timer would push
    // `setVolume(savedVolume=1)` and overwrite the user's chosen level.
    if (this.mode === 'duration' && this.fadeStarted && this.savedVolume > 0) {
      void TrackPlayer.setVolume(this.savedVolume).catch(() => {});
    }
    this.fadeStarted = false;

    const wasActive = this.mode !== null;
    this.mode = null;
    this.totalMs = 0;
    this.endsAtEpochMs = 0;

    persist(null);
    if (wasActive) {
      this.publish();
      logger.info('[SleepTimer] cancelled');
    }
  }

  getRemainingMs(): number {
    if (this.mode !== 'duration') return 0;
    return Math.max(0, this.endsAtEpochMs - Date.now());
  }

  getState(): SleepTimerState {
    return {
      isActive: this.mode !== null,
      mode: this.mode,
      remainingMs: this.getRemainingMs(),
      totalMs: this.totalMs,
    };
  }

  subscribe(cb: Listener): () => void {
    this.listeners.add(cb);
    // Push the current state immediately so subscribers don't sit on a stale
    // initial value before the first tick.
    cb(this.getState());
    return () => {
      this.listeners.delete(cb);
    };
  }

  /**
   * Called once at app boot. If a duration timer was active before reload,
   * resume it with the remaining time (or fire immediately if already past).
   * End-of-track timers are not resumed since the track context is gone.
   */
  resumeFromPersisted(): void {
    const persisted = loadPersisted();
    if (!persisted) return;

    if (persisted.mode === 'end-of-track') {
      // The track changed during the reload — safest to clear and let the
      // user re-arm if they still want it.
      persist(null);
      return;
    }

    const remaining = persisted.endsAtEpochMs - Date.now();
    if (remaining <= 0) {
      // Already expired during the reload — fire the final action.
      this.mode = 'duration';
      this.totalMs = persisted.totalMs;
      this.endsAtEpochMs = persisted.endsAtEpochMs;
      void this.fireFinalPause();
      return;
    }

    this.mode = 'duration';
    this.totalMs = persisted.totalMs;
    this.endsAtEpochMs = persisted.endsAtEpochMs;
    this.scheduleDurationFlow(remaining);
    this.publish();
    this.startTicker();
    logger.info('[SleepTimer] resumed duration timer with', remaining, 'ms left');
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private scheduleDurationFlow(remainingMs: number): void {
    const fadeDelay = Math.max(0, remainingMs - FADE_LEAD_MS);
    const fadeWindow = Math.min(FADE_LEAD_MS, remainingMs);

    this.fadeStartTimer = setTimeout(() => {
      void this.beginFadeOut(fadeWindow);
    }, fadeDelay);

    this.finalTimer = setTimeout(() => {
      void this.fireFinalPause();
    }, remainingMs);
  }

  private async beginFadeOut(windowMs: number): Promise<void> {
    try {
      // RNTP doesn't expose getVolume on every version — fall back to 1.
      const tp = TrackPlayer as unknown as { getVolume?: () => Promise<number> };
      this.savedVolume = typeof tp.getVolume === 'function'
        ? await tp.getVolume()
        : 1;
    } catch {
      this.savedVolume = 1;
    }
    // Marker for `cancel()` so it knows there's a non-default volume to
    // restore — we set it AFTER the volume read so a thrown read doesn't
    // mis-arm the restore path with a stale savedVolume.
    this.fadeStarted = true;

    const stepMs = Math.max(50, Math.floor(windowMs / FADE_STEPS));
    let step = 0;
    this.fadeInterval = setInterval(() => {
      step += 1;
      const ratio = Math.max(0, 1 - step / FADE_STEPS);
      void TrackPlayer.setVolume(this.savedVolume * ratio).catch(() => {});
      if (step >= FADE_STEPS) {
        if (this.fadeInterval) {
          clearInterval(this.fadeInterval);
          this.fadeInterval = null;
        }
      }
    }, stepMs);
  }

  private async fireFinalPause(): Promise<void> {
    try {
      await TrackPlayer.pause();
    } catch {
      // RNTP may not be ready — ignore.
    }
    // Restore the original volume so the next manual play isn't silent.
    try {
      await TrackPlayer.setVolume(this.savedVolume || 1);
    } catch {
      // ignore
    }
    this.cancel();
  }

  private async fireEndOfTrack(): Promise<void> {
    try {
      await TrackPlayer.pause();
    } catch {
      // ignore
    }
    this.cancel();
  }

  private startTicker(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = setInterval(() => {
      this.publish();
      if (this.mode === 'duration' && this.getRemainingMs() <= 0) {
        if (this.tickTimer) {
          clearInterval(this.tickTimer);
          this.tickTimer = null;
        }
      }
    }, TICK_INTERVAL_MS);
  }

  private publish(): void {
    const snapshot = this.getState();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (err) {
        logger.warn('[SleepTimer] listener error:', err);
      }
    }
  }
}

export const SleepTimer = new SleepTimerManager();
