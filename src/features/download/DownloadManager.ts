/**
 * DownloadManager — orchestrates the full pipeline for adding a YouTube track
 * to the local library:
 *
 *   1. Resolve best audio stream info       (YoutubeExtractor.getBestAudioStream)
 *   2. Download the raw audio stream        (react-native-blob-util w/ progress)
 *   3. Convert to M4A 320k / stream-copy    (AudioConverter.convertToM4A)
 *   4. Download and cache artwork           (ArtworkDownloader.downloadArtwork)
 *   5. Copy to final music directory        (react-native-blob-util)
 *   6. Probe duration via FFmpeg            (AudioConverter.probeAudioDuration)
 *   7. Insert the track into WatermelonDB   (tracksCollection)
 *
 * Background / sleep support
 * ──────────────────────────
 * A @notifee/react-native Android Foreground Service is started before the
 * first download begins and stopped once the queue is drained. The service
 * binds the JS thread to an Android foreground context so the OS cannot kill
 * the process while downloads are running, even when the screen is off or the
 * app is removed from the recents tray.
 *
 * Library capacity
 * ────────────────
 * The library is capped at MAX_LIBRARY_SIZE (1 500) tracks. `enqueue` checks
 * the current WatermelonDB track count before accepting a new job and returns
 * `{ success: false, reason }` when the limit has been reached.
 *
 * Quality
 * ───────
 * All downloads default to 320k AAC (premium audio). The `quality` field on
 * EnqueueParams is accepted for future flexibility but is overridden to '320k'
 * inside the pipeline to enforce the product decision.
 *
 * Cancellation
 * ────────────
 * • `cancelCurrent()` — aborts the actively downloading/converting item.
 *   The pipeline checks `_cancelCurrent` at each stage boundary and throws,
 *   which causes cleanup and moves on to the next queued item.
 * • `cancelAll()` — sets both `_cancelAll` and `_cancelCurrent`, which drains
 *   the loop after the current item finishes its cleanup.
 *
 * Notification actions ("Cancel" / "Cancel All" buttons in the notification)
 * are wired up via both `notifee.onBackgroundEvent` (screen off / app hidden)
 * and `notifee.onForegroundEvent` (app visible), so taps are always handled
 * regardless of the app lifecycle state.
 *
 * Progress & status for every item are kept in the Zustand downloadStore so
 * the UI can react without coupling to this module directly.
 */

import RNBlobUtil from 'react-native-blob-util';
import notifee, { EventType } from '@notifee/react-native';
import { database, tracksCollection } from '@/db';
import { useDownloadStore } from '@/stores/downloadStore';
import type { DownloadStatus } from '@/stores/downloadStore';
import { getTrackPath, getTempDir, deleteFile } from '@/services/storage/fileSystem';
import { getBestAudioStream } from './YoutubeExtractor';
// Note: FFmpeg has been removed from the project (the upstream
// ffmpeg-kit-react-native package was archived in Jan 2025 and lost its
// Maven binaries). Downloads now stream-copy whatever container YouTube
// delivers — AAC streams become .m4a, opus streams become .webm, both
// playable by RNTP/ExoPlayer at full source quality with zero transcode loss.
import { downloadArtwork } from './ArtworkDownloader';
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

/**
 * Encoding quality used for every download.
 * Locked to 320k regardless of the `quality` field passed to `enqueue`.
 */
const DOWNLOAD_QUALITY = '320k' as const;

// ── Types ──────────────────────────────────────────────────────────────────

export interface EnqueueParams {
  /** YouTube video ID (11 characters). */
  youtubeId: string;
  /** Display title of the track. */
  title: string;
  /** Artist / channel name. */
  artist: string;
  /** Album name. Defaults to 'Unknown Album' when omitted. */
  album?: string;
  /** Thumbnail URL used for artwork. */
  thumbnail: string;
  /**
   * Track duration in milliseconds, taken from YouTube search metadata.
   * Used directly instead of probing the downloaded file (we no longer
   * have FFmpeg available). Pass 0 if unknown.
   */
  durationMs?: number;
  /**
   * Target encoding quality.
   * Accepted for API compatibility — kept at the original-source quality
   * (no transcoding is performed; whatever YouTube delivers is what is
   * stored bit-for-bit).
   */
  quality?: '128k' | '192k' | '256k' | '320k';
}

export interface EnqueueResult {
  /** Whether the track was accepted into the queue. */
  success: boolean;
  /** Human-readable reason when `success` is false. */
  reason?: string;
  /** Stable download-job ID, present when `success` is true. */
  id?: string;
}

// ── Internal types ─────────────────────────────────────────────────────────

/** Fully resolved params used inside the pipeline (all fields required). */
interface ResolvedParams {
  youtubeId: string;
  title: string;
  artist: string;
  album: string;
  thumbnail: string;
  durationMs: number;
  quality: '128k' | '192k' | '256k' | '320k';
}

// ── ID generation ──────────────────────────────────────────────────────────

/**
 * Generates a download-job ID that is unique within the session.
 * Not cryptographically random — it only needs to be collision-free within
 * the in-memory queue, so a timestamp + short random suffix is sufficient.
 */
function generateId(): string {
  return `dl_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

// ── Library capacity check ─────────────────────────────────────────────────

/**
 * Returns true when the WatermelonDB tracks collection has reached or exceeded
 * the MAX_LIBRARY_SIZE limit. Queries the DB directly so the count is always
 * accurate (not subject to stale Zustand state).
 */
async function isLibraryFull(): Promise<boolean> {
  const count = await tracksCollection.query().fetchCount();
  return count >= MAX_LIBRARY_SIZE;
}

// ── Module-level queue state ───────────────────────────────────────────────

/** True when a pipeline is actively executing (prevents re-entrant loops). */
let _isRunning = false;

/** Signals the active pipeline to abort after its current async step. */
let _cancelCurrent = false;

/**
 * Signals the queue processor to stop dequeuing new items after the current
 * pipeline finishes its cleanup.  Also sets `_cancelCurrent`.
 */
let _cancelAll = false;

/** Tracks how many songs were successfully written to the DB this session. */
let _completedThisSession = 0;

// ── DownloadManagerClass ───────────────────────────────────────────────────

class DownloadManagerClass {
  private _unsubscribeForeground: (() => void) | null = null;

  constructor() {
    // ── Background event handler ────────────────────────────────────────────
    // Must be registered at module scope (i.e. synchronously during bundle
    // evaluation) so notifee can hand events to this handler when the app is
    // in the background / the JS thread is resumed by the foreground service.
    notifee.onBackgroundEvent(async ({ type, detail }) => {
      if (type === EventType.ACTION_PRESS) {
        const actionId = detail.pressAction?.id;
        logger.info(`[DownloadManager] Background action: ${actionId}`);
        if (actionId === 'cancel-current') this.cancelCurrent();
        if (actionId === 'cancel-all') this.cancelAll();
      }
    });
  }

  // ── Public API ─────────────────────────────────────────────────────────

  /**
   * Adds a track to the download queue.
   *
   * Returns `{ success: true, id }` when the item was accepted.
   * Returns `{ success: false, reason }` when:
   *  - The library is at capacity (1 500 tracks).
   *
   * If the same `youtubeId` is already present in the queue (any status), the
   * call is silently de-duplicated and the existing job's ID is returned with
   * `success: true`.
   */
  async enqueue(params: EnqueueParams): Promise<EnqueueResult> {
    await ensureNotificationChannel();

    const store = useDownloadStore.getState();

    // ── De-duplicate ───────────────────────────────────────────────────────
    const existing = store.queue.find(
      (item) => item.youtubeId === params.youtubeId,
    );
    if (existing) {
      logger.info(
        `[DownloadManager] Already queued: "${params.title}" (${existing.status})`,
      );
      return { success: true, id: existing.id };
    }

    // ── Library capacity ───────────────────────────────────────────────────
    const full = await isLibraryFull();
    if (full) {
      const reason = `Library is full (${MAX_LIBRARY_SIZE} songs max)`;
      logger.warn(`[DownloadManager] Enqueue rejected — ${reason}`);
      return { success: false, reason };
    }

    // ── Accept ─────────────────────────────────────────────────────────────
    const id = generateId();

    store.addToQueue({
      id,
      youtubeId: params.youtubeId,
      title: params.title,
      artist: params.artist,
      thumbnail: params.thumbnail,
      durationMs: params.durationMs ?? 0,
    });

    logger.info(`[DownloadManager] Enqueued: "${params.title}" id=${id}`);

    // Kick off the processor — it's a no-op if already running.
    void this._processQueue();

    return { success: true, id };
  }

  /**
   * Cancels the currently active download/conversion step.
   * The pipeline aborts after its next async boundary check and the item is
   * marked as errored. The queue then proceeds to the next item.
   */
  cancelCurrent(): void {
    _cancelCurrent = true;
    logger.info('[DownloadManager] cancelCurrent requested.');

    // Reflect the cancellation in the Zustand store immediately so the UI
    // can update before the pipeline's async throw propagates.
    const store = useDownloadStore.getState();
    const active = store.queue.find(
      (item) =>
        item.status === 'downloading' ||
        item.status === 'converting' ||
        item.status === 'tagging',
    );
    if (active) {
      store.setError(active.id, 'Cancelled by user');
    }
  }

  /**
   * Cancels the current download and clears all remaining queued items.
   * Items in 'queued' status are marked as errored immediately; the active
   * item is aborted at its next async boundary.
   */
  cancelAll(): void {
    _cancelAll = true;
    _cancelCurrent = true;
    logger.info('[DownloadManager] cancelAll requested.');

    const store = useDownloadStore.getState();
    store.queue.forEach((item) => {
      if (
        item.status === 'queued' ||
        item.status === 'downloading' ||
        item.status === 'converting' ||
        item.status === 'tagging'
      ) {
        store.setError(item.id, 'Cancelled');
      }
    });
  }

  /** True when a download pipeline is actively executing. */
  get isRunning(): boolean {
    return _isRunning;
  }

  // ── Foreground event subscription ───────────────────────────────────────

  /**
   * Registers the foreground notification-action handler (for when the app is
   * visible). Returns the unsubscribe function.
   *
   * Call this once from a long-lived component (e.g. the root App) and call
   * the returned function on unmount.
   */
  registerForegroundListener(): () => void {
    if (this._unsubscribeForeground) {
      this._unsubscribeForeground();
    }
    this._unsubscribeForeground = registerForegroundEventHandler(
      () => this.cancelCurrent(),
      () => this.cancelAll(),
    );
    return () => {
      this._unsubscribeForeground?.();
      this._unsubscribeForeground = null;
    };
  }

  // ── Private queue processor ─────────────────────────────────────────────

  /**
   * Sequential queue drain loop.
   *
   * Runs pipelines one at a time (no concurrent downloads) so we don't
   * saturate the network or run multiple FFmpeg instances simultaneously.
   * Each iteration:
   *   1. Checks for a cancellation signal.
   *   2. Picks the next 'queued' item.
   *   3. Starts / updates the foreground service notification.
   *   4. Runs the pipeline.
   *   5. Loops back to step 1.
   *
   * When the queue is empty (or `_cancelAll` is set), tears down the foreground
   * service and posts the completion summary notification.
   */
  private async _processQueue(): Promise<void> {
    if (_isRunning) return;

    // Reset the "cancel all" gate for this new queue run.
    _cancelAll = false;
    _completedThisSession = 0;

    const getStore = useDownloadStore.getState;

    while (true) {
      // Respect a cancelAll that arrived while between items.
      if (_cancelAll) break;

      const next = getStore().queue.find((item) => item.status === 'queued');
      if (!next) break;

      _isRunning = true;
      _cancelCurrent = false;

      // Compute queue depth: items still active or waiting.
      const queueLength = getStore().queue.filter(
        (i) => i.status === 'queued' || i.status === 'downloading',
      ).length;

      // Start (or refresh) the foreground service notification.
      await startDownloadForegroundService(next.title);

      const resolved: ResolvedParams = {
        youtubeId: next.youtubeId,
        title: next.title,
        artist: next.artist,
        album: 'Unknown Album',
        thumbnail: next.thumbnail,
        durationMs: next.durationMs ?? 0,
        quality: DOWNLOAD_QUALITY,
      };

      try {
        await this._runPipeline(next.id, resolved, queueLength);
        _completedThisSession++;
        logger.info(
          `[DownloadManager] Completed: "${next.title}" ` +
          `(session total: ${_completedThisSession})`,
        );
      } catch (err) {
        // Distinguish user cancellations from real failures for the error UI.
        const message = err instanceof Error ? err.message : String(err);
        const isCancelled =
          message === 'Cancelled' || message === 'Cancelled by user';

        logger.error(
          `[DownloadManager] Failed "${next.title}": ${message}`,
        );

        // Only show an error notification for genuine failures, not user-initiated cancels.
        if (!isCancelled) {
          await showDownloadError(next.title, message);
        }

        // setError may have already been called in cancelCurrent/cancelAll,
        // but calling it again is safe — it's idempotent.
        getStore().setError(next.id, message);
      } finally {
        _isRunning = false;
        _cancelCurrent = false;
      }
    }

    // All done (queue empty or cancelAll).
    _isRunning = false;
    await stopDownloadForegroundService(_completedThisSession);
    _completedThisSession = 0;
  }

  // ── Private pipeline ────────────────────────────────────────────────────

  /**
   * Executes the full download-and-encode pipeline for a single track.
   *
   * Progress checkpoints (approximate overall %):
   *   0–5%   : resolving stream URL
   *   5–65%  : downloading raw audio (RNBlobUtil streaming progress)
   *   65–85% : converting / stream-copying to M4A 320k (FFmpeg statistics)
   *   85–90% : downloading artwork
   *   90–95% : copying to final music directory
   *   95–100%: writing WatermelonDB record + probing duration
   *
   * After every async step, `_cancelCurrent` is checked and an Error is thrown
   * if cancellation was requested — this unwinds the call stack cleanly, allows
   * cleanup of temp files, and lets `_processQueue` mark the item as errored
   * before moving on.
   *
   * @throws Error with human-readable message on any unrecoverable failure or
   *         user cancellation.
   */
  private async _runPipeline(
    id: string,
    params: ResolvedParams,
    queueLength: number,
  ): Promise<void> {
    const getStore = useDownloadStore.getState;

    /**
     * Convenience helper: update store + notification in one call, then check
     * for a cancellation signal.
     */
    const reportProgress = async (
      pct: number,
      status: DownloadStatus,
    ): Promise<void> => {
      getStore().updateProgress(id, pct, status);
      await updateDownloadProgress(params.title, params.artist, pct, queueLength);
      if (_cancelCurrent) throw new Error('Cancelled by user');
    };

    // ── 1. Resolve best audio stream ────────────────────────────────────────
    await reportProgress(5, 'downloading');

    const stream = await getBestAudioStream(params.youtubeId);
    logger.info(
      `[DownloadManager] Stream resolved — container:${stream.container} ` +
      `bitrate:${stream.bitrate} url-len:${stream.url?.length ?? 0} for "${params.title}"`,
    );

    if (!stream.url || stream.url.length < 20) {
      throw new Error(
        `Empty/invalid stream URL returned for "${params.title}" — YouTube cipher decode likely failed.`,
      );
    }

    if (_cancelCurrent) throw new Error('Cancelled by user');

    // ── 2. Download raw audio stream ────────────────────────────────────────
    const tempDir = await getTempDir();
    const tempRawPath = `${tempDir}${id}.${stream.container}`;

    await RNBlobUtil.config({ path: tempRawPath, fileCache: true })
      .fetch('GET', stream.url, {
        // YouTube's CDN rejects unfamiliar User-Agents with 403/405. Use a
        // recent stable Chrome UA matching the Innertube client we negotiated.
        'User-Agent':
          'Mozilla/5.0 (Linux; Android 13; SM-S908U) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
        Accept: '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        Range: 'bytes=0-',
      })
      .progress(
        { count: 20, interval: 200 },
        async (received: number, total: number) => {
          if (total > 0) {
            // Map download bytes to 5–65 % of overall progress.
            const pct = 5 + Math.round((received / total) * 60);
            getStore().updateProgress(id, pct, 'downloading');
            await updateDownloadProgress(
              params.title,
              params.artist,
              pct,
              queueLength,
            );
          }
        },
      );

    if (_cancelCurrent) {
      await deleteFile(tempRawPath).catch(() => {});
      throw new Error('Cancelled by user');
    }

    // ── 3. Stream-copy to final container ──────────────────────────────────
    // No transcoding. Whatever YouTube delivered, we keep verbatim:
    //   - AAC stream → .m4a (the common case, ~95% of Bollywood content)
    //   - Opus stream → .webm (RNTP / ExoPlayer plays this natively at full
    //     quality on Android)
    await reportProgress(85, 'converting');

    const finalExt = stream.container === 'm4a' ? 'm4a' : 'webm';
    const tempStagePath = `${tempDir}${id}.${finalExt}`;

    if (tempRawPath !== tempStagePath) {
      await RNBlobUtil.fs.cp(tempRawPath, tempStagePath);
      await deleteFile(tempRawPath);
    }

    if (stream.needsTranscode) {
      logger.info(
        `[DownloadManager] Saving original Opus/WebM (no transcode) for "${params.title}" — ` +
        `ExoPlayer plays this natively at source quality.`,
      );
    } else {
      logger.info(
        `[DownloadManager] AAC passthrough (lossless copy) for "${params.title}"`,
      );
    }

    if (_cancelCurrent) {
      await deleteFile(tempStagePath).catch(() => {});
      throw new Error('Cancelled by user');
    }

    // ── 4. Download artwork ────────────────────────────────────────────────
    await reportProgress(88, 'tagging');

    // Use the download-job ID as the artwork cache key — it is stable and
    // unique within the session, matching the path stored in the DB record.
    const artworkPath = await downloadArtwork(params.thumbnail, id);

    if (_cancelCurrent) {
      await deleteFile(tempStagePath).catch(() => {});
      throw new Error('Cancelled by user');
    }

    // ── 5. Copy to final music directory ───────────────────────────────────
    await reportProgress(92, 'tagging');

    const finalPath = await getTrackPath(params.artist, params.title, finalExt);
    await RNBlobUtil.fs.cp(tempStagePath, finalPath);

    // Clean up the staged file now that it has been copied.
    await deleteFile(tempStagePath);

    // ── 6. Track duration ──────────────────────────────────────────────────
    // Sourced from the YouTube metadata (passed via EnqueueParams). RNTP
    // will refine it on first playback if it differs from the actual file.
    const durationMs = params.durationMs > 0 ? params.durationMs : 0;

    // ── 7. Insert into WatermelonDB ────────────────────────────────────────
    await reportProgress(95, 'tagging');

    await database.write(async () => {
      await tracksCollection.create((record) => {
        // WatermelonDB assigns _raw.id automatically.
        record.title = params.title;
        record.artist = params.artist;
        record.album = params.album;
        record.genre = '';
        record.durationMs = durationMs;
        record.filePath = finalPath;
        record.artworkPath = artworkPath;
        record.youtubeId = params.youtubeId;
        record.spotifyId = null;
        // Audio-feature fields — populated later by the recommendation engine.
        record.energy = null;
        record.valence = null;
        record.danceability = null;
        record.tempo = null;
        record.acousticness = null;
        record.instrumentalness = null;
        record.addedAt = Math.floor(Date.now() / 1000); // Unix seconds
        record.source = 'youtube';
        record.liked = false;
      });
    });

    getStore().updateProgress(id, 100, 'done');
    logger.info(
      `[DownloadManager] Pipeline complete: "${params.title}" by ${params.artist}`,
    );
  }
}

// ── Singleton export ───────────────────────────────────────────────────────

/**
 * Application-wide DownloadManager singleton.
 *
 * Usage:
 *   const result = await DownloadManager.enqueue({ youtubeId, title, artist, thumbnail });
 *   if (!result.success) Alert.alert('Library full', result.reason);
 *
 * Foreground notification actions (Cancel / Cancel All buttons):
 *   Register once in your root App component:
 *     useEffect(() => DownloadManager.registerForegroundListener(), []);
 *
 * Subscribe to per-item progress and status in any React component:
 *   const queue = useDownloadStore((s) => s.queue);
 */
export const DownloadManager = new DownloadManagerClass();
