import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

export type DownloadStatus =
  | 'queued'
  | 'downloading'
  | 'converting'
  | 'tagging'
  | 'done'
  | 'error';

export interface DownloadItem {
  id: string;
  /**
   * Provider-native ID. YouTube videoId or Saavn song id; named
   * `youtubeId` for backward compatibility with existing UI bindings.
   */
  youtubeId: string;
  title: string;
  artist: string;
  thumbnail: string;
  /** Track duration in milliseconds, sourced from search metadata. */
  durationMs: number;
  progress: number; // 0 – 100
  status: DownloadStatus;
  error?: string;
  /** Which backend resolves the stream URL. Defaults to 'youtube'. */
  provider?: 'youtube' | 'saavn';
  /** Album name, used for the DB record on completion. */
  album?: string;
  /** Saavn encrypted media URL — stream-resolution input. */
  saavnEncryptedUrl?: string;
  /** Whether Saavn 320 kbps tier is available. */
  saavnHas320kbps?: boolean;
}

interface DownloadStore {
  queue: DownloadItem[];

  addToQueue(item: Omit<DownloadItem, 'progress' | 'status'>): void;
  addManyToQueue(items: Array<Omit<DownloadItem, 'progress' | 'status'>>): void;
  updateProgress(id: string, progress: number, status: DownloadStatus): void;
  setError(id: string, error: string): void;
  removeItem(id: string): void;
  clearCompleted(): void;
}

export const useDownloadStore = create<DownloadStore>()(
  immer((set) => ({
    // ── State ──────────────────────────────────────────────────────────────
    queue: [],

    // ── Actions ────────────────────────────────────────────────────────────
    addToQueue: (item) =>
      set((state) => {
        // Prevent duplicate entries for the same provider+id pair
        const exists = state.queue.some(
          (d) => d.youtubeId === item.youtubeId && (d.provider ?? 'youtube') === (item.provider ?? 'youtube'),
        );
        if (!exists) {
          state.queue.push({ ...item, progress: 0, status: 'queued' });
        }
      }),

    addManyToQueue: (items) =>
      set((state) => {
        // O(N+M) bulk insert — builds a single set of existing keys and
        // appends accepted items in one immer mutation. 1200-song approval
        // hits the queue in a single render instead of 1200 sequential
        // state updates.
        const seen = new Set(
          state.queue.map((d) => `${d.provider ?? 'youtube'}:${d.youtubeId}`),
        );
        for (const item of items) {
          const key = `${item.provider ?? 'youtube'}:${item.youtubeId}`;
          if (seen.has(key)) continue;
          seen.add(key);
          state.queue.push({ ...item, progress: 0, status: 'queued' });
        }
      }),

    updateProgress: (id, progress, status) =>
      set((state) => {
        const item = state.queue.find((d) => d.id === id);
        if (item) {
          item.progress = Math.min(100, Math.max(0, progress));
          item.status = status;
          // Clear any previous error if we're progressing again
          if (status !== 'error') {
            delete item.error;
          }
        }
      }),

    setError: (id, error) =>
      set((state) => {
        const item = state.queue.find((d) => d.id === id);
        if (item) {
          item.status = 'error';
          item.error = error;
        }
      }),

    removeItem: (id) =>
      set((state) => {
        state.queue = state.queue.filter((d) => d.id !== id);
      }),

    clearCompleted: () =>
      set((state) => {
        state.queue = state.queue.filter((d) => d.status !== 'done');
      }),
  })),
);
