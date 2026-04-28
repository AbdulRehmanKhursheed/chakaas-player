import { getLyrics, parseLRC } from '@/services/api/lrclib';
import { recommendationStorage, getJSON, setJSON } from '@/services/storage/mmkv';
import { logger } from '@/utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LyricLine {
  /** Offset in seconds from the start of the track. */
  time: number;
  /** Lyric text for this line. */
  text: string;
}

export interface LyricsResult {
  /** Time-stamped LRC lines, or null when synced lyrics are unavailable. */
  synced: LyricLine[] | null;
  /** Plain, un-timestamped lyrics, or null when unavailable. */
  plain: string | null;
}

// ---------------------------------------------------------------------------
// Cache key
// ---------------------------------------------------------------------------

const LYRICS_CACHE_PREFIX = 'lyrics_';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns lyrics for the given track, reading from the MMKV cache first.
 * Fetches from LRClib when the cache is cold and writes the result back.
 * Always resolves — returns `{ synced: null, plain: null }` on any failure.
 */
export async function getLyricsForTrack(params: {
  trackId: string;
  artist: string;
  title: string;
  album: string;
  duration_ms: number;
}): Promise<LyricsResult> {
  const cacheKey = LYRICS_CACHE_PREFIX + params.trackId;

  // Return cached result immediately when available
  const cached = getJSON<LyricsResult>(recommendationStorage, cacheKey);
  if (cached) return cached;

  try {
    const result = await getLyrics(
      params.artist,
      params.title,
      params.album,
      Math.round(params.duration_ms / 1000),
    );

    if (!result) {
      const empty: LyricsResult = { synced: null, plain: null };
      // Cache the negative result to avoid hammering LRClib for every play
      setJSON(recommendationStorage, cacheKey, empty);
      return empty;
    }

    const lyrics: LyricsResult = {
      // parseLRC returns SyncedLine[] which is structurally identical to
      // LyricLine[] — both have { time: number; text: string }.
      synced: result.syncedLyrics ? parseLRC(result.syncedLyrics) : null,
      plain: result.plainLyrics ?? null,
    };

    setJSON(recommendationStorage, cacheKey, lyrics);
    return lyrics;
  } catch (err) {
    logger.warn('[LyricsService] Lyrics fetch failed for', params.title, ':', err);
    return { synced: null, plain: null };
  }
}

/**
 * Binary-searches `lines` to find the index of the lyric line whose `time`
 * is less than or equal to `currentTime`.
 *
 * Returns 0 when `currentTime` is before the first line.
 * Returns the last index when `currentTime` is past the final line.
 *
 * Runs in O(log n) — safe to call on every animation frame.
 */
export function getCurrentLyricIndex(lines: LyricLine[], currentTime: number): number {
  if (!lines.length) return 0;

  let lo = 0;
  let hi = lines.length - 1;

  // If we haven't reached the first line yet, stay at 0
  if (currentTime < lines[0].time) return 0;

  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1; // ceil mid to avoid infinite loop
    if (lines[mid].time <= currentTime) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  return lo;
}
