/**
 * LRClib lyrics API client.
 *
 * No authentication is required. All requests are GET-only.
 * base URL: https://lrclib.net/api
 */

import axios from 'axios';
import { logger } from '@/utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LyricsEntry {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number;
  /** Plain, un-timestamped lyrics. May be null if unavailable. */
  plainLyrics: string | null;
  /** Timestamped lyrics in LRC format. May be null if unavailable. */
  syncedLyrics: string | null;
}

/** A single timed line from a synced (LRC) lyrics source. */
export interface SyncedLine {
  /** Offset in seconds from the start of the track. */
  time: number;
  /** Lyric text for this line. */
  text: string;
}

// ---------------------------------------------------------------------------
// Axios instance
// ---------------------------------------------------------------------------

const lrclibClient = axios.create({
  baseURL: 'https://lrclib.net/api',
  headers: {
    'Lrclib-Client': 'Chakaas Player (https://github.com/chakaas)',
  },
});

// ---------------------------------------------------------------------------
// LRC parser
// ---------------------------------------------------------------------------

/**
 * Parses a string in LRC format into an array of `SyncedLine` objects.
 *
 * LRC time tag format: `[mm:ss.xx]` or `[mm:ss.xxx]`
 * Lines are sorted by ascending time. Lines without a recognised time tag
 * (e.g. ID tags like [ar:Artist]) are silently discarded.
 */
export function parseLRC(lrc: string): SyncedLine[] {
  // Matches one or more time tags at the start of a line, e.g. [01:23.45]
  const lineRegex = /^((?:\[\d{1,2}:\d{2}(?:\.\d+)?\])+)(.*)/;
  const tagRegex = /\[(\d{1,2}):(\d{2}(?:\.\d+)?)\]/g;

  const result: SyncedLine[] = [];

  for (const rawLine of lrc.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    const match = lineRegex.exec(line);
    if (!match) continue;

    const timeSection = match[1];
    const text = match[2].trim();

    // A single lyric line can have multiple time tags (repeated chorus trick)
    let tagMatch: RegExpExecArray | null;
    tagRegex.lastIndex = 0;

    while ((tagMatch = tagRegex.exec(timeSection)) !== null) {
      const minutes = parseInt(tagMatch[1], 10);
      const seconds = parseFloat(tagMatch[2]);
      const timeInSeconds = minutes * 60 + seconds;
      result.push({ time: timeInSeconds, text });
    }
  }

  // Sort by ascending time
  result.sort((a, b) => a.time - b.time);
  return result;
}

// ---------------------------------------------------------------------------
// API methods
// ---------------------------------------------------------------------------

/**
 * Fetches lyrics for a specific track. Tries the strict `/get` endpoint first
 * when duration metadata is available, then falls back to fuzzy `/search`
 * (which doesn't require duration) when /get 404s or duration is 0/unknown.
 *
 * Returns `null` only when no lyrics match at all.
 */
export async function getLyrics(
  artist: string,
  title: string,
  album: string,
  duration: number,
): Promise<LyricsEntry | null> {
  const hasDuration = Number.isFinite(duration) && duration > 0;

  // Strict path: /get requires artist + title + album + duration. Skip when
  // duration is missing — LRClib returns 400 in that case.
  if (hasDuration) {
    try {
      const response = await lrclibClient.get<LyricsEntry>('/get', {
        params: {
          artist_name: artist,
          track_name: title,
          album_name: album,
          duration: Math.round(duration),
        },
      });
      return response.data;
    } catch (error: unknown) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        // Fall through to search below — track exists but exact-duration match failed.
      } else if (!axios.isAxiosError(error) || error.response?.status !== 400) {
        // Network / unexpected error — give up cleanly.
        logger.warn('[LRClib] /get failed (non-404):', error);
      }
    }
  }

  // Fuzzy fallback: /search by free-text query, return first hit.
  const query = `${artist} ${title}`.trim();
  if (!query) return null;
  const hits = await searchLyrics(query);
  return hits[0] ?? null;
}

/**
 * Searches for lyrics by a free-text query.
 * Returns an array of matching entries (may be empty).
 */
export async function searchLyrics(query: string): Promise<LyricsEntry[]> {
  try {
    const response = await lrclibClient.get<LyricsEntry[]>('/search', {
      params: { q: query },
    });
    return Array.isArray(response.data) ? response.data : [];
  } catch (error: unknown) {
    logger.error('[LRClib] searchLyrics failed:', error);
    return [];
  }
}
