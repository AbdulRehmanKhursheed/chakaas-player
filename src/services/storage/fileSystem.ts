import RNBlobUtil from 'react-native-blob-util';

// ---------------------------------------------------------------------------
// Directory helpers
// ---------------------------------------------------------------------------

/**
 * Returns the music directory path and ensures it exists.
 *
 * Store the app's playable copy in the private document directory. A second
 * copy is published to Android MediaStore for other music apps; keeping RNTP on
 * the private file path avoids content-uri and scoped-storage playback issues.
 */
export async function getMusicDir(): Promise<string> {
  const dir = `${RNBlobUtil.fs.dirs.DocumentDir}/Chakaas/`;
  await ensureDir(dir);
  return dir;
}

/**
 * Returns the artwork cache directory and ensures it exists.
 * Stored inside the app cache dir so the OS can evict it under storage pressure.
 */
export async function getArtworkDir(): Promise<string> {
  const dir = `${RNBlobUtil.fs.dirs.CacheDir}/artwork/`;
  await ensureDir(dir);
  return dir;
}

/**
 * Returns the temporary scratch directory and ensures it exists.
 * Files here should be treated as ephemeral — clean up after use.
 */
export async function getTempDir(): Promise<string> {
  const dir = `${RNBlobUtil.fs.dirs.CacheDir}/tmp/`;
  await ensureDir(dir);
  return dir;
}

// ---------------------------------------------------------------------------
// Path construction
// ---------------------------------------------------------------------------

/**
 * Sanitises a filename component by removing characters that are illegal on
 * common file systems and collapsing runs of whitespace / dots.
 */
function sanitise(name: string): string {
  return name
    .replace(/[/\\:*?"<>|]/g, '') // illegal chars
    .replace(/\.{2,}/g, '.') // consecutive dots
    .replace(/\s+/g, ' ') // multiple spaces
    .trim()
    .slice(0, 100); // guard against absurdly long names
}

/**
 * Returns the full, sanitised file path for a track.
 * Format: <musicDir>/<artist> - <title>.<ext>
 *
 * The extension defaults to `m4a` (AAC); `webm` is used for opus
 * passthrough downloads from YouTube/Piped; `mp3` is used for sources
 * that natively serve mp3 (Audius, Jamendo, SoundCloud, Internet Archive)
 * — no transcoding is performed in any case.
 */
export async function getTrackPath(
  artist: string,
  title: string,
  extension: 'm4a' | 'webm' | 'mp3' = 'm4a',
  uniqueSuffix?: string,
): Promise<string> {
  const musicDir = await getMusicDir();
  const safeArtist = sanitise(artist) || 'Unknown Artist';
  const safeTitle = sanitise(title) || 'Unknown Title';
  const safeSuffix = uniqueSuffix ? sanitise(uniqueSuffix).slice(0, 16) : '';
  const suffix = safeSuffix ? ` [${safeSuffix}]` : '';
  return `${musicDir}${safeArtist} - ${safeTitle}${suffix}.${extension}`;
}

// ---------------------------------------------------------------------------
// Low-level file system utilities
// ---------------------------------------------------------------------------

/**
 * Creates `path` (and any missing ancestors) if it does not already exist.
 * Resolves immediately when the directory is already present.
 */
export async function ensureDir(path: string): Promise<void> {
  const exists = await RNBlobUtil.fs.exists(path);
  if (!exists) {
    await RNBlobUtil.fs.mkdir(path);
  }
}

/**
 * Returns `true` if a file (or directory) exists at the given path.
 */
export async function fileExists(path: string): Promise<boolean> {
  return RNBlobUtil.fs.exists(path);
}

/**
 * Deletes the file at `path`. Resolves silently if the file does not exist.
 */
export async function deleteFile(path: string): Promise<void> {
  const exists = await RNBlobUtil.fs.exists(path);
  if (exists) {
    await RNBlobUtil.fs.unlink(path);
  }
}

// ---------------------------------------------------------------------------
// Storage statistics
// ---------------------------------------------------------------------------

export type StorageStats = {
  totalFiles: number;
  totalSizeBytes: number;
  musicDirPath: string;
};

/**
 * Walks the music directory and returns aggregate file count and total size.
 * Only counts regular files (not subdirectories themselves).
 */
export async function getStorageStats(): Promise<StorageStats> {
  const musicDirPath = await getMusicDir();

  const exists = await RNBlobUtil.fs.exists(musicDirPath);
  if (!exists) {
    return { totalFiles: 0, totalSizeBytes: 0, musicDirPath };
  }

  // lstat returns an array of { filename, size, type } for each entry
  const entries = await RNBlobUtil.fs.lstat(musicDirPath);

  let totalFiles = 0;
  let totalSizeBytes = 0;

  for (const entry of entries) {
    if (entry.type === 'file') {
      totalFiles += 1;
      totalSizeBytes += typeof entry.size === 'string'
        ? parseInt(entry.size, 10)
        : (entry.size as number);
    }
  }

  return { totalFiles, totalSizeBytes, musicDirPath };
}
