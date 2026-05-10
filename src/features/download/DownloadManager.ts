/**
 * DownloadManager — orchestrates the full pipeline for adding a track to the
 * local library:
 *
 *   1. Resolve best audio stream info       (provider-specific)
 *   2. Download the raw audio stream        (react-native-blob-util w/ progress)
 *   3. Stream-copy to final container       (no transcode, ExoPlayer-native)
 *   4. Download and cache artwork           (ArtworkDownloader.downloadArtwork)
 *   5. Copy to final music directory        (react-native-blob-util)
 *   6. Insert the track into WatermelonDB   (tracksCollection)
 *
 * Concurrency
 * ───────────
 * Up to MAX_CONCURRENT pipelines run in parallel. The worker pool is started
 * once when the first item is enqueued and tears down only when the queue is
 * fully drained. `enqueue` and `enqueueBatch` are atomic with each other: a
 * single in-flight Promise guards the dedupe + capacity checks so 1200 rapid
 * enqueue calls cannot race past the cap or insert duplicates.
 *
 * Background / sleep support
 * ──────────────────────────
 * A @notifee/react-native Android Foreground Service is started before the
 * first download begins and stopped once the queue is drained.
 *
 * Library capacity
 * ────────────────
 * The library is capped at MAX_LIBRARY_SIZE (1500) tracks. The check counts
 * both DB rows and currently-queued items so a bulk approval cannot blow
 * past the cap.
 *
 * Cancellation
 * ────────────
 * • `cancelCurrent()` — aborts every actively downloading/converting item.
 * • `cancelAll()`     — flushes every remaining queued/active item.
 */

import { Platform } from 'react-native';
import RNBlobUtil from 'react-native-blob-util';
import notifee, { EventType } from '@notifee/react-native';
import { Q } from '@nozbe/watermelondb';
import { database, tracksCollection } from '@/db';
import { useDownloadStore } from '@/stores/downloadStore';
import type { DownloadStatus } from '@/stores/downloadStore';
import { getTrackPath, getTempDir, deleteFile } from '@/services/storage/fileSystem';
import { getBestAudioStream } from './YoutubeExtractor';
import { downloadArtwork } from './ArtworkDownloader';
import { getSaavnStreamUrl } from './providers/SaavnProvider';
import type { AudioStreamInfo } from './providers/types';
import {
  ensureNotificationChannel,
  startDownloadForegroundService,
  updateDownloadProgress,
  stopDownloadForegroundService,
  showDownloadError,
  registerForegroundEventHandler,
} from '@/services/notifications/DownloadNotificationService';
import { logger } from '@/utils/logger';

// ── Constants ──────────────────────────────────────────────────────────────

/** Hard cap on the number of tracks stored in the local library. */
export const MAX_LIBRARY_SIZE = 1500;

/** Maximum download pipelines running in parallel. */
const MAX_CONCURRENT = 1;

/** How many times we'll refresh a stale signed URL during the header loop. */
const MAX_STREAM_REFRESHES = 5;

/** Number of attempts (across header sets) for a single item before we give up. */
const MAX_DOWNLOAD_ATTEMPTS = 6;

/**
 * Encoding quality used for every download.
 * The user-facing Settings → Audio Quality control routes through here.
 */
const DOWNLOAD_QUALITY = '320k' as const;

// ── Types ──────────────────────────────────────────────────────────────────

export interface EnqueueParams {
  youtubeId: string;
  title: string;
  artist: string;
  album?: string;
  thumbnail: string;
  durationMs?: number;
  quality?: '128k' | '192k' | '256k' | '320k';
  provider?: 'youtube' | 'saavn';
  saavnEncryptedUrl?: string;
  saavnHas320kbps?: boolean;
}

export interface EnqueueResult {
  success: boolean;
  reason?: string;
  id?: string;
}

export interface EnqueueBatchResult {
  /** How many items were accepted into the queue. */
  accepted: number;
  /** Items already in the library or queue (deduped silently). */
  skipped: number;
  /** Items rejected because the library cap was reached partway through. */
  rejected: number;
  /** Human-readable reason if rejected > 0. */
  reason?: string;
}

interface ResolvedParams {
  youtubeId: string;
  title: string;
  artist: string;
  album: string;
  thumbnail: string;
  durationMs: number;
  quality: '128k' | '192k' | '256k' | '320k';
  provider: 'youtube' | 'saavn';
  saavnEncryptedUrl?: string;
  saavnHas320kbps?: boolean;
}

const DOWNLOAD_HEADER_SETS: Array<Record<string, string>> = [
  {
    'User-Agent':
      'Mozilla/5.0 (Linux; Android 13; SM-S908U) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
    Accept: '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
  },
  {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    Accept: '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
  },
];

function getAudioMimeType(container: 'm4a' | 'webm'): string {
  return container === 'm4a' ? 'audio/mp4' : 'audio/webm';
}

async function publishToMusicLibrary(
  sourcePath: string,
  filename: string,
  container: 'm4a' | 'webm',
): Promise<string | null> {
  if (Platform.OS !== 'android') return null;

  try {
    const displayName = filename.replace(/\.(m4a|webm)$/i, '');
    const uri = await RNBlobUtil.MediaCollection.copyToMediaStore(
      {
        name: displayName,
        parentFolder: 'Chakaas',
        mimeType: getAudioMimeType(container),
      } as any,
      'Audio',
      sourcePath,
    );
    return uri;
  } catch (err) {
    logger.warn('[DownloadManager] Could not publish to Android Music library:', err);
    return null;
  }
}

function toUserFacingDownloadError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const message = raw.toLowerCase();

  if (message.includes('cancelled')) return 'Cancelled by user';
  if (message.includes('library is full')) return raw;
  if (
    message.includes('405') ||
    message.includes('403') ||
    message.includes('cipher') ||
    message.includes('decipher') ||
    message.includes('stream url') ||
    message.includes('youtube')
  ) {
    return 'Could not get a playable audio stream. Try another result or retry later.';
  }
  if (
    message.includes('operation not permitted') ||
    message.includes('permission') ||
    message.includes('eperm') ||
    message.includes('storage')
  ) {
    return 'Could not save the song on this device. Please check storage space and try again.';
  }
  if (
    message.includes('network') ||
    message.includes('timed out') ||
    message.includes('failed to connect') ||
    message.includes('unable to resolve host')
  ) {
    return 'Network connection dropped while downloading. Please try again.';
  }

  return raw || 'Download failed. Please try again.';
}

function generateId(): string {
  return `dl_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function keyFor(provider: 'youtube' | 'saavn', id: string): string {
  return `${provider}:${id}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Module-level state ─────────────────────────────────────────────────────

/** How many pipelines are currently running. */
let _activeCount = 0;
/** True while at least one pipeline is running. Drives `isRunning`. */
let _isProcessorRunning = false;

/** Signals every active pipeline to abort at its next async boundary. */
let _cancelCurrent = false;
/** Drains the entire queue after currently running pipelines finish. */
let _cancelAll = false;
/** Number of items completed successfully since the processor last started. */
let _completedThisSession = 0;
/** True when the user cancelled the queue — suppresses the "complete" toast. */
let _sessionCancelled = false;

/**
 * Atomic dedupe + capacity gate. Every enqueue acquires this lock, so the
 * library cap check + DB write decision sees a consistent view even when 1200
 * enqueues fire in parallel.
 */
let _enqueueLock: Promise<void> = Promise.resolve();
async function withEnqueueLock<T>(fn: () => Promise<T>): Promise<T> {
  const previous = _enqueueLock;
  let release: () => void = () => {};
  _enqueueLock = new Promise((resolve) => {
    release = resolve;
  });
  try {
    await previous;
    return await fn();
  } finally {
    release();
  }
}

/** Last progress update sent to the notification for each track id. */
const _lastNotificationProgress = new Map<string, number>();

// ── Helpers ────────────────────────────────────────────────────────────────

async function countQueueable(): Promise<number> {
  const dbCount = await tracksCollection.query().fetchCount();
  const liveQueue = useDownloadStore.getState().queue.filter(
    (i) => i.status !== 'done' && i.status !== 'error',
  ).length;
  return dbCount + liveQueue;
}

/**
 * Bulk-checks which (provider, id) pairs already exist in the library. Returns
 * a Set of `provider:id` keys present in the tracks table.
 */
async function fetchExistingLibraryKeys(
  pairs: Array<{ provider: 'youtube' | 'saavn'; id: string }>,
): Promise<Set<string>> {
  const out = new Set<string>();
  if (pairs.length === 0) return out;

  const youtubeIds = pairs.filter((p) => p.provider === 'youtube').map((p) => p.id);
  const saavnIds = pairs.filter((p) => p.provider === 'saavn').map((p) => p.id);

  const [ytRows, snRows] = await Promise.all([
    youtubeIds.length > 0
      ? tracksCollection.query(Q.where('youtube_id', Q.oneOf(youtubeIds))).fetch()
      : Promise.resolve([]),
    saavnIds.length > 0
      ? tracksCollection.query(Q.where('saavn_id', Q.oneOf(saavnIds))).fetch()
      : Promise.resolve([]),
  ]);

  for (const r of ytRows) {
    if (r.durationMs > 0 && r.filePath) {
      out.add(keyFor('youtube', r.youtubeId ?? ''));
    }
  }
  for (const r of snRows) {
    if (r.durationMs > 0 && r.filePath) {
      out.add(keyFor('saavn', r.saavnId ?? ''));
    }
  }
  return out;
}

// ── DownloadManagerClass ───────────────────────────────────────────────────

class DownloadManagerClass {
  private _unsubscribeForeground: (() => void) | null = null;

  constructor() {
    notifee.onBackgroundEvent(async ({ type, detail }) => {
      if (type === EventType.ACTION_PRESS) {
        const actionId = detail.pressAction?.id;
        if (actionId === 'cancel-current') this.cancelCurrent();
        if (actionId === 'cancel-all') this.cancelAll();
      }
    });
  }

  // ── Public API ─────────────────────────────────────────────────────────

  async enqueue(params: EnqueueParams): Promise<EnqueueResult> {
    await ensureNotificationChannel();

    const provider = params.provider ?? 'youtube';
    const key = keyFor(provider, params.youtubeId);

    return withEnqueueLock(async () => {
      const store = useDownloadStore.getState();

      // Dedupe inside the in-memory queue.
      const existing = store.queue.find(
        (item) => keyFor(item.provider ?? 'youtube', item.youtubeId) === key,
      );
      if (existing) return { success: true, id: existing.id };

      // Library-row dedupe — also clean up broken records (missing file, 0 ms duration).
      const idColumn = provider === 'saavn' ? 'saavn_id' : 'youtube_id';
      const libraryRows = await tracksCollection
        .query(Q.where(idColumn, params.youtubeId))
        .fetch();
      if (libraryRows.length > 0) {
        const broken = libraryRows.filter(
          (track) => track.durationMs <= 0 || !track.filePath,
        );
        if (broken.length === 0) {
          return { success: false, reason: 'This song is already in your library.' };
        }
        await database.write(async () => {
          for (const track of broken) {
            await deleteFile(track.filePath).catch(() => {});
            if (track.artworkPath) await deleteFile(track.artworkPath).catch(() => {});
            await track.destroyPermanently();
          }
        });
      }

      if ((await countQueueable()) >= MAX_LIBRARY_SIZE) {
        return {
          success: false,
          reason: `Library is full (${MAX_LIBRARY_SIZE} songs max)`,
        };
      }

      const id = generateId();
      store.addToQueue({
        id,
        youtubeId: params.youtubeId,
        title: params.title,
        artist: params.artist,
        thumbnail: params.thumbnail,
        durationMs: params.durationMs ?? 0,
        provider,
        album: params.album,
        saavnEncryptedUrl: params.saavnEncryptedUrl,
        saavnHas320kbps: params.saavnHas320kbps,
      });

      void this._ensureProcessorRunning();
      return { success: true, id };
    });
  }

  /**
   * Adds many items in a single transaction-like batch. Does one bulk DB
   * lookup, one store mutation, and starts the worker pool once. Massively
   * faster than calling enqueue() in a loop for big lists.
   */
  async enqueueBatch(items: EnqueueParams[]): Promise<EnqueueBatchResult> {
    if (items.length === 0) return { accepted: 0, skipped: 0, rejected: 0 };
    await ensureNotificationChannel();

    return withEnqueueLock(async () => {
      const store = useDownloadStore.getState();
      const queueKeys = new Set(
        store.queue.map((d) => keyFor(d.provider ?? 'youtube', d.youtubeId)),
      );

      // Bulk-fetch which items are already in the library.
      const lookupPairs = items.map((i) => ({
        provider: (i.provider ?? 'youtube') as 'youtube' | 'saavn',
        id: i.youtubeId,
      }));
      const libraryKeys = await fetchExistingLibraryKeys(lookupPairs);

      let baseCount = await tracksCollection.query().fetchCount();
      baseCount += store.queue.filter(
        (i) => i.status !== 'done' && i.status !== 'error',
      ).length;

      const toAdd: Array<Omit<import('@/stores/downloadStore').DownloadItem, 'progress' | 'status'>> = [];
      let skipped = 0;
      let rejected = 0;

      for (const params of items) {
        const provider = (params.provider ?? 'youtube') as 'youtube' | 'saavn';
        const key = keyFor(provider, params.youtubeId);

        if (queueKeys.has(key) || libraryKeys.has(key)) {
          skipped += 1;
          continue;
        }

        if (baseCount + toAdd.length >= MAX_LIBRARY_SIZE) {
          rejected += 1;
          continue;
        }

        queueKeys.add(key);
        toAdd.push({
          id: generateId(),
          youtubeId: params.youtubeId,
          title: params.title,
          artist: params.artist,
          thumbnail: params.thumbnail,
          durationMs: params.durationMs ?? 0,
          provider,
          album: params.album,
          saavnEncryptedUrl: params.saavnEncryptedUrl,
          saavnHas320kbps: params.saavnHas320kbps,
        });
      }

      if (toAdd.length > 0) {
        store.addManyToQueue(toAdd);
        void this._ensureProcessorRunning();
      }

      const reason =
        rejected > 0
          ? `Library would exceed the ${MAX_LIBRARY_SIZE}-song cap — ${rejected} skipped.`
          : undefined;

      return { accepted: toAdd.length, skipped, rejected, reason };
    });
  }

  cancelCurrent(): void {
    _cancelCurrent = true;
    const store = useDownloadStore.getState();
    for (const item of store.queue) {
      if (
        item.status === 'downloading' ||
        item.status === 'converting' ||
        item.status === 'tagging'
      ) {
        store.setError(item.id, 'Cancelled by user');
      }
    }
  }

  cancelAll(): void {
    _cancelAll = true;
    _cancelCurrent = true;
    _sessionCancelled = true;
    const store = useDownloadStore.getState();
    for (const item of store.queue) {
      if (item.status !== 'done' && item.status !== 'error') {
        store.setError(item.id, 'Cancelled');
      }
    }
  }

  get isRunning(): boolean {
    return _isProcessorRunning;
  }

  registerForegroundListener(): () => void {
    if (this._unsubscribeForeground) this._unsubscribeForeground();
    this._unsubscribeForeground = registerForegroundEventHandler(
      () => this.cancelCurrent(),
      () => this.cancelAll(),
    );
    return () => {
      this._unsubscribeForeground?.();
      this._unsubscribeForeground = null;
    };
  }

  // ── Worker pool ────────────────────────────────────────────────────────

  /**
   * Starts the worker pool if it isn't already running. Spawns up to
   * MAX_CONCURRENT workers — each pulls one queued item at a time until the
   * queue is drained.
   */
  private async _ensureProcessorRunning(): Promise<void> {
    if (_isProcessorRunning) return;
    _isProcessorRunning = true;
    _cancelAll = false;
    _sessionCancelled = false;
    _completedThisSession = 0;

    const firstTitle = useDownloadStore.getState().queue.find((i) => i.status === 'queued')?.title;
    try {
      await startDownloadForegroundService(firstTitle ?? 'Downloading…');
    } catch (err) {
      logger.warn('[DownloadManager] Could not start foreground service:', err);
    }

    const workers: Promise<void>[] = [];
    for (let i = 0; i < MAX_CONCURRENT; i++) workers.push(this._worker());
    Promise.all(workers).finally(() => {
      _isProcessorRunning = false;
      _activeCount = 0;
      stopDownloadForegroundService(_sessionCancelled ? 0 : _completedThisSession).catch((err) =>
        logger.warn('[DownloadManager] Failed to stop foreground service:', err),
      );
      _completedThisSession = 0;
    });
  }

  /**
   * Single worker — claims the next 'queued' item atomically by setting its
   * status to 'downloading' before any other worker can see it.
   */
  private async _worker(): Promise<void> {
    while (true) {
      if (_cancelAll) return;

      const store = useDownloadStore.getState();
      const next = store.queue.find((item) => item.status === 'queued');
      if (!next) return;

      // Claim atomically — switch to 'downloading' immediately so other
      // workers see it as taken.
      store.updateProgress(next.id, 0, 'downloading');
      _activeCount += 1;
      _cancelCurrent = false;

      const resolved: ResolvedParams = {
        youtubeId: next.youtubeId,
        title: next.title,
        artist: next.artist,
        album: next.album && next.album.trim() ? next.album : 'Unknown Album',
        thumbnail: next.thumbnail,
        durationMs: next.durationMs ?? 0,
        quality: DOWNLOAD_QUALITY,
        provider: next.provider ?? 'youtube',
        saavnEncryptedUrl: next.saavnEncryptedUrl,
        saavnHas320kbps: next.saavnHas320kbps,
      };

      const remaining = store.queue.filter(
        (i) => i.status === 'queued' || i.status === 'downloading',
      ).length;

      try {
        await this._runPipeline(next.id, resolved, remaining);
        _completedThisSession += 1;
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        const message = toUserFacingDownloadError(err);
        const isCancelled = message === 'Cancelled' || message === 'Cancelled by user';
        logger.warn(`[DownloadManager] Failed "${next.title}": ${raw}`);
        useDownloadStore.getState().setError(next.id, message);
        if (!isCancelled) {
          try {
            await showDownloadError(next.title, message);
          } catch (notificationErr) {
            logger.warn('[DownloadManager] Failed to show error notification:', notificationErr);
          }
        }
      } finally {
        _lastNotificationProgress.delete(next.id);
        _activeCount = Math.max(0, _activeCount - 1);
      }
    }
  }

  // ── Pipeline ───────────────────────────────────────────────────────────

  private async _runPipeline(
    id: string,
    params: ResolvedParams,
    queueLength: number,
  ): Promise<void> {
    const getStore = useDownloadStore.getState;

    const reportProgress = async (pct: number, status: DownloadStatus): Promise<void> => {
      getStore().updateProgress(id, pct, status);
      // Throttle notification updates per-track — only when crossing a 5%
      // boundary. Notifee bridges to native; firing per byte is wasteful.
      const last = _lastNotificationProgress.get(id) ?? -10;
      if (Math.abs(pct - last) >= 5 || pct === 100) {
        _lastNotificationProgress.set(id, pct);
        try {
          await updateDownloadProgress(params.title, params.artist, pct, queueLength);
        } catch (err) {
          logger.warn('[DownloadManager] Failed to update progress notification:', err);
        }
      }
      if (_cancelCurrent || _cancelAll) throw new Error('Cancelled by user');
    };

    // ── 1. Resolve stream ────────────────────────────────────────────────
    await reportProgress(5, 'downloading');

    let stream: AudioStreamInfo;
    if (params.provider === 'saavn') {
      if (!params.saavnEncryptedUrl) {
        throw new Error(
          `Missing Saavn encrypted URL for "${params.title}" — search result was malformed.`,
        );
      }
      const saavnStream = await getSaavnStreamUrl(
        params.saavnEncryptedUrl,
        params.saavnHas320kbps ?? false,
      );
      stream = {
        ...saavnStream,
        durationMs:
          params.durationMs > 0 ? params.durationMs : saavnStream.durationMs,
      };
    } else {
      const ytStream = await getBestAudioStream(params.youtubeId);
      stream = ytStream as AudioStreamInfo;
    }

    if (!stream.url || stream.url.length < 20) {
      throw new Error(
        `Empty/invalid stream URL returned for "${params.title}" — ` +
          `${params.provider === 'saavn' ? 'Saavn auth-token request' : 'YouTube cipher decode'} likely failed.`,
      );
    }

    if (_cancelCurrent || _cancelAll) throw new Error('Cancelled by user');

    // ── 2. Download raw stream — with retry + refresh ────────────────────
    const tempDir = await getTempDir();
    // Generate a unique temp path per attempt to avoid collisions when many
    // workers run in parallel.
    const tempRawPath = `${tempDir}${id}.${stream.container}`;

    let downloaded = false;
    let lastDownloadError: unknown = null;
    let activeStreamUrl = stream.url;
    let streamRefreshes = 0;
    let attempt = 0;

    while (attempt < MAX_DOWNLOAD_ATTEMPTS && !downloaded) {
      if (_cancelCurrent || _cancelAll) {
        await deleteFile(tempRawPath).catch(() => {});
        throw new Error('Cancelled by user');
      }

      const headers = DOWNLOAD_HEADER_SETS[attempt % DOWNLOAD_HEADER_SETS.length];
      attempt += 1;

      try {
        await deleteFile(tempRawPath).catch(() => {});
        const mergedHeaders = stream.requestHeaders
          ? { ...headers, ...stream.requestHeaders }
          : headers;
        const response = await RNBlobUtil.config({ path: tempRawPath })
          .fetch('GET', activeStreamUrl, mergedHeaders)
          .progress({ count: 20, interval: 300 }, async (received: number, total: number) => {
            if (total > 0) {
              const pct = 5 + Math.round((received / total) * 60);
              const last = _lastNotificationProgress.get(id) ?? -10;
              if (Math.abs(pct - last) >= 5) {
                _lastNotificationProgress.set(id, pct);
                getStore().updateProgress(id, pct, 'downloading');
                await updateDownloadProgress(
                  params.title,
                  params.artist,
                  pct,
                  queueLength,
                ).catch((err) => {
                  logger.warn('[DownloadManager] Failed to update progress notification:', err);
                });
              }
            }
          });
        const status = response.info().status;
        if (status < 200 || status >= 300) {
          throw new Error(`Audio download returned HTTP ${status}`);
        }

        const stat = await RNBlobUtil.fs.stat(tempRawPath);
        const size = typeof stat.size === 'string' ? Number.parseInt(stat.size, 10) : stat.size;
        const minExpectedBytes =
          stream.durationMs > 0 && stream.bitrate > 0
            ? Math.min(
                256 * 1024,
                Math.round((stream.durationMs / 1000) * (stream.bitrate / 8) * 0.05),
              )
            : 64 * 1024;
        if (!Number.isFinite(size) || size < minExpectedBytes) {
          throw new Error(`Downloaded audio file is too small (${size || 0} bytes)`);
        }

        downloaded = true;
        break;
      } catch (err) {
        lastDownloadError = err;
        await deleteFile(tempRawPath).catch(() => {});
        const errMsg = err instanceof Error ? err.message : String(err);

        const isStaleUrl = /HTTP (403|410|401)/.test(errMsg);
        const isTransient =
          /HTTP 5\d\d|network|timed out|failed to connect|unable to resolve host/i.test(errMsg);

        if (isStaleUrl && streamRefreshes < MAX_STREAM_REFRESHES) {
          streamRefreshes += 1;
          try {
            const refreshed: AudioStreamInfo =
              params.provider === 'saavn' && params.saavnEncryptedUrl
                ? await getSaavnStreamUrl(
                    params.saavnEncryptedUrl,
                    params.saavnHas320kbps ?? false,
                  )
                : ((await getBestAudioStream(params.youtubeId)) as AudioStreamInfo);
            if (refreshed.url && refreshed.url.length > 20) {
              activeStreamUrl = refreshed.url;
            }
          } catch (refreshErr) {
            logger.warn('[DownloadManager] Stream URL refresh failed:', refreshErr);
          }
          continue;
        }

        if (isTransient && attempt < MAX_DOWNLOAD_ATTEMPTS) {
          // Exponential backoff with jitter: 0.8s, 1.6s, 3.2s, 6.4s …
          const backoff = Math.min(8000, 800 * 2 ** (attempt - 1));
          const jitter = Math.floor(Math.random() * 300);
          await delay(backoff + jitter);
          continue;
        }

        // Non-retryable — bail out.
        break;
      }
    }

    if (!downloaded) {
      throw lastDownloadError instanceof Error
        ? lastDownloadError
        : new Error(`Could not download audio stream for "${params.title}"`);
    }

    if (_cancelCurrent || _cancelAll) {
      await deleteFile(tempRawPath).catch(() => {});
      throw new Error('Cancelled by user');
    }

    // ── 3. Stream-copy to final container ────────────────────────────────
    await reportProgress(85, 'converting');

    const finalExt = stream.container === 'm4a' ? 'm4a' : 'webm';
    const tempStagePath = `${tempDir}${id}.${finalExt}`;

    if (tempRawPath !== tempStagePath) {
      await RNBlobUtil.fs.cp(tempRawPath, tempStagePath);
      await deleteFile(tempRawPath);
    }

    if (_cancelCurrent || _cancelAll) {
      await deleteFile(tempStagePath).catch(() => {});
      throw new Error('Cancelled by user');
    }

    // ── 4. Artwork ───────────────────────────────────────────────────────
    await reportProgress(88, 'tagging');
    const artworkPath = await downloadArtwork(params.thumbnail, id);

    if (_cancelCurrent || _cancelAll) {
      await deleteFile(tempStagePath).catch(() => {});
      throw new Error('Cancelled by user');
    }

    // ── 5. Copy to music directory ───────────────────────────────────────
    await reportProgress(92, 'tagging');
    const finalPath = await getTrackPath(
      params.artist,
      params.title,
      finalExt,
      params.youtubeId,
    );
    const finalFilename = finalPath.split('/').pop() ?? `${id}.${finalExt}`;
    try {
      await RNBlobUtil.fs.cp(tempStagePath, finalPath);
    } catch (err) {
      await deleteFile(finalPath).catch(() => {});
      throw err;
    }
    await publishToMusicLibrary(finalPath, finalFilename, stream.container).catch(() => null);
    await deleteFile(tempStagePath);

    // ── 6. Insert DB row ─────────────────────────────────────────────────
    const durationMs =
      stream.durationMs > 0 ? stream.durationMs : params.durationMs > 0 ? params.durationMs : 0;

    await reportProgress(95, 'tagging');

    await database.write(async () => {
      await tracksCollection.create((record) => {
        record.title = params.title;
        record.artist = params.artist;
        record.album = params.album;
        record.genre = '';
        record.durationMs = durationMs;
        record.filePath = finalPath;
        record.artworkPath = artworkPath;
        if (params.provider === 'saavn') {
          record.saavnId = params.youtubeId;
          record.youtubeId = null;
        } else {
          record.youtubeId = params.youtubeId;
          record.saavnId = null;
        }
        record.addedAt = Math.floor(Date.now() / 1000);
        record.source = params.provider;
        record.liked = false;
      });
    });

    getStore().updateProgress(id, 100, 'done');
  }
}

export const DownloadManager = new DownloadManagerClass();
