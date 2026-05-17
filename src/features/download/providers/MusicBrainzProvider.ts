/**
 * MusicBrainzProvider — metadata-only. MusicBrainz is the canonical open
 * music encyclopedia. We don't download streams from here — they don't host
 * audio. We use it for canonical title/artist/album/year enrichment so the
 * UI shows the *correct* metadata even when, say, a YouTube title is
 * "Track Name (Official Music Video) [HQ AUDIO]".
 *
 * Endpoint:
 *   GET https://musicbrainz.org/ws/2/recording?query=<q>&fmt=json
 *
 * MusicBrainz requires a polite User-Agent (which our http helper supplies).
 */
import { httpGetJson } from '@/utils/http';

const SEARCH_BASE = 'https://musicbrainz.org/ws/2/recording';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

export interface MusicBrainzRecording {
  id: string;
  title: string;
  artist: string;
  album: string;
  /** First-release year, when present. */
  year: number;
  /** Track duration in ms (from MusicBrainz `length`). */
  durationMs: number;
  /** MusicBrainz "score" 0–100 — how well it matched the query. */
  score: number;
}

interface MBArtistCredit {
  name?: unknown;
  artist?: unknown;
}

interface MBRelease {
  title?: unknown;
  date?: unknown;
}

function extractArtist(artistCredit: unknown): string {
  const arr = asArray(artistCredit);
  if (arr.length === 0) return 'Unknown';
  const first = arr[0];
  if (!isRecord(first)) return 'Unknown';
  const c = first as MBArtistCredit;
  if (asString(c.name)) return asString(c.name);
  const artistObj = isRecord(c.artist) ? (c.artist as Record<string, unknown>) : null;
  return artistObj ? asString(artistObj.name) : 'Unknown';
}

function extractAlbumAndYear(releases: unknown): { album: string; year: number } {
  const arr = asArray(releases);
  if (arr.length === 0) return { album: '', year: 0 };
  // Pick the earliest release with a non-empty title.
  let bestTitle = '';
  let bestYear = 0;
  for (const raw of arr) {
    if (!isRecord(raw)) continue;
    const r = raw as MBRelease;
    const title = asString(r.title);
    const date = asString(r.date);
    const yearMatch = date.match(/^(\d{4})/);
    const year = yearMatch ? Number.parseInt(yearMatch[1], 10) : 0;

    if (!bestTitle && title) bestTitle = title;
    if (year > 0 && (bestYear === 0 || year < bestYear)) {
      bestYear = year;
      if (title) bestTitle = title;
    }
  }
  return { album: bestTitle, year: bestYear };
}

export async function searchMusicBrainz(
  query: string,
  limit = 5,
): Promise<MusicBrainzRecording[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const url = `${SEARCH_BASE}?query=${encodeURIComponent(trimmed)}&fmt=json&limit=${limit}`;
  const data = await httpGetJson<unknown>(url, { timeoutMs: 6000 });

  const recordings = asArray(isRecord(data) ? data.recordings : []);
  const out: MusicBrainzRecording[] = [];

  for (const raw of recordings) {
    if (!isRecord(raw)) continue;
    const id = asString(raw.id);
    const title = asString(raw.title);
    if (!id || !title) continue;

    const artist = extractArtist(raw['artist-credit']);
    const { album, year } = extractAlbumAndYear(raw.releases);
    const length = asNumber(raw.length);
    const score = asNumber(raw.score);

    out.push({
      id,
      title,
      artist,
      album,
      year,
      durationMs: length > 0 ? length : 0,
      score,
    });
    if (out.length >= limit) break;
  }

  return out;
}
