import { MMKV } from 'react-native-mmkv';

// General app storage
export const storage = new MMKV({ id: 'chakaas-general' });

// Settings storage
export const settingsStorage = new MMKV({ id: 'chakaas-settings' });

// Taste vector + recommendation cache
export const recommendationStorage = new MMKV({ id: 'chakaas-recommendations' });

// Token cache for Spotify/APIs
export const tokenStorage = new MMKV({ id: 'chakaas-tokens' });

// Typed getter/setter helpers
export function getJSON<T>(store: MMKV, key: string): T | null {
  const raw = store.getString(key);
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

export function setJSON<T>(store: MMKV, key: string, value: T): void {
  store.set(key, JSON.stringify(value));
}
