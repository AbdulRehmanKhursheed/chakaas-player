/**
 * MusicBrainz + Cover Art Archive client.
 *
 * Two-step lookup:
 *   1. Search MusicBrainz `/ws/2/recording` for a recording matching
 *      `<title> AND artist:<artist>`.
 *   2. Take the first release ID and fetch its cover from
 *      `https://coverartarchive.org/release/<id>/front-1200`.
 *
 * MusicBrainz requires a User-Agent that identifies the app and is rate
 * limited to 1 req/sec. We enforce a global 1100ms throttle between calls.
 */

import { logger } from '@/utils/logger';

const MB_ENDPOINT = 'https://musicbrainz.org/ws/2/recording/';
const CAA_ENDPOINT = 'https://coverartarchive.org/release';
const USER_AGENT = 'Chakaas/1.0 (personal music app)';
const TIMEOUT_MS = 4000;
const MB_MIN_INTERVAL_MS = 1100;

// ── Throttle ──────────────────────────────────────────────────────────────

let lastMbCallAt = 0;
let throttleChain: Promise<void> = Promise.resolve();

/**
 * Serialise and pace MusicBrainz calls to honour the 1 req/sec TOS.
 *
 * Each invocation queues onto `throttleChain`; the chain resolves only after
 * `MB_MIN_INTERVAL_MS` has elapsed since the previous resolution. This works
 * across concurrent callers without races.
 */
function throttleMb(): Promise<void> {
  const next = throttleChain.then(async () => {
    const wait = MB_MIN_INTERVAL_MS - (Date.now() - lastMbCallAt);
    if (wait > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, wait));
    }
    lastMbCallAt = Date.now();
  });
  throttleChain = next.catch(() => undefined);
  return next;
}

// ── Result type ───────────────────────────────────────────────────────────

export type MusicBrainzArtworkResult = {
  url: string;
  source: 'musicbrainz';
};

// ── Type guards ───────────────────────────────────────────────────────────

type MbRelease = {
  id: string;
};

type MbRecording = {
  id: string;
  releases: MbRelease[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asMbRelease(value: unknown): MbRelease | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string') return null;
  return { id: value.id };
}

function asMbRecording(value: unknown): MbRecording | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string') return null;
  const releases: MbRelease[] = [];
  if (Array.isArray(value.releases)) {
    for (const r of value.releases) {
      const rel = asMbRelease(r);
      if (rel) releases.push(rel);
    }
  }
  return { id: value.id, releases };
}

function parseMbResponse(value: unknown): MbRecording[] {
  if (!isRecord(value)) return [];
  if (!Array.isArray(value.recordings)) return [];
  const out: MbRecording[] = [];
  for (const r of value.recordings) {
    const rec = asMbRecording(r);
    if (rec) out.push(rec);
  }
  return out;
}

// ── HTTP helpers ──────────────────────────────────────────────────────────

async function searchRecording(
  title: string,
  artist: string,
): Promise<MbRecording[] | null> {
  // MusicBrainz Lucene-style query syntax. Escape only the obviously bad chars
  // and let the server handle the rest; we don't need surgical precision here.
  const safeTitle = title.replace(/[":]/g, ' ').trim();
  const safeArtist = artist.replace(/[":]/g, ' ').trim();
  const query = `${safeTitle} AND artist:${safeArtist}`;
  const url = `${MB_ENDPOINT}?query=${encodeURIComponent(query)}&fmt=json&limit=5`;

  await throttleMb();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'User-Agent': USER_AGENT,
      },
    });
    if (!res.ok) {
      logger.warn(`[MusicBrainz] non-2xx ${res.status} for "${title}" / "${artist}"`);
      return null;
    }
    const json: unknown = await res.json();
    return parseMbResponse(json);
  } catch (err) {
    logger.warn('[MusicBrainz] search failed:', err);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Probe Cover Art Archive for a release's front cover.
 *
 * CAA returns 307 redirects to the actual image on archive.org; React Native's
 * fetch follows redirects by default. A successful response means the image
 * exists at that URL. We return the canonical CAA URL string (not the
 * redirected target) so the caller can hand it to a downloader that re-
 * follows the redirect itself.
 */
async function probeCoverArt(releaseId: string): Promise<string | null> {
  const url = `${CAA_ENDPOINT}/${releaseId}/front-1200`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT },
    });
    // Anything 2xx — after redirect-follow — means a front cover exists.
    if (res.ok) return url;
    return null;
  } catch (err) {
    logger.warn('[CoverArtArchive] probe failed:', err);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Resolve a front-cover URL via MusicBrainz → Cover Art Archive.
 * Returns null if no recording matches or the release has no cover.
 */
export async function lookupMusicBrainzArtwork(
  title: string,
  artist: string,
): Promise<MusicBrainzArtworkResult | null> {
  const recordings = await searchRecording(title, artist);
  if (!recordings || recordings.length === 0) return null;

  for (const rec of recordings) {
    for (const rel of rec.releases) {
      const url = await probeCoverArt(rel.id);
      if (url) return { url, source: 'musicbrainz' };
    }
  }
  return null;
}
