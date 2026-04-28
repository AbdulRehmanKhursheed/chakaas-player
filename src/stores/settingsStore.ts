import { create } from 'zustand';
import { MMKV } from 'react-native-mmkv';

// ── MMKV instance ────────────────────────────────────────────────────────────
export const settingsStorage = new MMKV({ id: 'chakaas-settings' });

const STORAGE_KEY = 'settings';

// ── Types ────────────────────────────────────────────────────────────────────
export type DownloadQuality = '128k' | '192k' | '256k' | '320k';

export interface Settings {
  spotifyClientId: string;
  spotifyClientSecret: string;
  lastFmApiKey: string;
  downloadQuality: DownloadQuality;
  downloadOnWifiOnly: boolean;
  dailyPicksEnabled: boolean;
  dailyPicksTime: string; // "HH:MM", e.g. "03:00"
  storageLocation: string;
  crossfadeDuration: number; // seconds, 0-12
  normalizationEnabled: boolean;
}

// ── Defaults ─────────────────────────────────────────────────────────────────
const DEFAULT_SETTINGS: Settings = {
  spotifyClientId: '',
  spotifyClientSecret: '',
  lastFmApiKey: '',
  downloadQuality: '192k',
  downloadOnWifiOnly: true,
  dailyPicksEnabled: true,
  dailyPicksTime: '03:00',
  storageLocation: '',
  crossfadeDuration: 3,
  normalizationEnabled: true,
};

// ── Persistence helpers ───────────────────────────────────────────────────────
function loadFromMMKV(): Settings {
  try {
    const raw = settingsStorage.getString(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    // Merge with defaults so newly added fields are always present
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveToMMKV(settings: Settings): void {
  try {
    settingsStorage.set(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Fail silently — settings will still work in-memory for the session
  }
}

// ── Store ────────────────────────────────────────────────────────────────────
interface SettingsStore extends Settings {
  // Bulk update — merges partial settings into state and persists
  updateSettings(patch: Partial<Settings>): void;

  // Granular setters
  setSpotifyCredentials(clientId: string, clientSecret: string): void;
  setLastFmApiKey(apiKey: string): void;
  setDownloadQuality(quality: DownloadQuality): void;
  setDownloadOnWifiOnly(value: boolean): void;
  setDailyPicksEnabled(value: boolean): void;
  setDailyPicksTime(time: string): void;
  setStorageLocation(location: string): void;
  setCrossfadeDuration(seconds: number): void;
  setNormalizationEnabled(value: boolean): void;

  // Reset to factory defaults
  resetToDefaults(): void;
}

export const useSettingsStore = create<SettingsStore>((set, get) => {
  // Load persisted settings once at store creation time
  const persisted = loadFromMMKV();

  // Helper: apply a partial patch, persist the full new state, and return it
  function applyAndPersist(patch: Partial<Settings>): Partial<SettingsStore> {
    const current = get();
    const next: Settings = {
      spotifyClientId: current.spotifyClientId,
      spotifyClientSecret: current.spotifyClientSecret,
      lastFmApiKey: current.lastFmApiKey,
      downloadQuality: current.downloadQuality,
      downloadOnWifiOnly: current.downloadOnWifiOnly,
      dailyPicksEnabled: current.dailyPicksEnabled,
      dailyPicksTime: current.dailyPicksTime,
      storageLocation: current.storageLocation,
      crossfadeDuration: current.crossfadeDuration,
      normalizationEnabled: current.normalizationEnabled,
      ...patch,
    };
    saveToMMKV(next);
    return next;
  }

  return {
    // ── Initial state (from MMKV or defaults) ──────────────────────────────
    ...persisted,

    // ── Bulk update ────────────────────────────────────────────────────────
    updateSettings: (patch) => set((state) => {
      const next: Settings = {
        spotifyClientId: state.spotifyClientId,
        spotifyClientSecret: state.spotifyClientSecret,
        lastFmApiKey: state.lastFmApiKey,
        downloadQuality: state.downloadQuality,
        downloadOnWifiOnly: state.downloadOnWifiOnly,
        dailyPicksEnabled: state.dailyPicksEnabled,
        dailyPicksTime: state.dailyPicksTime,
        storageLocation: state.storageLocation,
        crossfadeDuration: state.crossfadeDuration,
        normalizationEnabled: state.normalizationEnabled,
        ...patch,
      };
      saveToMMKV(next);
      return next;
    }),

    // ── Granular setters ───────────────────────────────────────────────────
    setSpotifyCredentials: (clientId, clientSecret) =>
      set(() => applyAndPersist({ spotifyClientId: clientId, spotifyClientSecret: clientSecret })),

    setLastFmApiKey: (apiKey) =>
      set(() => applyAndPersist({ lastFmApiKey: apiKey })),

    setDownloadQuality: (quality) =>
      set(() => applyAndPersist({ downloadQuality: quality })),

    setDownloadOnWifiOnly: (value) =>
      set(() => applyAndPersist({ downloadOnWifiOnly: value })),

    setDailyPicksEnabled: (value) =>
      set(() => applyAndPersist({ dailyPicksEnabled: value })),

    setDailyPicksTime: (time) =>
      set(() => applyAndPersist({ dailyPicksTime: time })),

    setStorageLocation: (location) =>
      set(() => applyAndPersist({ storageLocation: location })),

    setCrossfadeDuration: (seconds) =>
      set(() =>
        applyAndPersist({
          crossfadeDuration: Math.min(12, Math.max(0, seconds)),
        }),
      ),

    setNormalizationEnabled: (value) =>
      set(() => applyAndPersist({ normalizationEnabled: value })),

    // ── Reset ──────────────────────────────────────────────────────────────
    resetToDefaults: () =>
      set(() => {
        saveToMMKV(DEFAULT_SETTINGS);
        return DEFAULT_SETTINGS;
      }),
  };
});
