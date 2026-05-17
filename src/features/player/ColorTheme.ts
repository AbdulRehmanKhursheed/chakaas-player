/**
 * ColorTheme — extracts the dominant + secondary colours from a track's
 * artwork using `react-native-image-colors`, with a small module-level
 * cache keyed by artwork URI.
 *
 * On RNTP `Event.PlaybackActiveTrackChanged` we extract the colours for
 * the new track and publish them into a Zustand store so NowPlayingScreen
 * and MiniPlayer can subscribe.
 *
 * Public API:
 *   getTrackColors(artworkPath)        // async, cached
 *   useColorTheme()                    // hook: { dominant, secondary, isDark }
 *   ColorThemeListener.setup()         // wire RNTP track-change events
 *   ColorThemeListener.dispose()
 *
 * The `albumColorThemingEnabled` setting gates publication — when off the
 * store falls back to the gold accent so the rest of the UI stays static.
 */

import { create } from 'zustand';
import { Platform } from 'react-native';
import { getColors } from 'react-native-image-colors';
import TrackPlayer, { Event } from 'react-native-track-player';
import { useSettingsStore } from '@/stores/settingsStore';
import { logger } from '@/utils/logger';

// ── Defaults ────────────────────────────────────────────────────────────────

export const GOLD = '#FFD700';
export const GOLD_DEEP = '#B8860B';

export interface TrackColors {
  dominant: string;
  secondary: string;
  isDark: boolean;
}

const DEFAULT_COLORS: TrackColors = {
  dominant: GOLD,
  secondary: GOLD_DEEP,
  isDark: true,
};

// ── Cache ───────────────────────────────────────────────────────────────────

/**
 * Map preserves insertion order, so the first key returned by `.keys()` is
 * the oldest entry. We cap at CACHE_MAX_ENTRIES and evict the oldest on
 * insert — same pattern as `ArtworkResolver`. Color extraction is cheap to
 * redo, so we just keep recent artwork warm rather than growing unboundedly
 * across a long listening session.
 */
const CACHE_MAX_ENTRIES = 200;
const cache = new Map<string, TrackColors>();

function setCache(key: string, value: TrackColors): void {
  cache.set(key, value);
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] | null {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return null;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
  return [r, g, b];
}

/**
 * Returns true if a hex colour is too dark or too grey to be useful as a
 * UI accent — the caller can fall back to gold.
 */
export function isDarkOrGrey(hex: string): boolean {
  const rgb = hexToRgb(hex);
  if (!rgb) return true;
  const [r, g, b] = rgb;
  // Perceived luminance (Rec. 709).
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (luma < 50) return true;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const saturation = max === 0 ? 0 : (max - min) / max;
  return saturation < 0.18;
}

function pickDominantAndSecondary(
  result: Awaited<ReturnType<typeof getColors>>,
): { dominant: string; secondary: string } {
  if (result.platform === 'android') {
    const dominant = result.dominant ?? result.vibrant ?? result.muted ?? GOLD;
    const secondary =
      result.vibrant && result.vibrant !== dominant
        ? result.vibrant
        : result.muted ?? GOLD_DEEP;
    return { dominant, secondary };
  }
  if (result.platform === 'ios') {
    const dominant = result.primary ?? GOLD;
    const secondary = result.secondary ?? result.detail ?? GOLD_DEEP;
    return { dominant, secondary };
  }
  if (result.platform === 'web') {
    return { dominant: result.dominant ?? GOLD, secondary: GOLD_DEEP };
  }
  return { dominant: GOLD, secondary: GOLD_DEEP };
}

// ── Color extraction ────────────────────────────────────────────────────────

export async function getTrackColors(
  artworkPath: string | null | undefined,
): Promise<TrackColors> {
  if (!artworkPath) return DEFAULT_COLORS;

  const cached = cache.get(artworkPath);
  if (cached) return cached;

  try {
    const result = await getColors(artworkPath, {
      fallback: GOLD,
      cache: true,
      key: `chakaas-theme-${artworkPath}`,
      quality: 'low',
      ...(Platform.OS === 'android' && { pixelSpacing: 5 }),
    });
    const picked = pickDominantAndSecondary(result);
    const colors: TrackColors = {
      dominant: picked.dominant,
      secondary: picked.secondary,
      isDark: isDarkOrGrey(picked.dominant),
    };
    setCache(artworkPath, colors);
    return colors;
  } catch (err) {
    logger.warn('[ColorTheme] extraction failed:', err);
    return DEFAULT_COLORS;
  }
}

// ── Zustand store ───────────────────────────────────────────────────────────

interface ColorThemeStore {
  colors: TrackColors;
  setColors(colors: TrackColors): void;
  resetToDefault(): void;
}

export const useColorTheme = create<ColorThemeStore>((set) => ({
  colors: DEFAULT_COLORS,
  setColors: (colors) => set({ colors }),
  resetToDefault: () => set({ colors: DEFAULT_COLORS }),
}));

// ── RNTP listener ───────────────────────────────────────────────────────────

let activeSub: { remove: () => void } | null = null;
let extractionToken = 0;

function getTrackKey(
  track: Awaited<ReturnType<typeof TrackPlayer.getActiveTrack>>,
): string | null {
  if (!track) return null;
  if (typeof track.id === 'string' && track.id.length > 0) return track.id;
  if (typeof track.url === 'string' && track.url.length > 0) return track.url;
  return null;
}

async function publishForActiveTrack(): Promise<void> {
  const token = ++extractionToken;
  try {
    const active = await TrackPlayer.getActiveTrack();
    const startTrackKey = getTrackKey(active);
    const artwork =
      active && typeof active.artwork === 'string' ? active.artwork : null;

    const { albumColorThemingEnabled } = useSettingsStore.getState();
    if (!albumColorThemingEnabled) {
      // Bump the extraction token so any in-flight extraction races sees a
      // mismatch and bails before publishing. Without this, an extraction
      // that started just before the user toggled the setting off could
      // still call `setColors(...)` AFTER `resetToDefault()` and re-paint
      // the UI with stale album colours.
      extractionToken++;
      useColorTheme.getState().resetToDefault();
      return;
    }

    const colors = await getTrackColors(artwork);
    // Bail if a newer extraction kicked off while this one was in flight.
    if (token !== extractionToken) return;
    // Race guard: when the user skips A → B → A in quick succession, the
    // token check above protects only the most-recent extraction. We ALSO
    // verify the currently-active track is still the one we started for,
    // otherwise stale colours overwrite the freshly-extracted ones.
    try {
      const nowActive = await TrackPlayer.getActiveTrack();
      const nowKey = getTrackKey(nowActive);
      if (startTrackKey !== null && nowKey !== null && nowKey !== startTrackKey) {
        return;
      }
    } catch {
      // If RNTP can't tell us the active track right now, fall through —
      // the token guard above is still in place.
    }
    useColorTheme.getState().setColors(colors);
  } catch (err) {
    logger.warn('[ColorTheme] publishForActiveTrack failed:', err);
  }
}

export const ColorThemeListener = {
  setup(): void {
    if (activeSub != null) return;
    activeSub = TrackPlayer.addEventListener(
      Event.PlaybackActiveTrackChanged,
      () => {
        void publishForActiveTrack();
      },
    );
    // Also publish immediately for whatever's currently active.
    void publishForActiveTrack();
    logger.info('[ColorTheme] listener set up');
  },

  dispose(): void {
    if (activeSub) {
      activeSub.remove();
      activeSub = null;
    }
    extractionToken++;
  },

  /** Re-publish immediately — used when the user toggles the setting. */
  refresh(): void {
    void publishForActiveTrack();
  },
};
