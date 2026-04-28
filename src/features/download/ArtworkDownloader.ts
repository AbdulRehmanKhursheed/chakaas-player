import RNBlobUtil from 'react-native-blob-util';
import { getArtworkDir } from '@/services/storage/fileSystem';
import { logger } from '@/utils/logger';

// ── downloadArtwork ────────────────────────────────────────────────────────

/**
 * Downloads a thumbnail/artwork image from `imageUrl` and saves it to the
 * app's dedicated artwork cache directory as `<trackId>.jpg`.
 *
 * The file is saved with RNBlobUtil's `fileCache: true` option, which means
 * RNBlobUtil manages the path — but we override it with an explicit `path` so
 * that we can derive the location deterministically from the track ID.
 *
 * Returns the absolute path to the saved image on success, or `null` if the
 * download fails for any reason (network error, bad URL, etc.).
 *
 * Errors are logged but not re-thrown; callers should treat a `null` return
 * as "no artwork" and proceed without it.
 */
export async function downloadArtwork(
  imageUrl: string,
  trackId: string,
): Promise<string | null> {
  if (!imageUrl) return null;

  try {
    const dir = await getArtworkDir();
    const filename = `${trackId}.jpg`;
    const destPath = `${dir}${filename}`;

    // Skip the download if we already have this artwork cached.
    const exists = await RNBlobUtil.fs.exists(destPath);
    if (exists) return destPath;

    const response = await RNBlobUtil.config({
      // Write directly to the target path.
      path: destPath,
      fileCache: true,
    }).fetch('GET', imageUrl, {
      'User-Agent': 'Chakaas-Player/1.0',
      // Prefer JPEG responses where the server honours Accept.
      'Accept': 'image/jpeg,image/webp,image/*,*/*',
    });

    const info = response.info();

    // Treat anything other than 2xx as a failure.
    if (info.status < 200 || info.status >= 300) {
      logger.warn(
        `[ArtworkDownloader] Non-2xx status ${info.status} for ${imageUrl}`,
      );
      // Clean up the partial file, if any.
      await RNBlobUtil.fs.unlink(destPath).catch(() => {});
      return null;
    }

    return response.path();
  } catch (err) {
    logger.error('[ArtworkDownloader] downloadArtwork failed:', err);
    return null;
  }
}

// ── clearArtworkCache ─────────────────────────────────────────────────────

/**
 * Deletes the cached artwork file for a given track ID.
 * Resolves silently if the file does not exist.
 */
export async function clearArtworkCache(trackId: string): Promise<void> {
  try {
    const dir = await getArtworkDir();
    const path = `${dir}${trackId}.jpg`;
    const exists = await RNBlobUtil.fs.exists(path);
    if (exists) {
      await RNBlobUtil.fs.unlink(path);
    }
  } catch (err) {
    logger.warn('[ArtworkDownloader] clearArtworkCache failed:', err);
  }
}
