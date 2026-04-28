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
  youtubeId: string;
  title: string;
  artist: string;
  thumbnail: string;
  /** Track duration in milliseconds, sourced from YouTube metadata. */
  durationMs: number;
  progress: number; // 0 – 100
  status: DownloadStatus;
  error?: string;
}

interface DownloadStore {
  queue: DownloadItem[];

  addToQueue(item: Omit<DownloadItem, 'progress' | 'status'>): void;
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
        // Prevent duplicate entries for the same youtube ID
        const exists = state.queue.some((d) => d.youtubeId === item.youtubeId);
        if (!exists) {
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
