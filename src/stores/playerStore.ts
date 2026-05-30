import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { MMKV } from 'react-native-mmkv';

type RepeatMode = 'off' | 'track' | 'queue';

/**
 * Lightweight snapshot of the currently-playing track, populated from RNTP's
 * `PlaybackActiveTrackChanged` event. This is intentionally NOT the WatermelonDB
 * `Track` model — streamed (online) tracks have no DB row, so we mirror only the
 * RNTP-visible fields. Consumers outside the player (e.g. the recommendation
 * engine) can read `currentTrack` without importing RNTP.
 */
export interface CurrentTrackInfo {
  /** RNTP track id — a DB UUID for library tracks or `stream:<id>` for streams. */
  id: string;
  title: string;
  artist: string;
  album?: string;
  artwork?: string;
}

// ── MMKV persistence ────────────────────────────────────────────────────────
// Repeat mode + shuffle survive cold starts — losing them every launch was a
// user-visible bug ("why does shuffle keep turning off?").

const playerStorage = new MMKV({ id: 'chakaas-player' });
const PERSIST_KEY = 'state';

interface PersistedPlayerState {
  repeatMode: RepeatMode;
  shuffleEnabled: boolean;
  volume: number;
}

const DEFAULTS: PersistedPlayerState = {
  repeatMode: 'off',
  shuffleEnabled: false,
  volume: 1.0,
};

function loadPersisted(): PersistedPlayerState {
  try {
    const raw = playerStorage.getString(PERSIST_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<PersistedPlayerState>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return DEFAULTS;
  }
}

function persist(state: PersistedPlayerState): void {
  try {
    playerStorage.set(PERSIST_KEY, JSON.stringify(state));
  } catch {
    // In-memory state is still authoritative for this session.
  }
}

// ── Store ──────────────────────────────────────────────────────────────────

interface PlayerStore {
  currentTrack: CurrentTrackInfo | null;
  isPlaying: boolean;
  repeatMode: RepeatMode;
  shuffleEnabled: boolean;
  volume: number; // 0.0 – 1.0

  setCurrentTrack(track: CurrentTrackInfo | null): void;
  setIsPlaying(playing: boolean): void;
  setRepeatMode(mode: RepeatMode): void;
  toggleShuffle(): void;
  setVolume(volume: number): void;
}

export const usePlayerStore = create<PlayerStore>()(
  immer((set, get) => {
    const persisted = loadPersisted();
    return {
      currentTrack: null,
      isPlaying: false,
      repeatMode: persisted.repeatMode,
      shuffleEnabled: persisted.shuffleEnabled,
      volume: persisted.volume,

      setCurrentTrack: (track) =>
        set((state) => {
          state.currentTrack = track;
        }),

      setIsPlaying: (playing) =>
        set((state) => {
          state.isPlaying = playing;
        }),

      setRepeatMode: (mode) => {
        set((state) => {
          state.repeatMode = mode;
        });
        const s = get();
        persist({
          repeatMode: s.repeatMode,
          shuffleEnabled: s.shuffleEnabled,
          volume: s.volume,
        });
      },

      toggleShuffle: () => {
        set((state) => {
          state.shuffleEnabled = !state.shuffleEnabled;
        });
        const s = get();
        persist({
          repeatMode: s.repeatMode,
          shuffleEnabled: s.shuffleEnabled,
          volume: s.volume,
        });
      },

      setVolume: (volume) => {
        const clamped = Math.min(1, Math.max(0, volume));
        // Early-out when the volume didn't actually change. The volume slider
        // calls this on every gesture commit; without this guard we'd
        // re-render subscribers and re-stringify to MMKV for no-op events.
        if (get().volume === clamped) return;
        set((state) => {
          state.volume = clamped;
        });
        const s = get();
        persist({
          repeatMode: s.repeatMode,
          shuffleEnabled: s.shuffleEnabled,
          volume: s.volume,
        });
      },
    };
  }),
);
