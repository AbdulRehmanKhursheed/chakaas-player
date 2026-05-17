import RNBlobUtil from 'react-native-blob-util';
import { getArtworkDir } from '@/services/storage/fileSystem';
import { logger } from '@/utils/logger';
import { resolveBestArtwork } from '@/services/metadata/ArtworkResolver';

// ── downloadArtwork ────────────────────────────────────────────────────────

/**
 * Optional context that lets the downloader fan out to the metadata
 * services (iTunes, Deezer, MusicBrainz) for higher-quality artwork when the
 * supplied thumbnail URL is low-resolution.
 *
 * TODO: existing callers can pass `{ title, artist }` to opt into HQ
 * resolution. The DownloadManager call site (`downloadArtwork(thumb, id)`)
 * still works unchanged — when title/artist are absent we just use the
 * primary thumbnail URL.
 */
export type DownloadArtworkOptions = {
  title?: string;
  artist?: string;
};

/**
 * Heuristic for "this URL looks like a tiny thumbnail". We only fan out to
 * the metadata services when the primary URL appears low-res, since that's
 * where the slow network round-trips actually pay off.
 */
function looksLowRes(url: string): boolean {
  // No size hint at all — assume worst-case and try to upgrade.
  if (!/\d{2,4}x\d{2,4}/.test(url)) return true;
  // Common JioSaavn / iTunes thumbnail sizes.
  if (/150x150/i.test(url)) return true;
  if (/100x100/i.test(url)) return true;
  if (/50x50/i.test(url)) return true;
  return false;
}

/**
 * Downloads a thumbnail/artwork image from `imageUrl` and saves it to the
 * app's dedicated artwork cache directory as `<trackId>.jpg`.
 *
 * When the optional third argument provides a track `title` and `artist`,
 * and the primary `imageUrl` is suspected of being low-resolution, the
 * downloader will try to resolve a better cover via the metadata services
 * before falling back to the provided URL.
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
  options?: DownloadArtworkOptions,
): Promise<string | null> {
  if (!imageUrl) return null;

  try {
    const dir = await getArtworkDir();
    const filename = `${trackId}.jpg`;
    const destPath = `${dir}${filename}`;

    // Skip the download if we already have this artwork cached.
    const exists = await RNBlobUtil.fs.exists(destPath);
    if (exists) return destPath;

    // Optionally upgrade the URL via the metadata resolver. We only do this
    // when both title+artist are known AND the primary URL looks low-res, to
    // avoid spending an extra 4s on tracks that already have decent art.
    let finalUrl = imageUrl;
    if (options?.title && options.artist && looksLowRes(imageUrl)) {
      try {
        const resolved = await resolveBestArtwork({
          primaryUrl: imageUrl,
          title: options.title,
          artist: options.artist,
          trackId,
        });
        if (resolved?.url) {
          finalUrl = resolved.url;
        }
      } catch (resolveErr) {
        // Resolver is best-effort — never let it break the actual download.
        logger.warn('[ArtworkDownloader] resolver failed, using primary URL:', resolveErr);
      }
    }

    const response = await RNBlobUtil.config({
      // Write directly to the target path. Using `path:` alone (without
      // `fileCache: true`) makes RNBlobUtil treat `destPath` as the sole
      // output sink — no temp file shuffling, deterministic location.
      path: destPath,
    }).fetch('GET', finalUrl, {
      'User-Agent': 'Chakaas-Player/1.0',
      // Prefer JPEG responses where the server honours Accept.
      'Accept': 'image/jpeg,image/webp,image/*,*/*',
    });

    const info = response.info();

    // Treat anything other than 2xx as a failure.
    if (info.status < 200 || info.status >= 300) {
      logger.warn(
        `[ArtworkDownloader] Non-2xx status ${info.status} for ${finalUrl}`,
      );
      // Clean up the partial file, if any.
      await RNBlobUtil.fs.unlink(destPath).catch(() => {});

      // If the resolver-picked URL failed, try the original as a last resort.
      if (finalUrl !== imageUrl) {
        logger.info('[ArtworkDownloader] retrying with primary URL after resolver miss');
        return downloadArtwork(imageUrl, trackId);
      }
      return null;
    }

    return destPath;
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
