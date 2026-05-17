/**
 * Last.fm metadata client.
 *
 * Last.fm requires an API key for most endpoints. We read the key from MMKV
 * (`lastfm_api_key` in the general store). When no key is configured this
 * module's public functions are safe no-ops that return `null`, so the caller
 * never needs to special-case the missing-key state.
 */

import { logger } from '@/utils/logger';
import { storage } from '@/services/storage/mmkv';

const ENDPOINT = 'https://ws.audioscrobbler.com/2.0/';
const TIMEOUT_MS = 4000;

// ── Result type ───────────────────────────────────────────────────────────

export type LastFmTrackInfo = {
  playCount?: number;
  tags?: string[];
  summary?: string;
};

// ── Type guards ───────────────────────────────────────────────────────────

type LfmWiki = { summary?: string };
type LfmTrack = {
  playcount?: string;
  tagNames?: string[];
  wiki?: LfmWiki;
};
type LfmResponse = { track?: LfmTrack };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Extract tag name strings from a Last.fm `toptags` block. */
function asTagNames(value: unknown): string[] {
  if (!isRecord(value) || !Array.isArray(value.tag)) return [];
  const out: string[] = [];
  for (const t of value.tag) {
    if (isRecord(t) && typeof t.name === 'string') {
      out.push(t.name);
    }
  }
  return out;
}

function asTrack(value: unknown): LfmTrack | null {
  if (!isRecord(value)) return null;
  const t: LfmTrack = {};
  if (typeof value.playcount === 'string') t.playcount = value.playcount;
  if (isRecord(value.toptags)) {
    const names = asTagNames(value.toptags);
    if (names.length > 0) t.tagNames = names;
  }
  if (isRecord(value.wiki) && typeof value.wiki.summary === 'string') {
    t.wiki = { summary: value.wiki.summary };
  }
  return t;
}

function parseResponse(value: unknown): LfmResponse {
  if (!isRecord(value)) return {};
  const track = asTrack(value.track);
  return track ? { track } : {};
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Fetch playcount + top-tag metadata for a track. Returns null when:
 *   - No `lastfm_api_key` is configured in MMKV.
 *   - The request fails, times out, or returns no usable data.
 */
export async function lookupLastFmTrackInfo(
  title: string,
  artist: string,
): Promise<LastFmTrackInfo | null> {
  const apiKey = storage.getString('lastfm_api_key');
  if (!apiKey) return null;

  const params = new URLSearchParams({
    method: 'track.getInfo',
    api_key: apiKey,
    artist,
    track: title,
    autocorrect: '1',
    format: 'json',
  });
  const url = `${ENDPOINT}?${params.toString()}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) {
      logger.warn(`[LastFm] non-2xx ${res.status} for "${title}" / "${artist}"`);
      return null;
    }
    const json: unknown = await res.json();
    const parsed = parseResponse(json);
    const track = parsed.track;
    if (!track) return null;

    const info: LastFmTrackInfo = {};
    if (track.playcount) {
      const n = parseInt(track.playcount, 10);
      if (Number.isFinite(n)) info.playCount = n;
    }
    if (track.tagNames && track.tagNames.length > 0) {
      info.tags = track.tagNames;
    }
    if (track.wiki?.summary) info.summary = track.wiki.summary;

    if (Object.keys(info).length === 0) return null;
    return info;
  } catch (err) {
    logger.warn('[LastFm] request failed:', err);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}
