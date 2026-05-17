/**
 * One-shot cleanup tasks that run at app boot. Idempotent — safe to call on
 * every launch; each task self-detects whether it has work to do.
 *
 * Currently:
 *   `cleanupBadLocalArtists` — finds device-imported tracks whose artist was
 *   parsed as a bare number ("00", "01", "tr03", etc.) by an earlier
 *   version of `inferMetadata`, and re-derives a clean artist + title from
 *   the source filename using the current parser. Without this the user
 *   would see "00 · Device Music" forever even after the parser fix landed.
 */
import { Q } from '@nozbe/watermelondb';
import { database, tracksCollection, playsCollection } from '@/db';
import { inferMetadata } from '@/features/localAudio/LocalAudioImporter';
import { isNonMusicTrack } from '@/utils/audioFilter';
import { deleteFile } from '@/services/storage/fileSystem';
import { storage } from '@/services/storage/mmkv';
import { logger } from '@/utils/logger';

const NUMERIC_ARTIST_RE = /^(?:tr|track)?\s*\d+\s*$/i;

function deriveFilenameFromUri(uri: string): string {
  // Last path segment, decoded, without extension. Works for file://,
  // content://, and bare absolute paths.
  const lastSlash = uri.lastIndexOf('/');
  const segment = lastSlash >= 0 ? uri.slice(lastSlash + 1) : uri;
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    // Malformed URI — fall back to the raw segment.
  }
  return decoded;
}

export async function cleanupBadLocalArtists(): Promise<void> {
  try {
    const candidates = await tracksCollection
      .query(Q.where('source', 'local'))
      .fetch();
    const broken = candidates.filter((t) =>
      NUMERIC_ARTIST_RE.test((t.artist ?? '').trim()),
    );

    if (broken.length === 0) return;

    logger.info(
      `[cleanup] Re-parsing artist for ${broken.length} legacy local tracks…`,
    );

    await database.write(async () => {
      for (const track of broken) {
        const filename = deriveFilenameFromUri(track.filePath);
        const { title, artist } = inferMetadata(filename);
        // Only update when the new parse is actually better — i.e. doesn't
        // fall back to "Unknown Artist" while the existing value at least
        // mentions something specific.
        if (!artist || artist === 'Unknown Artist') continue;
        await track.update((rec) => {
          rec.artist = artist;
          if (title && rec.title !== title) {
            rec.title = title;
          }
        });
      }
    });

    logger.info('[cleanup] Legacy local-track artist cleanup complete.');
  } catch (err) {
    logger.warn('[cleanup] Bad-artist cleanup failed:', err);
  }
}

/** Derive a filename from a file:// or content:// URI for filter logging. */
function filenameFromUri(uri: string): string {
  const lastSlash = uri.lastIndexOf('/');
  const segment = lastSlash >= 0 ? uri.slice(lastSlash + 1) : uri;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Retroactively purges WhatsApp voice notes, Telegram audio messages, status
 * music clips, UUID-named files, and other non-music assets from the library.
 * Runs every cold start — idempotent. Only removes the DB row; the underlying
 * device file is the user's own and is left untouched.
 *
 * Scans every track in the DB (not just `source='local'`) for safety against
 * legacy rows that may have null/empty source fields — past filter changes
 * missed exactly this case, leaving WhatsApp voices stranded in the library.
 *
 * App-downloaded music (`source='saavn'` or `'youtube'`) is ALWAYS preserved
 * regardless of what the filter says.
 */
export async function cleanupVoiceNotesAndClips(): Promise<number> {
  try {
    const allTracks = await tracksCollection.query().fetch();
    logger.info(`[cleanup] Scanning ${allTracks.length} tracks…`);

    // Sample for verification — first 5 rows so the user can eyeball the DB
    // state from the Metro terminal.
    const sampleSize = Math.min(5, allTracks.length);
    for (let i = 0; i < sampleSize; i += 1) {
      const t = allTracks[i];
      logger.info(
        '[cleanup] Sample:',
        JSON.stringify({
          title: t.title,
          artist: t.artist,
          source: t.source,
          filePath: t.filePath,
          durationMs: t.durationMs,
        }),
      );
    }

    const toPurge: { track: (typeof allTracks)[number]; reason: string }[] = [];
    for (const track of allTracks) {
      // Layer B guard rail: never purge real downloads. This is the ONLY
      // place we short-circuit on source — the shared filter is source-blind
      // by design.
      if (track.source === 'saavn' || track.source === 'youtube') continue;

      const filePath = track.filePath ?? '';
      const filename = filenameFromUri(filePath);
      const decision = isNonMusicTrack({
        path: filePath,
        uri: filePath,
        filename,
        name: filename,
        title: track.title ?? '',
        artist: track.artist ?? '',
        album: track.album ?? '',
        durationMs: track.durationMs ?? 0,
      });

      if (decision.blocked) {
        toPurge.push({ track, reason: decision.reason });
        logger.info(
          `[cleanup] PURGE (${decision.reason}): ${track.title} | ${track.filePath}`,
        );
      }
    }

    if (toPurge.length === 0) {
      logger.info('[cleanup] No non-music tracks found.');
      return 0;
    }

    logger.info(`[cleanup] Purging ${toPurge.length} junk tracks…`);

    await database.write(async () => {
      for (const { track } of toPurge) {
        try {
          await track.destroyPermanently();
        } catch (err) {
          logger.warn(`[cleanup] Could not destroy track ${track.id}:`, err);
        }
      }
    });

    logger.info(`[cleanup] Purged ${toPurge.length} junk tracks.`);
    return toPurge.length;
  } catch (err) {
    logger.warn('[cleanup] Voice-note/clip cleanup failed:', err);
    return 0;
  }
}

const PLAY_COUNT_BACKFILL_FLAG = 'play_count_backfill_v1_done';

/**
 * Backfills the new `tracks.play_count` column by counting rows in `plays`
 * grouped by `track_id`. Schema v3 added the column with a default of 0 for
 * every existing row, so on first launch after the migration this scans the
 * Plays table once and writes the denormalised counts. Subsequent plays
 * increment the column directly inside `playTracker.flushLastPlay`.
 *
 * Idempotent: guarded by an MMKV flag so it only ever runs once. Safe to
 * call on every app boot.
 */
export async function backfillPlayCounts(): Promise<void> {
  if (storage.getBoolean(PLAY_COUNT_BACKFILL_FLAG)) return;

  try {
    const plays = await playsCollection.query().fetch();
    if (plays.length === 0) {
      storage.set(PLAY_COUNT_BACKFILL_FLAG, true);
      logger.info('[cleanup] play_count backfill skipped — no plays recorded.');
      return;
    }

    const counts = new Map<string, number>();
    for (const play of plays) {
      counts.set(play.trackId, (counts.get(play.trackId) ?? 0) + 1);
    }

    const trackIds = [...counts.keys()];
    const tracks = await tracksCollection
      .query(Q.where('id', Q.oneOf(trackIds)))
      .fetch();

    if (tracks.length === 0) {
      storage.set(PLAY_COUNT_BACKFILL_FLAG, true);
      logger.info('[cleanup] play_count backfill skipped — no matching tracks.');
      return;
    }

    await database.write(async () => {
      for (const track of tracks) {
        const count = counts.get(track.id) ?? 0;
        if (count === track.playCount) continue;
        await track.update((rec) => {
          rec.playCount = count;
        });
      }
    });

    storage.set(PLAY_COUNT_BACKFILL_FLAG, true);
    logger.info(
      `[cleanup] play_count backfill complete: updated ${tracks.length} tracks ` +
      `from ${plays.length} play rows.`,
    );
  } catch (err) {
    logger.warn('[cleanup] play_count backfill failed:', err);
  }
}

// ─── Bulk delete ──────────────────────────────────────────────────────────────

export interface BulkDeleteResult {
  total: number;
  byCounts: { saavn: number; youtube: number; local: number; other: number };
}

/**
 * Hard-deletes a batch of tracks from the library. For app-managed sources
 * (`saavn`, `youtube`) the on-disk audio + artwork files are removed too, since
 * they were downloaded by us and the user expects "delete" to reclaim space.
 * For `local` (or unknown) sources we only drop the DB row — those files are
 * the user's own and must never be touched.
 *
 * All `destroyPermanently()` calls run inside a single `database.write` so the
 * deletion is atomic; file removals happen after the write commits so a
 * filesystem hiccup can't poison the DB transaction.
 */
export async function bulkDeleteTracks(ids: string[]): Promise<BulkDeleteResult> {
  const empty: BulkDeleteResult = {
    total: 0,
    byCounts: { saavn: 0, youtube: 0, local: 0, other: 0 },
  };
  if (ids.length === 0) return empty;

  try {
    const tracks = await tracksCollection
      .query(Q.where('id', Q.oneOf(ids)))
      .fetch();

    if (tracks.length === 0) return empty;

    // Snapshot file paths + source counts before the write block — once
    // destroyPermanently runs the model becomes unreadable.
    const filesToDelete: string[] = [];
    const counts = { saavn: 0, youtube: 0, local: 0, other: 0 };
    for (const track of tracks) {
      const source = track.source;
      if (source === 'saavn') {
        counts.saavn += 1;
        if (track.filePath) filesToDelete.push(track.filePath);
        if (track.artworkPath) filesToDelete.push(track.artworkPath);
      } else if (source === 'youtube') {
        counts.youtube += 1;
        if (track.filePath) filesToDelete.push(track.filePath);
        if (track.artworkPath) filesToDelete.push(track.artworkPath);
      } else if (source === 'local') {
        counts.local += 1;
      } else {
        counts.other += 1;
      }
    }

    // One batch() call commits every destroy in a single SQLite write — for
    // a 748-row purge that turns 748 native bridge round-trips into 1, so
    // the UI no longer freezes while WatermelonDB chews through each row.
    await database.write(async () => {
      const ops = tracks.map((track) => track.prepareDestroyPermanently());
      await database.batch(...ops);
    });

    // Best-effort file cleanup — runs OUTSIDE the DB batch because it's
    // filesystem I/O, not a SQLite write. `deleteFile` resolves silently
    // if missing, and we don't want a single failed unlink to abort the rest.
    await Promise.all(
      filesToDelete.map(async (path) => {
        try {
          await deleteFile(path);
        } catch (err) {
          logger.warn('[cleanup] Could not delete file', path, err);
        }
      }),
    );

    logger.info(
      `[cleanup] Bulk-deleted ${tracks.length} tracks ` +
      `(saavn: ${counts.saavn}, youtube: ${counts.youtube}, local: ${counts.local}).`,
    );

    return { total: tracks.length, byCounts: counts };
  } catch (err) {
    logger.warn('[cleanup] bulkDeleteTracks failed:', err);
    return empty;
  }
}
