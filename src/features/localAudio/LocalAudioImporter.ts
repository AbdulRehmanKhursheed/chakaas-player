import * as MediaLibrary from 'expo-media-library';
import { database, tracksCollection } from '@/db';
import { MAX_LIBRARY_SIZE } from '@/features/download/DownloadManager';
import { logger } from '@/utils/logger';

export interface LocalAudioImportResult {
  imported: number;
  skipped: number;
  permissionDenied: boolean;
}

interface PendingLocalAudioRecord {
  uri: string;
  title: string;
  artist: string;
  durationMs: number;
  addedAt: number;
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

export async function importDeviceAudio(
  limit = MAX_LIBRARY_SIZE,
): Promise<LocalAudioImportResult> {
  const hasPermission = await requestAudioPermission();
  if (!hasPermission) {
    return { imported: 0, skipped: 0, permissionDenied: true };
  }

  const existingTracks = await tracksCollection.query().fetch();
  const existingPaths = new Set(existingTracks.map((track) => track.filePath));
  const availableSlots = Math.max(0, Math.min(limit, MAX_LIBRARY_SIZE - existingTracks.length));

  if (availableSlots === 0) {
    return { imported: 0, skipped: 0, permissionDenied: false };
  }

  let imported = 0;
  let skipped = 0;
  let after: string | undefined;
  let hasNextPage = true;

  while (hasNextPage && imported < availableSlots) {
    const page = await MediaLibrary.getAssetsAsync({
      mediaType: MediaLibrary.MediaType.audio,
      first: Math.min(100, availableSlots - imported),
      after,
      sortBy: [MediaLibrary.SortBy.creationTime],
    });

    const records: PendingLocalAudioRecord[] = [];

    for (const asset of page.assets) {
      const assetInfo = await MediaLibrary.getAssetInfoAsync(asset);
      const uri = assetInfo.localUri ?? asset.uri;

      if (!uri || existingPaths.has(uri)) {
        skipped += 1;
        continue;
      }

      const { title, artist } = inferMetadata(asset.filename);
      const durationMs = Math.max(0, Math.round((asset.duration ?? 0) * 1000));

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
      await database.write(async () => {
        for (const record of records) {
          await tracksCollection.create((track) => {
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
          });
        }
      });

      imported += records.length;
    }

    after = page.endCursor;
    hasNextPage = page.hasNextPage;
  }

  logger.info(`[LocalAudioImporter] Imported ${imported} local audio files, skipped ${skipped}.`);
  return { imported, skipped, permissionDenied: false };
}
