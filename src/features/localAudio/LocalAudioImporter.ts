import * as MediaLibrary from 'expo-media-library';
import { database, tracksCollection } from '@/db';
import { MAX_LIBRARY_SIZE } from '@/features/download/DownloadManager';
import { logger } from '@/utils/logger';
import { isNonMusicTrack, type AudioCandidate } from '@/utils/audioFilter';

export interface LocalAudioImportProgress {
  scanned: number;
  imported: number;
  skipped: number;
  rejected: number;
}

export interface LocalAudioImportResult extends LocalAudioImportProgress {
  permissionDenied: boolean;
}

interface PendingLocalAudioRecord {
  uri: string;
  title: string;
  artist: string;
  durationMs: number;
  addedAt: number;
}

/**
 * Files shorter than this are almost certainly voice memos, ringtones, or
 * notification sounds — not songs the user wants in their music library.
 *
 * Kept here for the importer-specific "60s minimum" cutoff (the shared
 * `isNonMusicTrack` blocks `< 30s` which is the absolute floor; the importer
 * is stricter because users overwhelmingly don't want sub-minute clips in
 * their music library either).
 */
const MIN_SONG_DURATION_MS = 60_000;

/**
 * Common Android system-sound filenames (shipped with stock ROMs) that
 * MediaStore exposes as audio assets. Kept importer-local because they're
 * filename-exact rather than substring patterns.
 */
const SYSTEM_SOUND_FILENAMES = new Set([
  'over the horizon.mp3',
  'galaxy.mp3',
  'whistle.ogg',
  'silent.ogg',
]);

/**
 * Backwards-compat shim. Older callers pass `(uri, filename, durationMs)`;
 * this re-shapes them into the unified `AudioCandidate` form and delegates
 * to the shared filter. Returns just the boolean.
 */
export function isNonMusicAsset(
  uri: string,
  filename: string,
  durationMs: number,
): boolean {
  // System-sound exact-name check stays inline — these get past substring
  // filters because they live in OS-managed audio directories that don't
  // include the keywords above.
  if (SYSTEM_SOUND_FILENAMES.has(filename.toLowerCase())) return true;

  const result = isNonMusicTrack({
    path: uri,
    uri,
    filename,
    durationMs,
  });
  if (result.blocked) return true;

  // Importer is stricter on duration than the shared filter (which only
  // blocks <30s). Anything <60s with non-zero duration is rejected here.
  if (durationMs > 0 && durationMs < MIN_SONG_DURATION_MS) return true;

  return false;
}

function cleanTitle(value: string): string {
  return value
    .replace(/\.[^/.]+$/, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function inferMetadata(filename: string): { title: string; artist: string } {
  const cleaned = cleanTitle(filename);
  const separator = cleaned.indexOf(' - ');

  if (separator > 0) {
    return {
      artist: cleaned.slice(0, separator).trim() || 'Unknown Artist',
      title: cleaned.slice(separator + 3).trim() || cleaned,
    };
  }

  return {
    title: cleaned || 'Unknown Track',
    artist: 'Unknown Artist',
  };
}

async function requestAudioPermission(): Promise<boolean> {
  const current = await MediaLibrary.getPermissionsAsync(false, ['audio']);
  if (current.granted) return true;

  const requested = await MediaLibrary.requestPermissionsAsync(false, ['audio']);
  return requested.granted;
}

export interface ImportOptions {
  limit?: number;
  /** Receives running counts after every page so the UI can show progress. */
  onProgress?: (progress: LocalAudioImportProgress) => void;
  /** Aborts the scan when it returns true between pages. */
  shouldCancel?: () => boolean;
}

export async function importDeviceAudio(
  options: ImportOptions = {},
): Promise<LocalAudioImportResult> {
  const limit = options.limit ?? MAX_LIBRARY_SIZE;
  const hasPermission = await requestAudioPermission();
  if (!hasPermission) {
    return {
      scanned: 0,
      imported: 0,
      skipped: 0,
      rejected: 0,
      permissionDenied: true,
    };
  }

  // Fetch every existing local-source path once so the loop can do O(1)
  // dedupe instead of one DB query per asset. We restrict by source so the
  // set stays small even on a large library.
  const existingTracks = await tracksCollection.query().fetch();
  const existingPaths = new Set(existingTracks.map((track) => track.filePath));
  const availableSlots = Math.max(
    0,
    Math.min(limit, MAX_LIBRARY_SIZE - existingTracks.length),
  );

  if (availableSlots === 0) {
    return {
      scanned: 0,
      imported: 0,
      skipped: 0,
      rejected: 0,
      permissionDenied: false,
    };
  }

  let scanned = 0;
  let imported = 0;
  let skipped = 0;
  let rejected = 0;
  let after: string | undefined;
  let hasNextPage = true;

  while (hasNextPage && imported < availableSlots) {
    if (options.shouldCancel?.()) break;

    const page = await MediaLibrary.getAssetsAsync({
      mediaType: MediaLibrary.MediaType.audio,
      first: Math.min(100, availableSlots - imported),
      after,
      sortBy: [MediaLibrary.SortBy.creationTime],
    });

    scanned += page.assets.length;

    // Resolve asset info in parallel — getAssetInfoAsync hits the native
    // bridge once per call; doing 100 in serial costs ~3 s, in parallel
    // ~150 ms.
    const assetInfos = await Promise.all(
      page.assets.map(async (asset) => {
        try {
          const info = await MediaLibrary.getAssetInfoAsync(asset);
          return { asset, info };
        } catch {
          return { asset, info: null as MediaLibrary.AssetInfo | null };
        }
      }),
    );

    // Verbose sampling: log the first 5 raw assets of the FIRST page so the
    // user can verify from Metro what the MediaLibrary bridge is actually
    // returning. Pages 2+ stay quiet to keep the terminal readable.
    if (scanned === page.assets.length) {
      const sampleSize = Math.min(5, assetInfos.length);
      for (let i = 0; i < sampleSize; i += 1) {
        const { asset, info } = assetInfos[i];
        logger.info(
          '[LocalImporter] Asset sample:',
          JSON.stringify(
            {
              id: asset.id,
              filename: asset.filename,
              uri: asset.uri,
              localUri: info?.localUri ?? null,
              albumId: info?.albumId ?? null,
              duration: asset.duration,
              mediaType: asset.mediaType,
            },
            null,
            2,
          ),
        );
      }
    }

    const records: PendingLocalAudioRecord[] = [];

    for (const { asset, info } of assetInfos) {
      const uri = info?.localUri ?? asset.uri;

      if (!uri) {
        skipped += 1;
        continue;
      }
      if (existingPaths.has(uri)) {
        skipped += 1;
        continue;
      }

      const durationMs = Math.max(0, Math.round((asset.duration ?? 0) * 1000));

      // Layer A — shared filter. Build the full candidate shape so every
      // path/keyword/filename/extension/duration heuristic runs.
      const candidate: AudioCandidate = {
        path: info?.localUri ?? null,
        uri: asset.uri,
        filename: asset.filename,
        name: asset.filename,
        durationMs,
      };
      const decision = isNonMusicTrack(candidate);
      const systemSound = SYSTEM_SOUND_FILENAMES.has(asset.filename.toLowerCase());
      const importerDurationCut =
        !decision.blocked &&
        durationMs > 0 &&
        durationMs < MIN_SONG_DURATION_MS;

      if (decision.blocked || systemSound || importerDurationCut) {
        rejected += 1;
        existingPaths.add(uri);
        const reason = decision.blocked
          ? decision.reason
          : systemSound
            ? 'system-sound'
            : `duration-lt-${MIN_SONG_DURATION_MS / 1000}s`;
        logger.info(
          `[LocalImporter] BLOCKED (${reason}): ${asset.filename} | uri=${asset.uri}`,
        );
        continue;
      }

      const { title, artist } = inferMetadata(asset.filename);

      records.push({
        uri,
        title,
        artist,
        durationMs,
        addedAt: Math.floor(Date.now() / 1000),
      });
      existingPaths.add(uri);
    }

    if (records.length > 0) {
      // One transaction per page; batch() commits all creates in a single
      // SQLite write instead of N awaited writes.
      await database.write(async () => {
        const ops = records.map((record) =>
          tracksCollection.prepareCreate((track) => {
            track.title = record.title;
            track.artist = record.artist;
            track.album = 'Device Music';
            track.genre = '';
            track.durationMs = record.durationMs;
            track.filePath = record.uri;
            track.artworkPath = null;
            track.youtubeId = null;
            track.saavnId = null;
            track.addedAt = record.addedAt;
            track.source = 'local';
            track.liked = false;
          }),
        );
        await database.batch(...ops);
      });

      imported += records.length;
    }

    options.onProgress?.({ scanned, imported, skipped, rejected });

    after = page.endCursor;
    hasNextPage = page.hasNextPage;
  }

  logger.info(
    `[LocalImporter] DONE — scanned=${scanned} imported=${imported} ` +
      `skipped=${skipped} blocked=${rejected}`,
  );
  return { scanned, imported, skipped, rejected, permissionDenied: false };
}
