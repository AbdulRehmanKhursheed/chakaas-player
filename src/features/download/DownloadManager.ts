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

import { Platform } from 'react-native';
import RNBlobUtil from 'react-native-blob-util';
import notifee, { EventType } from '@notifee/react-native';
import { Q } from '@nozbe/watermelondb';
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

/**
 * Encoding quality used for every download.
 * Locked to 320k regardless of the `quality` field passed to `enqueue`.
 */
const DOWNLOAD_QUALITY = '320k' as const;

// ── Types ──────────────────────────────────────────────────────────────────

export interface EnqueueParams {
  /**
   * Provider-native ID. For YouTube this is the 11-char videoId. For Saavn
   * it's the song id (e.g. "aRZbUYD7"). Named `youtubeId` for backward
   * compatibility with existing call sites; the field is treated as a
   * generic external ID and stored in the right DB column based on
   * `provider`.
   */
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
   * Track duration in milliseconds, taken from search metadata. Used
   * directly instead of probing the downloaded file. Pass 0 if unknown.
   */
  durationMs?: number;
  /**
   * Target encoding quality. Accepted for API compatibility — kept at the
   * original-source quality (no transcoding is performed).
   */
  quality?: '128k' | '192k' | '256k' | '320k';
  /**
   * Which backend to resolve the stream from. Defaults to `youtube` for
   * back-compat — call sites that didn't pass a provider continue working.
   */
  provider?: 'youtube' | 'saavn';
  /** Saavn `encrypted_media_url`. Required when `provider === 'saavn'`. */
  saavnEncryptedUrl?: string;
  /** Whether Saavn 320 kbps tier is available; falls back to 160 kbps if not. */
  saavnHas320kbps?: boolean;
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
  /** External ID (YouTube videoId or Saavn song id). */
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
    logger.info(`[DownloadManager] Published to Android Music library: ${uri}`);
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
    return 'Could not get a playable audio stream from YouTube. Try another result or retry later.';
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

    // Look up by the provider-appropriate ID. When provider isn't given we
    // assume YouTube (back-compat) so existing call sites keep working.
    const provider = params.provider ?? 'youtube';
    const idColumn = provider === 'saavn' ? 'saavn_id' : 'youtube_id';
    const existingLibraryTracks = await tracksCollection
      .query(Q.where(idColumn, params.youtubeId))
      .fetch();
    if (existingLibraryTracks.length > 0) {
      const brokenTracks = existingLibraryTracks.filter(
        (track) => track.durationMs <= 0 || !track.filePath,
      );

      if (brokenTracks.length === 0) {
        const reason = 'This song is already in your library.';
        logger.info(`[DownloadManager] Enqueue rejected — ${reason}`);
        return { success: false, reason };
      }

      logger.warn(
        `[DownloadManager] Removing ${brokenTracks.length} broken existing record(s) before re-download.`,
      );
      await database.write(async () => {
        for (const track of brokenTracks) {
          await deleteFile(track.filePath).catch(() => {});
          if (track.artworkPath) {
            await deleteFile(track.artworkPath).catch(() => {});
          }
          await track.destroyPermanently();
        }
      });
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
      provider,
      album: params.album,
      saavnEncryptedUrl: params.saavnEncryptedUrl,
      saavnHas320kbps: params.saavnHas320kbps,
    });

    logger.info(`[DownloadManager] Enqueued: "${params.title}" id=${id}`);

    // Kick off the processor — it's a no-op if already running.
    void this._processQueue().catch((err) => {
      logger.error('[DownloadManager] Queue processor crashed:', err);
    });

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

      try {
        // Start (or refresh) the foreground service notification.
        await startDownloadForegroundService(next.title);
        await this._runPipeline(next.id, resolved, queueLength);
        _completedThisSession++;
        logger.info(
          `[DownloadManager] Completed: "${next.title}" ` +
          `(session total: ${_completedThisSession})`,
        );
      } catch (err) {
        // Distinguish user cancellations from real failures for the error UI.
        const rawMessage = err instanceof Error ? err.message : String(err);
        const message = toUserFacingDownloadError(err);
        const isCancelled =
          message === 'Cancelled' || message === 'Cancelled by user';

        logger.error(
          `[DownloadManager] Failed "${next.title}": ${rawMessage}`,
        );

        // Always update app state before attempting a system notification.
        getStore().setError(next.id, message);

        // Only show an error notification for genuine failures, not user-initiated cancels.
        if (!isCancelled) {
          try {
            await showDownloadError(next.title, message);
          } catch (notificationErr) {
            logger.warn('[DownloadManager] Failed to show error notification:', notificationErr);
          }
        }
      } finally {
        _isRunning = false;
        _cancelCurrent = false;
      }
    }

    // All done (queue empty or cancelAll).
    _isRunning = false;
    try {
      await stopDownloadForegroundService(_completedThisSession);
    } catch (err) {
      logger.warn('[DownloadManager] Failed to stop foreground service:', err);
    }
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
      try {
        await updateDownloadProgress(params.title, params.artist, pct, queueLength);
      } catch (err) {
        logger.warn('[DownloadManager] Failed to update progress notification:', err);
      }
      if (_cancelCurrent) throw new Error('Cancelled by user');
    };

    // ── 1. Resolve best audio stream ────────────────────────────────────────
    // Pick the resolver based on provider. Saavn is a single deterministic
    // call; YouTube has the multi-client + cipher fallback chain inside
    // getBestAudioStream.
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
        durationMs: params.durationMs > 0 ? params.durationMs : saavnStream.durationMs,
      };
    } else {
      const ytStream = await getBestAudioStream(params.youtubeId);
      stream = ytStream as AudioStreamInfo;
    }

    logger.info(
      `[DownloadManager] Stream resolved — provider:${params.provider} ` +
      `container:${stream.container} bitrate:${stream.bitrate} ` +
      `url-len:${stream.url?.length ?? 0} for "${params.title}"`,
    );

    if (!stream.url || stream.url.length < 20) {
      throw new Error(
        `Empty/invalid stream URL returned for "${params.title}" — ` +
        `${params.provider === 'saavn' ? 'Saavn auth-token request' : 'YouTube cipher decode'} likely failed.`,
      );
    }

    if (_cancelCurrent) throw new Error('Cancelled by user');

    // ── 2. Download raw audio stream ────────────────────────────────────────
    const tempDir = await getTempDir();
    const tempRawPath = `${tempDir}${id}.${stream.container}`;

    let downloaded = false;
    let lastDownloadError: unknown = null;
    // The stream URL may go stale (HTTP 403/410) between resolve and download.
    // We allow up to 2 stream-URL refreshes during the header-set loop.
    let activeStreamUrl = stream.url;
    let streamRefreshes = 0;

    for (const headers of DOWNLOAD_HEADER_SETS) {
      try {
        // Delete any leftover from a previous failed attempt before retrying.
        await deleteFile(tempRawPath).catch(() => {});
        // The stream may carry CDN-required headers (Saavn needs Referer +
        // matching User-Agent). Stream-supplied headers override the rotating
        // header set so the User-Agent stays consistent with the auth-token
        // request that produced the signed URL.
        const mergedHeaders = stream.requestHeaders
          ? { ...headers, ...stream.requestHeaders }
          : headers;
        const response = await RNBlobUtil.config({ path: tempRawPath })
          .fetch('GET', activeStreamUrl, mergedHeaders)
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
                ).catch((err) => {
                  logger.warn('[DownloadManager] Failed to update progress notification:', err);
                });
              }
            },
          );
        const status = response.info().status;
        if (status < 200 || status >= 300) {
          throw new Error(`Audio download returned HTTP ${status}`);
        }

        const stat = await RNBlobUtil.fs.stat(tempRawPath);
        const size = typeof stat.size === 'string'
          ? Number.parseInt(stat.size, 10)
          : stat.size;
        const minExpectedBytes =
          stream.durationMs > 0 && stream.bitrate > 0
            ? Math.min(256 * 1024, Math.round((stream.durationMs / 1000) * (stream.bitrate / 8) * 0.05))
            : 64 * 1024;
        if (!Number.isFinite(size) || size < minExpectedBytes) {
          throw new Error(`Downloaded audio file is too small (${size || 0} bytes)`);
        }
        // Sniff the first few bytes — even a 200 OK can deliver an HTML error
        // body when a CDN reverse-proxies behind a custom error page. If we
        // don't catch it here it'd save to the library and ExoPlayer would
        // later throw `android-parsing-container-unsupported`. Fingerprint
        // valid containers: ftyp box for m4a (offset 4), 0x1A45DFA3 for webm.
        try {
          const sample = await RNBlobUtil.fs.readFile(tempRawPath, 'base64');
          const sampleStr = typeof sample === 'string' ? sample : '';
          const head = sampleStr.slice(0, 128);
          if (head.startsWith('PCFET0NUWVBF') || head.startsWith('PEhUTUw') || head.startsWith('PGh0bWw')) {
            // base64-prefixes for "<!DOCTYPE", "<HTML", "<html"
            throw new Error('Audio download returned HTML error body (CDN rejected the request)');
          }
        } catch (sniffErr) {
          if (sniffErr instanceof Error && sniffErr.message.includes('HTML error body')) {
            throw sniffErr;
          }
          // readFile failure is non-fatal — the size check already vouches.
        }
        logger.info(
          `[DownloadManager] Audio file downloaded — status:${status} size:${size} path:${tempRawPath}`,
        );
        downloaded = true;
        break;
      } catch (err) {
        lastDownloadError = err;
        await deleteFile(tempRawPath).catch(() => {});
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.warn(`[DownloadManager] Audio download attempt failed for "${params.title}": ${errMsg}`);

        // 403 / 410 / 401 typically mean the signed CDN URL has expired or
        // been re-keyed. Re-resolve to a fresh URL and retry once. Use the
        // same provider for the refresh so we don't accidentally jump
        // catalogs mid-pipeline.
        const isStaleUrl = /HTTP (403|410|401)/.test(errMsg);
        if (isStaleUrl && streamRefreshes < 2) {
          streamRefreshes += 1;
          try {
            logger.info('[DownloadManager] Refreshing stream URL after auth/forbidden response…');
            const refreshed: AudioStreamInfo =
              params.provider === 'saavn' && params.saavnEncryptedUrl
                ? await getSaavnStreamUrl(
                    params.saavnEncryptedUrl,
                    params.saavnHas320kbps ?? false,
                  )
                : (await getBestAudioStream(params.youtubeId)) as AudioStreamInfo;
            if (refreshed.url && refreshed.url.length > 20) {
              activeStreamUrl = refreshed.url;
            }
          } catch (refreshErr) {
            logger.warn('[DownloadManager] Stream URL refresh failed:', refreshErr);
          }
        }
      }
    }

    if (!downloaded) {
      throw lastDownloadError instanceof Error
        ? lastDownloadError
        : new Error(`Could not download audio stream for "${params.title}"`);
    }

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

    const mediaLibraryUri = await publishToMusicLibrary(
      finalPath,
      finalFilename,
      stream.container,
    );
    if (mediaLibraryUri) {
      logger.info(`[DownloadManager] MediaStore copy created for external music apps: ${mediaLibraryUri}`);
    }

    // Clean up the staged file now that it has been copied.
    await deleteFile(tempStagePath);

    // ── 6. Track duration ──────────────────────────────────────────────────
    // Prefer the duration from yt.getInfo() (always present, accurate to the
    // millisecond), fall back to the EnqueueParams hint. Stored in the DB so
    // the UI shows correct duration immediately, before RNTP loads the track.
    const durationMs =
      stream.durationMs > 0
        ? stream.durationMs
        : params.durationMs > 0
        ? params.durationMs
        : 0;

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
        // Keep RNTP playback on the app-owned file path. A MediaStore copy is
        // created for external apps, but content:// playback can report
        // duration as 0 or fail on some Android/RNTP combinations.
        record.filePath = finalPath;
        record.artworkPath = artworkPath;
        // Store the external ID in the right column so search/dedupe by ID
        // works without ambiguity.
        if (params.provider === 'saavn') {
          record.saavnId = params.youtubeId;
          record.youtubeId = null;
        } else {
          record.youtubeId = params.youtubeId;
          record.saavnId = null;
        }
        record.addedAt = Math.floor(Date.now() / 1000); // Unix seconds
        record.source = params.provider;
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
