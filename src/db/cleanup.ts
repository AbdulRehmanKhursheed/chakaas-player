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
import { database, tracksCollection } from '@/db';
import { inferMetadata } from '@/features/localAudio/LocalAudioImporter';
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
