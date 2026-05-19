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
import { useSettingsStore } from '@/stores/settingsStore';
import type { DownloadQuality } from '@/stores/settingsStore';
import { getTrackPath, getTempDir, deleteFile } from '@/services/storage/fileSystem';
import { downloadArtwork } from './ArtworkDownloader';
import { clearSaavnUrlCache } from './providers/SaavnProvider';
import { resolveAudioStream } from './MultiSourceResolver';
import type { AudioStreamInfo } from './providers/types';
import {
  ensureNotificationChannel,
  startDownloadForegroundService,
  updateDownloadProgress,
  stopDownloadForegroundService,
  showDownloadError,
  registerForegroundEventHandler,
  resetErrorNotificationState,
} from '@/services/notifications/DownloadNotificationService';
import { logger } from '@/utils/logger';

// ── Constants ──────────────────────────────────────────────────────────────

/** Hard cap on the number of tracks stored in the local library. */
export const MAX_LIBRARY_SIZE = 1500;

/**
 * Maximum download pipelines running in parallel. 3 is the chosen value
 * because the Saavn CDN (`web.saavncdn.com`) tolerates 3 concurrent requests
 * from the same client well in empirical testing — no 429s, no slowdowns —
 * while still saturating typical mobile bandwidth.
 *
 * The pipeline is already parallel-safe: every temp path uses the per-item
 * `id` (line 652) and final paths use `youtubeId`/`saavnId` keys via
 * getTrackPath, so workers never collide on disk.
 */
const MAX_CONCURRENT = 3;

/** How many times we'll refresh a stale signed URL during the header loop. */
const MAX_STREAM_REFRESHES = 5;

/** Number of attempts (across header sets) for a single item before we give up. */
const MAX_DOWNLOAD_ATTEMPTS = 6;

/**
 * Reads the user's chosen audio-quality setting from the persisted settings
 * store. Returns '320k' as a safe default if reading fails (defensive — the
 * store is initialised with '320k' anyway, but this guard keeps the worker
 * pipeline from crashing if the MMKV layer hiccups).
 *
 * The result is captured at enqueue-time (NOT at worker-claim-time) so that a
 * user toggling Settings mid-download doesn't change quality for already-queued
 * items. New items added after the toggle pick up the new setting.
 */
function readDownloadQuality(): DownloadQuality {
  try {
    return useSettingsStore.getState().downloadQuality;
  } catch {
    return '320k';
  }
}

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

function getAudioMimeType(container: 'm4a' | 'webm' | 'mp3'): string {
  if (container === 'm4a') return 'audio/mp4';
  if (container === 'mp3') return 'audio/mpeg';
  return 'audio/webm';
}

async function publishToMusicLibrary(
  sourcePath: string,
  filename: string,
  container: 'm4a' | 'webm' | 'mp3',
): Promise<string | null> {
  if (Platform.OS !== 'android') return null;

  try {
    const displayName = filename.replace(/\.(m4a|webm|mp3)$/i, '');
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

/**
 * Per-id cancellation set. `cancelCurrent()` populates this with the ids of
 * actively running pipelines. Each pipeline polls `_cancelledIds.has(id)` at
 * its cancel checkpoints and the worker removes the id in a `finally` once
 * the pipeline has settled.
 *
 * This replaces the old module-level `_cancelCurrent` boolean which leaked
 * cancellation state across items: cancelling track A would race-cancel track
 * B if B claimed the slot before A's pipeline noticed.
 */
const _cancelledIds = new Set<string>();
/**
 * In-flight `RNBlobUtil.config(...).fetch(...)` tasks keyed by track id.
 *
 * `RNBlobUtil` returns a `StatefulPromise` whose `.cancel()` method aborts
 * the underlying native download — equivalent to `AbortController.abort()`
 * for the standard `fetch`. Without this registry, calling `cancelCurrent`
 * or `cancelAll` would only flip a boolean: an in-flight HTTP fetch with a
 * 30s native timeout would keep running and the foreground service would
 * stay up until it eventually settled.
 *
 * The worker registers its current fetch task here just before the call
 * and clears the slot in a `finally`. `cancelCurrent`/`cancelAll` walks the
 * map and `cancel()`s every active fetch in addition to setting the cancel
 * flag — so the worker's `.catch(...)` fires immediately, hits the next
 * `isCancelled()` checkpoint, and exits.
 */
const _activeFetchTasks = new Map<string, { cancel: () => void }>();
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

/** Last progress percentage sent to the notification for each track id. */
const _lastNotificationProgress = new Map<string, number>();
/**
 * Wall-clock timestamp (ms) of the last notification update across ALL ids.
 * Notifee bridges to native — flooding it ≥4×/s wastes JS thread time and
 * the user can't see the difference anyway. Throttled to 250 ms minimum gap,
 * with carve-outs for `pct === 100` and stage transitions.
 */
let _lastNotificationWallMs = 0;
const NOTIFICATION_MIN_GAP_MS = 250;

/** Tracks the last `DownloadStatus` we notified for each id (for stage-transition carve-out). */
const _lastNotificationStatus = new Map<string, DownloadStatus>();

/**
 * Serialization mutex for notifee.displayNotification calls.
 * With MAX_CONCURRENT=3 workers each emitting progress every 300ms, two
 * pushProgress calls can pass the wall-clock throttle in the same JS tick
 * (the throttle is read-then-set, not atomic) and end up firing two
 * concurrent native displayNotification calls against the same FG service
 * notification ID. On some OEM Androids that races notifee's internal
 * state and crashes the JS thread — matching the user's repro of
 * "scroll while downloading → crash". The mutex serialises native calls
 * without blocking the workers' own pipelines.
 */
let _notificationFlight: Promise<void> = Promise.resolve();

/**
 * Centralized helper for pushing a progress update to both the in-app store
 * and the foreground-service notification. Applies the wall-clock throttle
 * (≥250 ms between notifee calls) and the 5%-delta guard. Always allows
 * `pct === 100` and stage transitions through.
 */
async function pushProgress(
  id: string,
  title: string,
  artist: string,
  pct: number,
  queueLength: number,
  status: DownloadStatus,
): Promise<void> {
  useDownloadStore.getState().updateProgress(id, pct, status);

  const lastPct = _lastNotificationProgress.get(id) ?? -10;
  const lastStatus = _lastNotificationStatus.get(id);
  const isStageTransition = lastStatus !== status;
  const isTerminal = pct >= 100;
  const wallNow = Date.now();
  const wallGapOk = wallNow - _lastNotificationWallMs >= NOTIFICATION_MIN_GAP_MS;
  const pctGapOk = Math.abs(pct - lastPct) >= 5;

  if (!(isTerminal || isStageTransition || (wallGapOk && pctGapOk))) return;

  _lastNotificationProgress.set(id, pct);
  _lastNotificationStatus.set(id, status);
  _lastNotificationWallMs = wallNow;

  // Chain onto the in-flight native call so we never have two
  // displayNotification calls concurrently touching the same FG service.
  // The worker doesn't wait on the chain (this is fire-and-forget) — its
  // store update already happened above; the notification is decorative.
  _notificationFlight = _notificationFlight
    .then(() => updateDownloadProgress(title, artist, pct, queueLength))
    .catch((err) => {
      logger.warn('[DownloadManager] Failed to update progress notification:', err);
    });
}

// ── notifee background event (module-top-level) ────────────────────────────

/**
 * notifee requires `onBackgroundEvent` to be registered at module top-level
 * (before the JS bundle finishes evaluating) for reliable dispatch when the
 * app is killed/backgrounded. Registering it inside a class constructor
 * occasionally misses early events.
 *
 * The handler defers to the singleton `DownloadManager` exported at the
 * bottom of this file — declared with `var` hoisting via a getter so the TDZ
 * isn't an issue at module-eval time.
 */
notifee.onBackgroundEvent(async ({ type, detail }) => {
  if (type === EventType.ACTION_PRESS) {
    const actionId = detail.pressAction?.id;
    if (actionId === 'cancel-current') DownloadManager.cancelCurrent();
    if (actionId === 'cancel-all') DownloadManager.cancelAll();
  }
});

// ── Module-level unhandled-rejection guard ─────────────────────────────────
// React Native (Hermes) surfaces unhandled promise rejections as a yellow-box
// warning by default — but a rejection that escapes a `void` call inside a
// touch handler can still crash the app on some Android builds. Install a
// last-ditch handler via the global ErrorUtils API so an unhandled rejection
// from anywhere in the download pipeline is logged instead of fatal.
try {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g: any = globalThis as any;
  if (g?.HermesInternal?.enablePromiseRejectionTracker) {
    g.HermesInternal.enablePromiseRejectionTracker({
      allRejections: true,
      onUnhandled: (id: number, rejection: unknown) => {
        const msg = rejection instanceof Error ? rejection.message : String(rejection);
        logger.warn(`[DownloadManager] Unhandled promise rejection (id=${id}): ${msg}`);
      },
    });
  }
} catch (err) {
  logger.warn('[DownloadManager] Could not install rejection tracker:', err);
}

// ── Foreground listener ref-counting ───────────────────────────────────────

/**
 * The notifee foreground listener is shared across UI consumers. Each call
 * to `registerForegroundListener()` increments a ref-count; the returned
 * cleanup decrements. Only when the count hits zero do we actually unsubscribe.
 *
 * Why: React Native screen remounts (especially during fast-refresh or the
 * Settings drawer toggle) would otherwise unsubscribe the listener mid-session
 * and the user's "Cancel" tap in the notification would be silently ignored.
 */
let _foregroundListenerRefCount = 0;
const _foregroundUnsubscribes: Array<() => void> = [];

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
 *
 * Before computing the set, this also cleans up broken rows (durationMs ≤ 0
 * or missing filePath) in a single transaction — same logic as the per-item
 * cleanup in `enqueue`. Without this step, a bulk approval where some library
 * rows are broken would silently dedupe them away and the user would see
 * "this song is already in your library" forever.
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

  // Collect every broken row across both queries, then purge them in ONE
  // database transaction — keeps the write batched even for huge bulk
  // approvals where dozens of rows could be broken simultaneously.
  const brokenRows = [
    ...ytRows.filter((r) => r.durationMs <= 0 || !r.filePath),
    ...snRows.filter((r) => r.durationMs <= 0 || !r.filePath),
  ];
  if (brokenRows.length > 0) {
    await database.write(async () => {
      for (const track of brokenRows) {
        await deleteFile(track.filePath).catch(() => {});
        if (track.artworkPath) await deleteFile(track.artworkPath).catch(() => {});
        await track.destroyPermanently();
      }
    });
  }

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
  // The notifee `onBackgroundEvent` registration lives at module top-level
  // (see above) — required for reliable dispatch when the app is killed.
  // The constructor is intentionally empty.

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
        // Stamp the user's Settings → Audio Quality at enqueue time so the
        // worker picks it up later. Caller-supplied `params.quality` wins when
        // present (the Downloads screen passes '320k' explicitly).
        quality: params.quality ?? readDownloadQuality(),
      });

      // Kick off the worker pool. Defensive — _ensureProcessorRunning is
      // already async/awaited internally, but a synchronous throw before the
      // first `await` would otherwise bubble up to the caller as a rejected
      // promise the UI's `void` doesn't observe. Catch + log so the user's
      // tap can never crash the app even if the pool start path explodes.
      try {
        void this._ensureProcessorRunning().catch((err) =>
          logger.warn('[DownloadManager] _ensureProcessorRunning rejected:', err),
        );
      } catch (err) {
        logger.warn('[DownloadManager] _ensureProcessorRunning threw synchronously:', err);
      }
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

      // Read user-quality ONCE per batch so we don't pay for N store reads.
      // A toggle mid-batch shouldn't cause inconsistent quality within the
      // same enqueueBatch call.
      const batchQuality = readDownloadQuality();

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
          // Same Settings → Audio Quality stamp as the single-item enqueue path.
          quality: params.quality ?? batchQuality,
        });
      }

      if (toAdd.length > 0) {
        store.addManyToQueue(toAdd);
        try {
          void this._ensureProcessorRunning().catch((err) =>
            logger.warn('[DownloadManager] _ensureProcessorRunning (batch) rejected:', err),
          );
        } catch (err) {
          logger.warn('[DownloadManager] _ensureProcessorRunning (batch) threw:', err);
        }
      }

      const reason =
        rejected > 0
          ? `Library would exceed the ${MAX_LIBRARY_SIZE}-song cap — ${rejected} skipped.`
          : undefined;

      return { accepted: toAdd.length, skipped, rejected, reason };
    });
  }

  cancelCurrent(): void {
    const store = useDownloadStore.getState();
    for (const item of store.queue) {
      if (
        item.status === 'downloading' ||
        item.status === 'converting' ||
        item.status === 'tagging'
      ) {
        _cancelledIds.add(item.id);
        // Abort any in-flight RNBlobUtil fetch for this id so the native
        // download stops immediately rather than running to its 30s timeout.
        const task = _activeFetchTasks.get(item.id);
        if (task) {
          try {
            task.cancel();
          } catch {
            // Task may have already settled — fine to ignore.
          }
        }
        store.setError(item.id, 'Cancelled by user');
      }
    }
  }

  cancelAll(): void {
    _cancelAll = true;
    _sessionCancelled = true;
    const store = useDownloadStore.getState();
    for (const item of store.queue) {
      if (item.status !== 'done' && item.status !== 'error') {
        // Add active items to per-id cancel set so the inner pipeline
        // checkpoints abort promptly (not just the worker's queue check).
        if (
          item.status === 'downloading' ||
          item.status === 'converting' ||
          item.status === 'tagging'
        ) {
          _cancelledIds.add(item.id);
          // Abort any in-flight RNBlobUtil fetch — same rationale as
          // `cancelCurrent`. Without this, the foreground service can
          // linger for up to 30 s waiting on a doomed HTTP fetch.
          const task = _activeFetchTasks.get(item.id);
          if (task) {
            try {
              task.cancel();
            } catch {
              // ignore — task may have settled in the meantime.
            }
          }
        }
        store.setError(item.id, 'Cancelled');
      }
    }
  }

  get isRunning(): boolean {
    return _isProcessorRunning;
  }

  registerForegroundListener(): () => void {
    // Ref-counted. Each call subscribes a fresh notifee handler and pushes
    // its unsubscribe into the shared list. The returned cleanup decrements
    // the count and pops one unsubscribe; only when the count returns to
    // zero do we actually tear down. This protects against UI remounts
    // (Settings drawer toggle, fast-refresh) tearing down a listener that
    // another live subscriber still depends on.
    const unsub = registerForegroundEventHandler(
      () => this.cancelCurrent(),
      () => this.cancelAll(),
    );
    _foregroundUnsubscribes.push(unsub);
    _foregroundListenerRefCount += 1;

    let released = false;
    return () => {
      if (released) return;
      released = true;
      _foregroundListenerRefCount = Math.max(0, _foregroundListenerRefCount - 1);
      const popped = _foregroundUnsubscribes.pop();
      if (_foregroundListenerRefCount === 0) {
        // Drain any remaining unsubscribes — should be at most one (popped).
        try {
          popped?.();
        } catch (err) {
          logger.warn('[DownloadManager] Foreground listener unsubscribe failed:', err);
        }
        while (_foregroundUnsubscribes.length > 0) {
          const u = _foregroundUnsubscribes.pop();
          try {
            u?.();
          } catch (err) {
            logger.warn('[DownloadManager] Foreground listener unsubscribe failed:', err);
          }
        }
      } else if (popped) {
        // Other subscribers still alive — push the unsub back to keep parity
        // with the ref-count. We just leak one extra handler entry until the
        // last release flushes everything; balance is restored at zero.
        _foregroundUnsubscribes.push(popped);
      }
    };
  }

  // ── Worker pool ────────────────────────────────────────────────────────

  /**
   * Starts the worker pool if it isn't already running. Spawns up to
   * MAX_CONCURRENT workers — each pulls one queued item at a time until the
   * queue is drained.
   *
   * Cancel-race handling
   * ────────────────────
   * Resetting `_cancelAll` is conditional now, not unconditional:
   *  - Fresh pool (not running, not cancelled)  → reset both flags, start workers
   *  - Running, not cancelled                   → drain loop already handles new items, no-op
   *  - Running, mid-cancel                      → do NOTHING — let the cancel drain finish.
   *                                               The .finally() block below auto-restarts the
   *                                               pool for any items still queued after settle.
   * Without this, an enqueue immediately after cancelAll() would resurrect the cancelled
   * session: `_sessionCancelled` would stay true and the .finally() block would auto-prune
   * the user's freshly queued items.
   */
  private async _ensureProcessorRunning(): Promise<void> {
    if (_isProcessorRunning) {
      if (_sessionCancelled || _cancelAll) {
        // Mid-cancel — do not stomp on the cancel state. The .finally()
        // below will re-invoke _ensureProcessorRunning() after settle if
        // there are still queued items to pick up.
        return;
      }
      // Pool running normally; drain loop will see the new queue entries
      // on its next iteration. Safe no-op.
      return;
    }

    // Fresh pool — safe to reset both flags now.
    _cancelAll = false;
    _isProcessorRunning = true;
    _sessionCancelled = false;
    _completedThisSession = 0;
    _lastNotificationWallMs = 0;
    _lastNotificationProgress.clear();
    _lastNotificationStatus.clear();
    try {
      resetErrorNotificationState();
    } catch (err) {
      logger.warn('[DownloadManager] resetErrorNotificationState failed:', err);
    }
    try {
      clearSaavnUrlCache();
    } catch (err) {
      logger.warn('[DownloadManager] clearSaavnUrlCache failed:', err);
    }

    const firstTitle = useDownloadStore.getState().queue.find((i) => i.status === 'queued')?.title;
    try {
      await startDownloadForegroundService(firstTitle ?? 'Downloading…');
    } catch (err) {
      // Never let foreground-service failure propagate up — downloads can
      // still complete without it; the OS just won't keep the JS thread
      // alive when the screen is off. Better than crashing on the tap.
      logger.warn('[DownloadManager] Could not start foreground service:', err);
    }

    const workers: Promise<void>[] = [];
    for (let i = 0; i < MAX_CONCURRENT; i++) workers.push(this._worker());
    Promise.all(workers)
      .catch((err) => logger.warn('[DownloadManager] Unexpected worker pool error:', err))
      .finally(() => {
        _isProcessorRunning = false;
        _activeCount = 0;
        const wasCancelled = _sessionCancelled;
        stopDownloadForegroundService(wasCancelled ? 0 : _completedThisSession).catch((err) =>
          logger.warn('[DownloadManager] Failed to stop foreground service:', err),
        );
        _completedThisSession = 0;
        // Saavn auth-token URLs expire fast (~10 min). After a cancel the
        // cache is full of URLs we never used; clearing it here means the
        // next session re-fetches fresh ones, avoiding 403s on retry.
        if (wasCancelled) {
          try {
            clearSaavnUrlCache();
          } catch (err) {
            logger.warn('[DownloadManager] Failed to clear Saavn URL cache after cancel:', err);
          }
        }
        // Auto-prune cancelled/errored items only when the user explicitly
        // cancelled the entire session. Otherwise leave them so the user can
        // still see (and potentially retry) the individual failures.
        if (wasCancelled) {
          try {
            // Single atomic mutation — previously two sequential setState
            // calls (clearErrored + clearCompleted) caused subscribers to
            // re-render twice in a row for the same logical action.
            useDownloadStore.getState().clearCompletedAndErrored();
          } catch (err) {
            logger.warn('[DownloadManager] Failed to auto-prune queue after cancel:', err);
          }
        }

        // If items were enqueued mid-cancel (or the user re-enqueued
        // immediately after the .finally fires), kick off a fresh pool so
        // they don't sit orphaned in the 'queued' state forever. Guarded so
        // we don't recurse — `_isProcessorRunning` was just set to false.
        try {
          const stillQueued = useDownloadStore
            .getState()
            .queue.some((i) => i.status === 'queued');
          if (stillQueued) {
            // Schedule on a microtask so the current .finally fully unwinds
            // before the new pool starts (prevents re-entrancy on
            // `_isProcessorRunning`).
            Promise.resolve().then(() => {
              try {
                void this._ensureProcessorRunning();
              } catch (err) {
                logger.warn('[DownloadManager] Restart-after-drain failed:', err);
              }
            });
          }
        } catch (err) {
          logger.warn('[DownloadManager] Post-drain restart check failed:', err);
        }
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
      // workers see it as taken. Note: we intentionally do NOT reset
      // `_cancelCurrent` here (it no longer exists). Each pipeline now keys
      // its cancel checks off `_cancelledIds.has(id)` so different items
      // can't share cancellation state.
      store.updateProgress(next.id, 0, 'downloading');
      _activeCount += 1;

      const resolved: ResolvedParams = {
        youtubeId: next.youtubeId,
        title: next.title,
        artist: next.artist,
        album: next.album && next.album.trim() ? next.album : 'Unknown Album',
        thumbnail: next.thumbnail,
        durationMs: next.durationMs ?? 0,
        // Honour the per-item quality stamped at enqueue-time. Items predating
        // the quality-honouring fix won't carry the field — fall back to the
        // current user setting in that case so older queue rows still respect
        // Settings → Audio Quality.
        quality: next.quality ?? readDownloadQuality(),
        provider: next.provider ?? 'youtube',
        saavnEncryptedUrl: next.saavnEncryptedUrl,
        saavnHas320kbps: next.saavnHas320kbps,
      };

      const remaining = store.queue.filter(
        (i) => i.status === 'queued' || i.status === 'downloading',
      ).length;

      // Immediately refresh the foreground-service title for the newly
      // claimed item — don't wait for the first progress tick (which can be
      // 0.5–1.5 s away while we resolve the stream URL). Uses the throttled
      // helper so it won't fight the inner progress updates.
      await pushProgress(
        next.id,
        resolved.title,
        resolved.artist,
        0,
        remaining,
        'downloading',
      );

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
        // Always release this id's cancel flag (even on success) so a stale
        // flag set during shutdown of a previous pipeline can't poison a
        // hypothetical retry on the same id. Same idea for the in-flight
        // fetch registry — by this point the fetch has settled, but a
        // late-arriving cancelAll could still try to walk the map.
        _cancelledIds.delete(next.id);
        _activeFetchTasks.delete(next.id);
        _lastNotificationProgress.delete(next.id);
        _lastNotificationStatus.delete(next.id);
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
    const isCancelled = (): boolean => _cancelledIds.has(id) || _cancelAll;

    const reportProgress = async (pct: number, status: DownloadStatus): Promise<void> => {
      await pushProgress(id, params.title, params.artist, pct, queueLength, status);
      if (isCancelled()) throw new Error('Cancelled by user');
    };

    const tempDir = await getTempDir();
    // Tracks the artwork download outcome so the `finally` block can clean up
    // an orphaned JPG if the audio pipeline failed or was cancelled before we
    // ever wrote a DB row referencing it.
    let artworkPromise: Promise<string | null> | null = null;
    let dbRowCreated = false;

    try {
      // ── 1. Resolve stream ──────────────────────────────────────────────
      await reportProgress(5, 'downloading');

      // Resolve via the multi-source resolver. It tries Saavn (primary) →
      // Saavn mirrors → Piped/Invidious YT proxies → direct YT extractor →
      // Audius / SoundCloud / Internet Archive / Jamendo in priority order.
      // The hints branch routes the fastest path: a Saavn-provider item
      // arrives with `saavnEncryptedUrl` so we never search needlessly.
      const resolverQuery = `${params.title} ${params.artist}`.trim();
      let stream: AudioStreamInfo;
      try {
        stream = await resolveAudioStream({
          query: resolverQuery,
          preferredQuality: params.quality,
          hints: {
            youtubeId: params.provider === 'youtube' ? params.youtubeId : undefined,
            saavnId: params.provider === 'saavn' ? params.youtubeId : undefined,
            saavnEncryptedUrl: params.saavnEncryptedUrl,
            saavnHas320kbps: params.saavnHas320kbps,
          },
        });
      } catch (err) {
        // Normalize any non-Error rejections (some providers throw strings
        // via the JSON-parse path). Without this, an unhandled non-Error
        // can crash on bridges that assume `err.message` exists.
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`[Resolver] ${message}`);
      }
      if (!stream || typeof stream !== 'object') {
        throw new Error('[Resolver] returned a non-object stream — provider chain misbehaved.');
      }

      // Preserve the search-time duration when the provider couldn't report it.
      if (stream.durationMs <= 0 && params.durationMs > 0) {
        stream = { ...stream, durationMs: params.durationMs };
      }

      if (!stream.url || stream.url.length < 20) {
        throw new Error(
          `Empty/invalid stream URL returned for "${params.title}" — ` +
            `${params.provider === 'saavn' ? 'Saavn auth-token request' : 'YouTube cipher decode'} likely failed.`,
        );
      }

      if (isCancelled()) throw new Error('Cancelled by user');

      // ── 2. Kick off artwork download in parallel with the audio fetch.
      // The artwork download is independent and typically takes 0.5–1.5 s —
      // running it in parallel hides that latency. Pass title+artist so the
      // ArtworkResolver can promote a low-res primary URL to a high-res
      // cover via iTunes / Deezer / MusicBrainz when needed.
      artworkPromise = downloadArtwork(
        params.thumbnail,
        id,
        { title: params.title, artist: params.artist },
      ).catch(() => null);

      // ── 3. Download raw stream — with retry + refresh ──────────────────
      // Generate a unique temp path per attempt to avoid collisions when many
      // workers run in parallel.
      const tempRawPath = `${tempDir}${id}.${stream.container}`;

      let downloaded = false;
      let lastDownloadError: unknown = null;
      let activeStreamUrl = stream.url;
      let streamRefreshes = 0;
      let attempt = 0;

      while (attempt < MAX_DOWNLOAD_ATTEMPTS && !downloaded) {
        if (isCancelled()) {
          throw new Error('Cancelled by user');
        }

        const headers = DOWNLOAD_HEADER_SETS[attempt % DOWNLOAD_HEADER_SETS.length];
        attempt += 1;

        let response: Awaited<
          ReturnType<ReturnType<typeof RNBlobUtil.config>['fetch']>
        > | null = null;
        try {
          await deleteFile(tempRawPath).catch(() => {});
          const mergedHeaders = stream.requestHeaders
            ? { ...headers, ...stream.requestHeaders }
            : headers;
          // Hold the StatefulPromise so `cancelCurrent`/`cancelAll` can
          // invoke `.cancel()` mid-fetch — RNBlobUtil doesn't honour
          // AbortController, but its native task has its own cancel hook.
          const task = RNBlobUtil.config({ path: tempRawPath }).fetch(
            'GET',
            activeStreamUrl,
            mergedHeaders,
          );
          _activeFetchTasks.set(id, task);
          try {
            response = await task.progress(
              { count: 20, interval: 300 },
              async (received: number, total: number) => {
                if (total > 0) {
                  const pct = 5 + Math.round((received / total) * 60);
                  // Centralized in `pushProgress` — handles both store update
                  // and notification throttling (wall-clock + delta + stage).
                  await pushProgress(
                    id,
                    params.title,
                    params.artist,
                    pct,
                    queueLength,
                    'downloading',
                  );
                }
              },
            );
          } finally {
            // Always release the registry slot once the fetch settles, so
            // a later cancel call can't attempt to cancel a no-op task.
            _activeFetchTasks.delete(id);
          }
          if (!response) throw new Error('Fetch returned no response');
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
              // Re-resolve via the multi-source chain — falls through to
              // alternative sources if the original provider is now down.
              const refreshed: AudioStreamInfo = await resolveAudioStream({
                query: `${params.title} ${params.artist}`.trim(),
                preferredQuality: params.quality,
                hints: {
                  youtubeId: params.provider === 'youtube' ? params.youtubeId : undefined,
                  saavnId: params.provider === 'saavn' ? params.youtubeId : undefined,
                  saavnEncryptedUrl: params.saavnEncryptedUrl,
                  saavnHas320kbps: params.saavnHas320kbps,
                },
              });
              if (refreshed.url && refreshed.url.length > 20) {
                activeStreamUrl = refreshed.url;
                // Headers may have changed if the new source is different;
                // update the stream object so the next retry uses them.
                if (refreshed.requestHeaders) {
                  stream = { ...stream, requestHeaders: refreshed.requestHeaders };
                }
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

      if (isCancelled()) throw new Error('Cancelled by user');

      // ── 4. Stream-copy to final container ──────────────────────────────
      await reportProgress(85, 'converting');

      // Map container → file extension. mp3 must use .mp3 so MediaStore
      // (and any external file browser) picks up the audio/mpeg MIME and
      // ID3 readers can find the tag block.
      const finalExt: 'm4a' | 'webm' | 'mp3' =
        stream.container === 'm4a'
          ? 'm4a'
          : stream.container === 'mp3'
            ? 'mp3'
            : 'webm';
      const tempStagePath = `${tempDir}${id}.${finalExt}`;

      if (tempRawPath !== tempStagePath) {
        await RNBlobUtil.fs.cp(tempRawPath, tempStagePath);
        await deleteFile(tempRawPath);
      }

      if (isCancelled()) throw new Error('Cancelled by user');

      // ── 5. Await the artwork that's been downloading in parallel ───────
      await reportProgress(88, 'tagging');
      const artworkPath = await artworkPromise;

      if (isCancelled()) throw new Error('Cancelled by user');

      // ── 6. Copy to music directory ─────────────────────────────────────
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
      await deleteFile(tempStagePath).catch(() => {});

      // ── 7. Insert DB row ───────────────────────────────────────────────
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
      dbRowCreated = true;

      getStore().updateProgress(id, 100, 'done');
    } finally {
      // If the pipeline failed before the DB row was inserted but the
      // parallel artwork download already resolved with a file path, that
      // JPG is now orphaned — no DB row will ever reference it. Delete it
      // here so cancelled/failed downloads don't leak cache entries.
      if (!dbRowCreated && artworkPromise) {
        try {
          const orphanedArtworkPath = await artworkPromise;
          if (orphanedArtworkPath) {
            await deleteFile(orphanedArtworkPath).catch(() => {});
          }
        } catch {
          // The .catch(() => null) above already swallows download errors;
          // any thrown here is unexpected — ignore so we don't mask the
          // primary failure that landed us in this block.
        }
      }

      // Always purge any leftover temp files for this id, regardless of how
      // the pipeline exited (success, cancel, or any error). Without this,
      // a cancel mid-download would leave a multi-MB raw file under tempDir
      // until the OS cache eviction eventually swept it.
      try {
        const entries = await RNBlobUtil.fs.ls(tempDir);
        const prefix = `${id}.`;
        for (const name of entries) {
          if (name.startsWith(prefix)) {
            await deleteFile(`${tempDir}${name}`).catch(() => {});
          }
        }
      } catch (err) {
        logger.warn('[DownloadManager] Temp cleanup failed:', err);
      }
    }
  }
}

export const DownloadManager = new DownloadManagerClass();
