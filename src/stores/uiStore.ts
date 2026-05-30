import { create } from 'zustand';

type ActiveSheet = 'track-context' | 'add-to-playlist' | 'download-quality';

// The user-selectable preference. `'system'` defers to the OS appearance; the
// default app experience is the Arc Reactor DARK scheme.
type ColorSchemePreference = 'dark' | 'light' | 'system';

interface UIStore {
  // Resolved scheme the UI renders with. Always concrete ('dark' | 'light').
  colorScheme: 'dark' | 'light';
  // The user's raw preference, including 'system'.
  colorSchemePreference: ColorSchemePreference;
  accentColor: string;
  accentColorLight: string;
  isPlayerExpanded: boolean;
  activeSheet: ActiveSheet | null;
  activeSheetTrackId: string | null;

  setColorScheme(scheme: ColorSchemePreference): void;
  setAccentColor(color: string, colorLight: string): void;
  expandPlayer(): void;
  collapsePlayer(): void;
  openSheet(sheet: ActiveSheet | null, trackId?: string): void;
  closeSheet(): void;
}

export const useUIStore = create<UIStore>((set) => ({
  // ── State ────────────────────────────────────────────────────────────────
  // DARK is the default Arc Reactor experience.
  colorScheme: 'dark',
  colorSchemePreference: 'dark',
  accentColor: '#19E3FF',
  accentColorLight: '#5FF0FF',
  isPlayerExpanded: false,
  activeSheet: null,
  activeSheetTrackId: null,

  // ── Actions ──────────────────────────────────────────────────────────────
  // Accepts 'dark' | 'light' | 'system'. 'system' currently resolves to dark
  // (the brand default) until OS-appearance wiring lands; the raw preference is
  // still recorded so a future Appearance listener can resolve it live.
  setColorScheme: (scheme) =>
    set({
      colorSchemePreference: scheme,
      colorScheme: scheme === 'light' ? 'light' : 'dark',
    }),

  setAccentColor: (color, colorLight) =>
    set({ accentColor: color, accentColorLight: colorLight }),

  expandPlayer: () => set({ isPlayerExpanded: true }),

  collapsePlayer: () => set({ isPlayerExpanded: false }),

  openSheet: (sheet, trackId) =>
    set({
      activeSheet: sheet,
      activeSheetTrackId: trackId ?? null,
    }),

  closeSheet: () =>
    set({
      activeSheet: null,
      activeSheetTrackId: null,
    }),
}));
