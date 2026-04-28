import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type Track from '@/db/models/Track';

type RepeatMode = 'off' | 'track' | 'queue';

interface PlayerStore {
  currentTrack: Track | null;
  isPlaying: boolean;
  repeatMode: RepeatMode;
  shuffleEnabled: boolean;
  volume: number; // 0.0 – 1.0

  setCurrentTrack(track: Track | null): void;
  setIsPlaying(playing: boolean): void;
  setRepeatMode(mode: RepeatMode): void;
  toggleShuffle(): void;
  setVolume(volume: number): void;
}

export const usePlayerStore = create<PlayerStore>()(
  immer((set) => ({
    // ── State ──────────────────────────────────────────────────────────────
    currentTrack: null,
    isPlaying: false,
    repeatMode: 'off',
    shuffleEnabled: false,
    volume: 1.0,

    // ── Actions ────────────────────────────────────────────────────────────
    setCurrentTrack: (track) =>
      set((state) => {
        state.currentTrack = track;
      }),

    setIsPlaying: (playing) =>
      set((state) => {
        state.isPlaying = playing;
      }),

    setRepeatMode: (mode) =>
      set((state) => {
        state.repeatMode = mode;
      }),

    toggleShuffle: () =>
      set((state) => {
        state.shuffleEnabled = !state.shuffleEnabled;
      }),

    setVolume: (volume) =>
      set((state) => {
        // Clamp to [0, 1]
        state.volume = Math.min(1, Math.max(0, volume));
      }),
  })),
);
