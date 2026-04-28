/**
 * AudioConverter — no-op compatibility shim.
 *
 * Originally this module wrapped `ffmpeg-kit-react-native` to transcode
 * Opus/WebM streams to AAC/M4A. That package was archived in January 2025
 * and its prebuilt Maven binaries were taken down, so we removed the
 * dependency entirely and switched to a different strategy:
 *
 *   - The YouTube extractor scores AAC streams 10% above Opus, so the
 *     vast majority of downloads arrive as AAC m4a — no transcode needed.
 *   - On the rare opus/webm fallback, we keep the original container.
 *     react-native-track-player on Android uses ExoPlayer, which decodes
 *     opus/webm natively at full quality — actually better than what we
 *     used to ship (a 320 kbps re-encode of an already-lossy source).
 *
 * The public API is preserved so existing call sites compile unchanged.
 * `convertToM4A` and `embedArtwork` are now no-ops that simply log and
 * return; `probeAudioDuration` returns 0 (the DownloadManager now passes
 * the duration through directly from the YouTube metadata).
 */

import { logger } from '@/utils/logger';

// ── Types ──────────────────────────────────────────────────────────────────

export type AudioBitrate = '128k' | '192k' | '256k' | '320k';

// ── convertToM4A ───────────────────────────────────────────────────────────

/**
 * No-op shim. Kept for source-compat; downloads now stream-copy to their
 * final container without transcoding.
 */
export async function convertToM4A(
  inputPath: string,
  outputPath: string,
  _bitrate: AudioBitrate = '192k',
  onProgress?: (percent: number) => void,
): Promise<void> {
  logger.warn(
    '[AudioConverter] convertToM4A called — but FFmpeg has been removed. ' +
    'Caller should detect needsTranscode and stream-copy instead. ' +
    `(input=${inputPath}, output=${outputPath})`,
  );
  onProgress?.(100);
}

// ── embedArtwork ───────────────────────────────────────────────────────────

/**
 * No-op shim. Artwork is now stored as a sibling JPEG file referenced from
 * the WatermelonDB record's `artworkPath`, and rendered by the player UI
 * directly. Embedding into the audio container is no longer required.
 */
export async function embedArtwork(
  audioPath: string,
  _artworkPath: string,
  _outputPath: string,
): Promise<void> {
  logger.info('[AudioConverter] embedArtwork is a no-op (artwork stored as sibling file):', audioPath);
}

// ── probeAudioDuration ─────────────────────────────────────────────────────

/**
 * Returns 0. Duration is now sourced from the YouTube metadata (passed in
 * via EnqueueParams) rather than probed after download.
 */
export async function probeAudioDuration(_filePath: string): Promise<number> {
  return 0;
}
