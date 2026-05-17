/**
 * HungamaProvider — Indian music platform. Hungama exposes an unofficial
 * search endpoint that powers their web autocomplete. In practice it returns
 * rich Bollywood metadata but the stream URLs are protected behind
 * subscription DRM, so this provider is treated as a *search-only*
 * contributor — downloads always fall through to another source for the
 * actual audio.
 *
 * Endpoint:
 *   GET https://www.hungama.com/api/search/all/<query>
 */
import { HttpError, httpGetJson } from '@/utils/http';
import { logger } from '@/utils/logger';
import type { YouTubeSearchResult } from '@/types/track';

const SEARCH_BASE = 'https://www.hungama.com/api/search/all';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

interface HungamaSong {
  id?: unknown;
  title?: unknown;
  name?: unknown;
  song_name?: unknown;
  song?: unknown;
  primary_artist?: unknown;
  artist?: unknown;
  image?: unknown;
  artwork?: unknown;
  duration?: unknown;
  album?: unknown;
  album_name?: unknown;
}

function mapHungamaSong(raw: unknown): YouTubeSearchResult | null {
  if (!isRecord(raw)) return null;
  const s = raw as HungamaSong;

  const idVal = s.id;
  const id =
    typeof idVal === 'number' ? String(idVal) : asString(idVal);
  if (!id) return null;

  const title =
    asString(s.title) ||
    asString(s.name) ||
    asString(s.song_name) ||
    asString(s.song);
  if (!title) return null;

  const author =
    asString(s.primary_artist) ||
    asString(s.artist) ||
    'Hungama';

  const durationVal = s.duration;
  const durationSec =
    typeof durationVal === 'number'
      ? durationVal
      : Number.parseFloat(asString(durationVal));
  const durationMs =
    Number.isFinite(durationSec) && durationSec > 0 ? durationSec * 1000 : 0;

  return {
    id,
    title,
    author,
    duration_ms: durationMs,
    thumbnail: asString(s.image) || asString(s.artwork),
    view_count: asString(s.album) || asString(s.album_name) || 'Hungama',
    provider: 'saavn',
  };
}

/**
 * Searches Hungama. Returns metadata results — these are useful for the
 * unified-search ranker but their `id` values are NOT directly downloadable.
 * The resolver should treat Hungama hits as a metadata enrichment and route
 * the actual stream through another provider (Saavn / Piped / ...).
 */
export async function searchHungama(
  query: string,
  limit = 15,
): Promise<YouTubeSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const url = `${SEARCH_BASE}/${encodeURIComponent(trimmed)}`;
  try {
    const data = await httpGetJson<unknown>(url, { timeoutMs: 7000 });
    // Hungama nests differently across endpoints. We probe the typical paths.
    let songsArr: unknown[] = [];
    if (isRecord(data)) {
      const candidates: unknown[] = [
        (data as Record<string, unknown>).songs,
        (data as Record<string, unknown>).results,
        isRecord(data.data)
          ? (data.data as Record<string, unknown>).songs
          : null,
        isRecord(data.data)
          ? (data.data as Record<string, unknown>).results
          : null,
      ];
      for (const c of candidates) {
        if (Array.isArray(c) && c.length > 0) {
          songsArr = c;
          break;
        }
      }
      if (songsArr.length === 0 && isRecord(data.songs)) {
        songsArr = asArray((data.songs as Record<string, unknown>).data);
      }
    }

    const out: YouTubeSearchResult[] = [];
    const seen = new Set<string>();
    for (const raw of songsArr) {
      const mapped = mapHungamaSong(raw);
      if (!mapped || seen.has(mapped.id)) continue;
      seen.add(mapped.id);
      out.push(mapped);
      if (out.length >= limit) break;
    }
    return out;
  } catch (err) {
    if (err instanceof HttpError) {
      logger.warn(`[Hungama] search HTTP ${err.status}`);
    }
    throw err;
  }
}
