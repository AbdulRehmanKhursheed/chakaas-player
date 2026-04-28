import { create } from 'zustand';

type ActiveSheet = 'track-context' | 'add-to-playlist' | 'download-quality';

interface UIStore {
  colorScheme: 'dark' | 'light';
  accentColor: string;
  accentColorLight: string;
  isPlayerExpanded: boolean;
  activeSheet: ActiveSheet | null;
  activeSheetTrackId: string | null;

  setColorScheme(scheme: 'dark' | 'light'): void;
  setAccentColor(color: string, colorLight: string): void;
  expandPlayer(): void;
  collapsePlayer(): void;
  openSheet(sheet: ActiveSheet | null, trackId?: string): void;
  closeSheet(): void;
}

export const useUIStore = create<UIStore>((set) => ({
  // ── State ────────────────────────────────────────────────────────────────
  colorScheme: 'light',
  accentColor: '#FA233B',
  accentColorLight: '#FFE55C',
  isPlayerExpanded: false,
  activeSheet: null,
  activeSheetTrackId: null,

  // ── Actions ──────────────────────────────────────────────────────────────
  setColorScheme: (scheme) => set({ colorScheme: scheme }),

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
