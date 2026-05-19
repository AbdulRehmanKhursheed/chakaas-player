import { create } from 'zustand';
import { MMKV } from 'react-native-mmkv';

// ── MMKV instance ────────────────────────────────────────────────────────────
export const settingsStorage = new MMKV({ id: 'chakaas-settings' });

const STORAGE_KEY = 'settings';

// ── Types ────────────────────────────────────────────────────────────────────
export type DownloadQuality = '128k' | '192k' | '256k' | '320k';

export interface Settings {
  downloadQuality: DownloadQuality;
  /**
   * NOTE (stability hardening, May 2026): `downloadOnWifiOnly` is currently
   * informational — the DownloadManager does NOT yet enforce a wifi check
   * before kicking off the worker pool. Enforcement requires a NetInfo /
   * expo-network native module which isn't part of the current dev-client
   * build; adding it here would require a fresh APK rebuild that the user
   * can't do mid-session. Tracked for the next build; until then this flag
   * is a no-op the UI still surfaces.
   */
  downloadOnWifiOnly: boolean;
  dailyPicksEnabled: boolean;
  dailyPicksTime: string; // "HH:MM", e.g. "03:00"
  storageLocation: string;
  /** Legacy seconds-based crossfade duration. Kept for backwards-compat. */
  crossfadeDuration: number; // seconds, 0-12
  normalizationEnabled: boolean;
  // ── Premium-player additions ───────────────────────────────────────────
  /** When true, fade between tracks using the JS-side CrossfadeManager. */
  crossfadeEnabled: boolean;
  /** Crossfade window in ms. Snap values: 1000/2000/4000/6000/8000/12000. */
  crossfadeMs: number;
  /** When true, NowPlaying + MiniPlayer tint from album art; else stays gold. */
  albumColorThemingEnabled: boolean;
  /** Default sleep-timer behaviour: pause after current track when armed. */
  sleepTimerEndOfTrack: boolean;
}

// ── Defaults ─────────────────────────────────────────────────────────────────
const DEFAULT_SETTINGS: Settings = {
  downloadQuality: '320k',
  downloadOnWifiOnly: true,
  dailyPicksEnabled: true,
  dailyPicksTime: '03:00',
  storageLocation: '',
  crossfadeDuration: 3,
  normalizationEnabled: true,
  crossfadeEnabled: false,
  crossfadeMs: 4000,
  albumColorThemingEnabled: true,
  sleepTimerEndOfTrack: false,
};

// ── Persistence helpers ───────────────────────────────────────────────────────
function loadFromMMKV(): Settings {
  try {
    const raw = settingsStorage.getString(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveToMMKV(settings: Settings): void {
  try {
    settingsStorage.set(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Fail silently — settings still work in-memory for the session.
  }
}

// ── Store ────────────────────────────────────────────────────────────────────
interface SettingsStore extends Settings {
  updateSettings(patch: Partial<Settings>): void;

  setDownloadQuality(quality: DownloadQuality): void;
  setDownloadOnWifiOnly(value: boolean): void;
  setDailyPicksEnabled(value: boolean): void;
  setDailyPicksTime(time: string): void;
  setStorageLocation(location: string): void;
  setCrossfadeDuration(seconds: number): void;
  setNormalizationEnabled(value: boolean): void;
  setCrossfadeEnabled(value: boolean): void;
  setCrossfadeMs(ms: number): void;
  setAlbumColorThemingEnabled(value: boolean): void;
  setSleepTimerEndOfTrack(value: boolean): void;

  resetToDefaults(): void;
}

/** Pluck just the Settings fields from the store (drops setter refs). */
function pickSettings(store: SettingsStore): Settings {
  return {
    downloadQuality: store.downloadQuality,
    downloadOnWifiOnly: store.downloadOnWifiOnly,
    dailyPicksEnabled: store.dailyPicksEnabled,
    dailyPicksTime: store.dailyPicksTime,
    storageLocation: store.storageLocation,
    crossfadeDuration: store.crossfadeDuration,
    normalizationEnabled: store.normalizationEnabled,
    crossfadeEnabled: store.crossfadeEnabled,
    crossfadeMs: store.crossfadeMs,
    albumColorThemingEnabled: store.albumColorThemingEnabled,
    sleepTimerEndOfTrack: store.sleepTimerEndOfTrack,
  };
}

export const useSettingsStore = create<SettingsStore>((set, get) => {
  const persisted = loadFromMMKV();

  /**
   * Apply a partial patch and persist asynchronously. Returns the patch so
   * `set` can shallow-merge ONLY the changed fields — selectors for fields
   * that weren't touched never run their equality check and aren't notified.
   * Persist still snapshots the full Settings object after the merge.
   */
  function applyAndPersist(patch: Partial<Settings>): Partial<Settings> {
    // Build full snapshot for MMKV from the current store + patch. We can't
    // read `get()` AFTER calling `set` here because we're inside the set
    // callback in callers — instead callers pass the patch and we merge it
    // with the current store snapshot for persistence purposes.
    const snapshot = { ...pickSettings(get()), ...patch };
    saveToMMKV(snapshot);
    return patch;
  }

  return {
    ...persisted,

    updateSettings: (patch) => set(applyAndPersist(patch)),

    setDownloadQuality: (quality) =>
      set(applyAndPersist({ downloadQuality: quality })),

    setDownloadOnWifiOnly: (value) =>
      set(applyAndPersist({ downloadOnWifiOnly: value })),

    setDailyPicksEnabled: (value) =>
      set(applyAndPersist({ dailyPicksEnabled: value })),

    setDailyPicksTime: (time) =>
      set(applyAndPersist({ dailyPicksTime: time })),

    setStorageLocation: (location) =>
      set(applyAndPersist({ storageLocation: location })),

    setCrossfadeDuration: (seconds) =>
      set(
        applyAndPersist({
          crossfadeDuration: Math.min(12, Math.max(0, seconds)),
        }),
      ),

    setNormalizationEnabled: (value) =>
      set(applyAndPersist({ normalizationEnabled: value })),

    setCrossfadeEnabled: (value) =>
      set(applyAndPersist({ crossfadeEnabled: value })),

    setCrossfadeMs: (ms) =>
      set(
        applyAndPersist({
          crossfadeMs: Math.min(12000, Math.max(1000, Math.round(ms))),
        }),
      ),

    setAlbumColorThemingEnabled: (value) =>
      set(applyAndPersist({ albumColorThemingEnabled: value })),

    setSleepTimerEndOfTrack: (value) =>
      set(applyAndPersist({ sleepTimerEndOfTrack: value })),

    resetToDefaults: () => {
      saveToMMKV(DEFAULT_SETTINGS);
      set(DEFAULT_SETTINGS);
    },
  };
});
