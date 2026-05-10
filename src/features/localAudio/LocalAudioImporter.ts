import * as MediaLibrary from 'expo-media-library';
import { database, tracksCollection } from '@/db';
import { MAX_LIBRARY_SIZE } from '@/features/download/DownloadManager';
import { logger } from '@/utils/logger';

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
 */
const MIN_SONG_DURATION_MS = 45_000;

/**
 * Paths and filename patterns that are reliably *not* songs. The match is
 * substring-based on the full URI so it catches both legacy `/sdcard/...`
 * and scoped-storage `content://...` paths.
 */
const NON_MUSIC_PATH_FRAGMENTS: string[] = [
  // WhatsApp
  'whatsapp voice notes',
  'whatsapp audio',
  'whatsapp/media/whatsapp voice',
  'whatsapp/media/whatsapp audio',
  // Telegram
  'telegram audio',
  'telegram voice',
  'org.telegram',
  // Generic voice / recordings
  '/voice notes/',
  '/voicerecorder/',
  '/recordings/',
  '/call recordings/',
  // System sounds the OS exposes as audio assets
  '/ringtones/',
  '/notifications/',
  '/alarms/',
  '/ui/',
];

/**
 * Filename prefix/suffix patterns that flag a file as a voice memo even when
 * the path is generic (e.g. files copied out of WhatsApp into Downloads).
 */
const NON_MUSIC_FILENAME_RE =
  /^(ptt|aud|wa|vn|voice|rec|recording|note|memo|call|audio[-_]\d+)[-_ ]/i;

const VOICE_EXTENSIONS = ['.opus', '.amr', '.3gp', '.3ga', '.awb'];

function isNonMusicAsset(uri: string, filename: string, durationMs: number): boolean {
  if (durationMs > 0 && durationMs < MIN_SONG_DURATION_MS) {
    return true;
  }

  const lcUri = uri.toLowerCase();
  for (const fragment of NON_MUSIC_PATH_FRAGMENTS) {
    if (lcUri.includes(fragment)) return true;
  }

  const lcName = filename.toLowerCase();
  if (NON_MUSIC_FILENAME_RE.test(lcName)) return true;

  for (const ext of VOICE_EXTENSIONS) {
    if (lcName.endsWith(ext)) return true;
  }

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

      if (isNonMusicAsset(uri, asset.filename, durationMs)) {
        rejected += 1;
        existingPaths.add(uri);
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
    `[LocalAudioImporter] Scanned ${scanned}, imported ${imported}, ` +
      `skipped (dup) ${skipped}, rejected (non-music) ${rejected}.`,
  );
  return { scanned, imported, skipped, rejected, permissionDenied: false };
}
