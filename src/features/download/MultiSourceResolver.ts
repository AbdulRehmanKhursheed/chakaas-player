/**
 * MultiSourceResolver — tries 10+ music sources in priority order until one
 * returns a high-quality audio stream.
 *
 * Why this exists
 * ───────────────
 * Personal-use music aggregation: a Bollywood track that fails on Saavn
 * because of a temporary CDN hiccup should auto-succeed via the Saavn
 * mirrors; a Western track that fails on YouTube due to a stale po_token
 * should fall through to Piped, Invidious, Audius, SoundCloud, Internet
 * Archive, or Jamendo before we ever bother the user with an error.
 *
 * Priority order — `resolveAudioStream`
 * ─────────────────────────────────────
 *  1. SaavnProvider via `hints.saavnEncryptedUrl`         (fastest — already have token input)
 *  2. SaavnProvider.search → top result
 *  3. SaavnMirrorsProvider (saavn.dev → privatecvc)
 *  4. PipedProvider direct via `hints.youtubeId`
 *  5. PipedProvider.search → top result
 *  6. InvidiousProvider direct/search
 *  7. YoutubeExtractor (existing path)
 *  8. AudiusProvider.search → top
 *  9. SoundCloudProvider.search → top (only if no Bollywood signal — skip
 *                                       for hindi/devanagari titles)
 * 10. InternetArchiveProvider.search → top
 * 11. JamendoProvider.search → top
 *
 * Quality gate
 * ────────────
 * A source is only accepted when:
 *   - `url` is non-empty
 *   - `bitrate >= 128_000`
 *
 * Each source is wrapped in `Promise.race` with a 10s deadline. Failures
 * are logged and the chain falls through.
 */
import { logger } from '@/utils/logger';
import { logFailure, withDeadline } from '@/utils/http';

import {
  searchSaavn,
  getSaavnStreamUrl,
} from './providers/SaavnProvider';
import {
  searchSaavnMirrors,
  getSaavnMirrorStreamUrl,
} from './providers/SaavnMirrorsProvider';
import {
  searchPipedMusic,
  getPipedStreamUrl,
} from './providers/PipedProvider';
import {
  searchInvidiousMusic,
  getInvidiousStreamUrl,
} from './providers/InvidiousProvider';
import {
  searchAudius,
  getAudiusStreamUrl,
} from './providers/AudiusProvider';
import {
  searchSoundCloud,
  getSoundCloudStreamUrl,
} from './providers/SoundCloudProvider';
import {
  searchInternetArchive,
  getInternetArchiveStreamUrl,
} from './providers/InternetArchiveProvider';
import {
  searchJamendo,
  getJamendoStreamUrl,
} from './providers/JamendoProvider';
import { searchHungama } from './providers/HungamaProvider';
import { getBestAudioStream } from './YoutubeExtractor';

import type { AudioStreamInfo, ResolverSourceId } from './providers/types';
import type { YouTubeSearchResult } from '@/types/track';

// ── Constants ────────────────────────────────────────────────────────────────

/**
 * Per-source deadline. Lowered from 10s to 6s — empirically every legitimate
 * source returns in under 3s; 6s is plenty of head-room. The old worst-case
 * of 11 × 10s = 110s per resolve was the dominant tail-latency contributor
 * to download failures during flaky connectivity.
 */
const SOURCE_DEADLINE_MS = 6_000;
const MIN_ACCEPTABLE_BITRATE = 128_000;

/**
 * If this many sources fail back-to-back, bail out — at that point it's
 * almost certainly a network issue, not a per-source problem, and the
 * DownloadManager's own retry loop will pick up where we left off. Caps the
 * worst-case resolve latency at ~24s instead of ~66s.
 */
const CONSECUTIVE_FAILURE_BAIL = 4;

// ── Hints + params ───────────────────────────────────────────────────────────

export interface ResolveHints {
  /** YouTube videoId — lets us hit Piped/Invidious/YT directly without searching. */
  youtubeId?: string;
  /** Saavn songId — currently informational; the resolver uses `saavnEncryptedUrl` for the fast path. */
  saavnId?: string;
  /** Saavn encrypted_media_url from a prior search result — fastest Saavn entry. */
  saavnEncryptedUrl?: string;
  /** When the Saavn search row gave us a *direct* media URL instead of an encrypted blob. */
  saavnDirectMediaUrl?: boolean;
  /** Whether the Saavn 320kbps tier is available; falls back to 160 kbps if not. */
  saavnHas320kbps?: boolean;
  /** Audius trackId — skip Audius search when we already have it. */
  audiusId?: string;
  /** SoundCloud trackId — same idea. */
  soundcloudId?: string;
}

export interface ResolveParams {
  query: string;
  hints?: ResolveHints;
  preferredQuality?: '128k' | '192k' | '256k' | '320k';
}

// ── Bollywood-signal heuristic ───────────────────────────────────────────────

/**
 * Detects Bollywood / Hindi / Indian content from the query string. Used to
 * skip SoundCloud (which has almost no Bollywood catalog) when the user is
 * clearly looking for Indian music. Two signals:
 *   - Devanagari characters in the string.
 *   - Common Bollywood keywords (English transliteration).
 */
const BOLLYWOOD_KEYWORDS = [
  'bollywood',
  'hindi',
  'punjabi',
  'arijit',
  'shreya',
  'sonu nigam',
  'lata',
  'kishore',
  'kumar sanu',
  'badshah',
  'diljit',
  'honey singh',
  'atif',
  'rahat',
  'jubin',
  'guru randhawa',
  'neha kakkar',
  'pritam',
  'a.r. rahman',
  'rahman',
  'shreya ghoshal',
  'kk',
  'sidhu moose wala',
  'bhojpuri',
  'tamil',
  'telugu',
  'marathi',
  'gujarati',
  'bhangra',
];

function hasBollywoodSignal(query: string): boolean {
  const lower = query.toLowerCase();
  // Devanagari unicode range U+0900–U+097F
  if (/[ऀ-ॿ]/.test(query)) return true;
  for (const kw of BOLLYWOOD_KEYWORDS) {
    if (lower.includes(kw)) return true;
  }
  return false;
}

// ── Acceptance / deadline helpers ────────────────────────────────────────────

function isAcceptable(stream: AudioStreamInfo): boolean {
  if (!stream.url || stream.url.length < 20) return false;
  if (!Number.isFinite(stream.bitrate) || stream.bitrate < MIN_ACCEPTABLE_BITRATE) return false;
  return true;
}

async function tryStep(
  label: string,
  fn: () => Promise<AudioStreamInfo>,
): Promise<AudioStreamInfo | null> {
  try {
    const stream: AudioStreamInfo = await withDeadline(fn(), SOURCE_DEADLINE_MS, label);
    if (!isAcceptable(stream)) {
      const bitrate = stream && typeof stream.bitrate === 'number' ? stream.bitrate : 0;
      logger.warn(`[Resolver] ${label} returned unacceptable stream (bitrate=${bitrate})`);
      return null;
    }
    logger.info(`[Resolver] ${label} succeeded — bitrate=${stream.bitrate} container=${stream.container}`);
    return stream;
  } catch (err) {
    logFailure(`Resolver:${label}`, err);
    return null;
  }
}

// ── resolveAudioStream ───────────────────────────────────────────────────────

/**
 * Returns true if the user's `preferredQuality` setting permits the 320 kbps
 * Saavn tier. `'128k' | '192k' | '256k'` all force the 160 kbps tier; only
 * `'320k'` (or undefined, defaulting to "best available") lets us request 320.
 *
 * This is the single source of truth for "the user's Settings → Audio Quality
 * choice actually changes what we download". Without it, the setting was UI-
 * only — every Saavn request unconditionally asked for 320 when available.
 */
function quality320Allowed(preferred: ResolveParams['preferredQuality']): boolean {
  if (!preferred) return true;
  return preferred === '320k';
}

/**
 * Tries every source in priority order. Returns the first accepted stream.
 * Throws only when every source has been exhausted.
 */
export async function resolveAudioStream(params: ResolveParams): Promise<AudioStreamInfo> {
  const { query, hints, preferredQuality } = params;
  const trimmedQuery = query.trim();
  const allow320 = quality320Allowed(preferredQuality);

  // Counts back-to-back failed sources. Reset on every accepted stream
  // (impossible to reach here since we return on success) and on every
  // skipped source (e.g. SoundCloud skipped on Bollywood signal). When the
  // counter hits CONSECUTIVE_FAILURE_BAIL we throw — DownloadManager has its
  // own retry/refresh loop, and a long string of failures is almost always
  // a transient network problem rather than a per-source bug.
  let consecutiveFailures = 0;
  const attemptStep = async (
    label: string,
    fn: () => Promise<AudioStreamInfo>,
  ): Promise<AudioStreamInfo | null> => {
    const result = await tryStep(label, fn);
    if (result) {
      consecutiveFailures = 0;
    } else {
      consecutiveFailures += 1;
      if (consecutiveFailures >= CONSECUTIVE_FAILURE_BAIL) {
        throw new Error(
          `MultiSourceResolver: ${consecutiveFailures} consecutive sources failed — bailing early (likely network)`,
        );
      }
    }
    return result;
  };

  // ── 1. Direct Saavn fast path (encrypted URL hint) ──────────────────────
  if (hints?.saavnEncryptedUrl) {
    const directMedia = hints.saavnDirectMediaUrl === true;
    // `wants320` is clamped by the user's Settings → Audio Quality choice.
    // Source may have 320 available, but if the user picked '192k' we ask
    // for the 160 kbps tier instead.
    const wants320 = (hints.saavnHas320kbps ?? false) && allow320;
    if (directMedia) {
      const stream = await attemptStep('Saavn-mirror-hint', () =>
        getSaavnMirrorStreamUrl(hints.saavnEncryptedUrl ?? '', wants320),
      );
      if (stream) return stream;
    } else {
      const stream = await attemptStep('Saavn-hint', () =>
        getSaavnStreamUrl(hints.saavnEncryptedUrl ?? '', wants320),
      );
      if (stream) return stream;
    }
  }

  // ── 2. Saavn search → top result ────────────────────────────────────────
  if (trimmedQuery) {
    const stream = await attemptStep('Saavn-search', async () => {
      const results = await searchSaavn(trimmedQuery, 1);
      const top = results[0];
      if (!top?.saavnEncryptedUrl) throw new Error('Saavn search returned no usable result');
      const wants320 = (top.saavnHas320kbps ?? false) && allow320;
      return getSaavnStreamUrl(top.saavnEncryptedUrl, wants320);
    });
    if (stream) return stream;
  }

  // ── 3. Saavn mirrors ────────────────────────────────────────────────────
  if (trimmedQuery) {
    const stream = await attemptStep('SaavnMirrors-search', async () => {
      const results = await searchSaavnMirrors(trimmedQuery, 1);
      const top = results[0];
      if (!top?.saavnEncryptedUrl) throw new Error('SaavnMirrors returned no usable result');
      const wants320 = (top.saavnHas320kbps ?? false) && allow320;
      return getSaavnMirrorStreamUrl(top.saavnEncryptedUrl, wants320);
    });
    if (stream) return stream;
  }

  // ── 4. Piped direct (videoId hint) ──────────────────────────────────────
  if (hints?.youtubeId) {
    const stream = await attemptStep('Piped-hint', () => getPipedStreamUrl(hints.youtubeId ?? ''));
    if (stream) return stream;
  }

  // ── 5. Piped search → top result ────────────────────────────────────────
  if (trimmedQuery) {
    const stream = await attemptStep('Piped-search', async () => {
      const results = await searchPipedMusic(trimmedQuery, 1);
      const top = results[0];
      if (!top?.id) throw new Error('Piped search returned no result');
      return getPipedStreamUrl(top.id);
    });
    if (stream) return stream;
  }

  // ── 6. Invidious direct + search (reuse the same videoId if we have one) ─
  if (hints?.youtubeId) {
    const stream = await attemptStep('Invidious-hint', () => getInvidiousStreamUrl(hints.youtubeId ?? ''));
    if (stream) return stream;
  }
  if (trimmedQuery) {
    const stream = await attemptStep('Invidious-search', async () => {
      const results = await searchInvidiousMusic(trimmedQuery, 1);
      const top = results[0];
      if (!top?.id) throw new Error('Invidious search returned no result');
      return getInvidiousStreamUrl(top.id);
    });
    if (stream) return stream;
  }

  // ── 7. Direct YoutubeExtractor (the existing path) ──────────────────────
  if (hints?.youtubeId) {
    const stream = await attemptStep('YoutubeExtractor', async () => {
      const direct = await getBestAudioStream(hints.youtubeId ?? '');
      return { ...direct, source: 'youtube' as ResolverSourceId };
    });
    if (stream) return stream;
  }

  // ── 8. Audius (search by query or use hint) ─────────────────────────────
  if (hints?.audiusId) {
    const stream = await attemptStep('Audius-hint', () => getAudiusStreamUrl(hints.audiusId ?? ''));
    if (stream) return stream;
  }
  if (trimmedQuery) {
    const stream = await attemptStep('Audius-search', async () => {
      const results = await searchAudius(trimmedQuery, 1);
      const top = results[0];
      if (!top?.id) throw new Error('Audius search returned no result');
      return getAudiusStreamUrl(top.id);
    });
    if (stream) return stream;
  }

  // ── 9. SoundCloud — skip for Bollywood/Hindi (no catalog there) ─────────
  if (!hasBollywoodSignal(trimmedQuery)) {
    if (hints?.soundcloudId) {
      const stream = await attemptStep('SoundCloud-hint', () =>
        getSoundCloudStreamUrl(hints.soundcloudId ?? ''),
      );
      if (stream) return stream;
    }
    if (trimmedQuery) {
      const stream = await attemptStep('SoundCloud-search', async () => {
        const results = await searchSoundCloud(trimmedQuery, 1);
        const top = results[0];
        if (!top?.id) throw new Error('SoundCloud search returned no result');
        return getSoundCloudStreamUrl(top.id);
      });
      if (stream) return stream;
    }
  } else {
    logger.info('[Resolver] Skipping SoundCloud — Bollywood signal detected');
  }

  // ── 10. Internet Archive ────────────────────────────────────────────────
  if (trimmedQuery) {
    const stream = await attemptStep('InternetArchive-search', async () => {
      const results = await searchInternetArchive(trimmedQuery, 1);
      const top = results[0];
      if (!top?.id) throw new Error('Internet Archive search returned no result');
      return getInternetArchiveStreamUrl(top.id);
    });
    if (stream) return stream;
  }

  // ── 11. Jamendo ─────────────────────────────────────────────────────────
  if (trimmedQuery) {
    const stream = await attemptStep('Jamendo-search', async () => {
      const results = await searchJamendo(trimmedQuery, 1);
      const top = results[0];
      if (!top?.id) throw new Error('Jamendo search returned no result');
      return getJamendoStreamUrl(top.id);
    });
    if (stream) return stream;
  }

  throw new Error(
    `MultiSourceResolver: no provider returned a usable stream for "${trimmedQuery || hints?.youtubeId || 'unknown'}".`,
  );
}

// ── searchAllSources ─────────────────────────────────────────────────────────

export type UnifiedSearchSource =
  | 'saavn'
  | 'saavn-mirror'
  | 'piped'
  | 'invidious'
  | 'audius'
  | 'soundcloud'
  | 'internet_archive'
  | 'jamendo'
  | 'hungama';

export interface UnifiedSearchResult {
  source: UnifiedSearchSource;
  id: string;
  title: string;
  artist: string;
  thumbnail: string;
  durationMs: number;
  /** Best estimated bitrate (bps). 0 when unknown. */
  bitrate: number;
  /** Human-readable quality hint, e.g. "320 kbps". */
  qualityHint: string;
  /** Native result row from the source — caller can downcast when needed. */
  raw: YouTubeSearchResult;
}

const SOURCE_PRIORITY: Record<UnifiedSearchSource, number> = {
  saavn: 100,
  'saavn-mirror': 90,
  piped: 80,
  invidious: 75,
  audius: 60,
  hungama: 55,
  soundcloud: 45,
  internet_archive: 30,
  jamendo: 20,
};

function bitrateForSource(source: UnifiedSearchSource, has320: boolean): number {
  switch (source) {
    case 'saavn':
    case 'saavn-mirror':
      return has320 ? 320_000 : 160_000;
    case 'audius':
      return 320_000;
    case 'piped':
    case 'invidious':
      return 192_000; // YouTube AAC ranges 128–256k; we don't know until /streams
    case 'jamendo':
      return 192_000;
    case 'internet_archive':
      return 192_000;
    case 'soundcloud':
      return 128_000;
    case 'hungama':
      return 0; // search-only contributor
  }
}

function qualityHint(bitrate: number): string {
  if (bitrate <= 0) return 'unknown';
  return `${Math.round(bitrate / 1000)} kbps`;
}

function normalizeForDedupe(title: string, artist: string): string {
  return `${title} ${artist}`
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9ऀ-ॿ]+/g, ' ')
    .trim();
}

function toUnified(
  source: UnifiedSearchSource,
  raw: YouTubeSearchResult,
): UnifiedSearchResult {
  const has320 = raw.saavnHas320kbps === true;
  const bitrate = bitrateForSource(source, has320);
  return {
    source,
    id: raw.id,
    title: raw.title,
    artist: raw.author,
    thumbnail: raw.thumbnail,
    durationMs: raw.duration_ms,
    bitrate,
    qualityHint: qualityHint(bitrate),
    raw,
  };
}

/**
 * Fans out the query to every source and returns a deduped, ranked list.
 *
 * Ranking:
 *   1. Saavn-first when the query is Bollywood. Source priority otherwise.
 *   2. Higher bitrate wins ties.
 *   3. Hungama is metadata-only so it ranks lower for stream picks even
 *      though its catalog is good for Bollywood.
 */
export async function searchAllSources(
  query: string,
  limitPerSource = 5,
): Promise<UnifiedSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const sources: Array<{
    name: UnifiedSearchSource;
    run: () => Promise<YouTubeSearchResult[]>;
  }> = [
    { name: 'saavn', run: () => searchSaavn(trimmed, limitPerSource) },
    { name: 'saavn-mirror', run: () => searchSaavnMirrors(trimmed, limitPerSource) },
    { name: 'piped', run: () => searchPipedMusic(trimmed, limitPerSource) },
    { name: 'invidious', run: () => searchInvidiousMusic(trimmed, limitPerSource) },
    { name: 'audius', run: () => searchAudius(trimmed, limitPerSource) },
    { name: 'soundcloud', run: () => searchSoundCloud(trimmed, limitPerSource) },
    { name: 'internet_archive', run: () => searchInternetArchive(trimmed, limitPerSource) },
    { name: 'jamendo', run: () => searchJamendo(trimmed, limitPerSource) },
    { name: 'hungama', run: () => searchHungama(trimmed, limitPerSource) },
  ];

  const settled = await Promise.allSettled(
    sources.map((s) =>
      withDeadline(s.run(), SOURCE_DEADLINE_MS, `searchAll:${s.name}`).then((rows) => ({
        name: s.name,
        rows,
      })),
    ),
  );

  const allResults: UnifiedSearchResult[] = [];
  for (const result of settled) {
    if (result.status !== 'fulfilled') {
      logFailure('searchAllSources', result.reason);
      continue;
    }
    for (const raw of result.value.rows) {
      allResults.push(toUnified(result.value.name, raw));
    }
  }

  // Dedupe by normalized title+artist — keep the highest-priority+bitrate copy.
  const bestByKey = new Map<string, UnifiedSearchResult>();
  const isBollywood = hasBollywoodSignal(trimmed);

  const sourceScore = (source: UnifiedSearchSource): number => {
    if (isBollywood && (source === 'saavn' || source === 'saavn-mirror' || source === 'hungama')) {
      return SOURCE_PRIORITY[source] + 50;
    }
    return SOURCE_PRIORITY[source];
  };

  const rank = (r: UnifiedSearchResult): number =>
    sourceScore(r.source) * 1_000 + r.bitrate / 1_000;

  for (const r of allResults) {
    const key = normalizeForDedupe(r.title, r.artist);
    if (!key) continue;
    const existing = bestByKey.get(key);
    if (!existing || rank(r) > rank(existing)) {
      bestByKey.set(key, r);
    }
  }

  const merged = Array.from(bestByKey.values());
  merged.sort((a, b) => rank(b) - rank(a));
  return merged;
}
