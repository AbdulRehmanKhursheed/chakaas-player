/**
 * searchMusic — unified search entry point.
 *
 * Both providers are fired in parallel:
 *   • Saavn — primary catalog for Bollywood/Hindi/Indian content. Best when
 *     present: 320 kbps AAC, real metadata, no anti-bot.
 *   • YouTube — fallback for indie tracks, mashups, and regional content
 *     Saavn lacks.
 *
 * If Saavn returns ≥ 3 hits we use those alone (mixing providers confuses
 * dedupe). Otherwise we merge Saavn first, YouTube after.
 *
 * Each provider has a hard timeout so a hung CDN doesn't keep the spinner up.
 */
import { searchSaavn } from './providers/SaavnProvider';
import { searchSaavnMirrors } from './providers/SaavnMirrorsProvider';
import { searchPipedMusic } from './providers/PipedProvider';
import { searchInvidiousMusic } from './providers/InvidiousProvider';
import { searchAudius } from './providers/AudiusProvider';
import { searchSoundCloud } from './providers/SoundCloudProvider';
import { searchInternetArchive } from './providers/InternetArchiveProvider';
import { searchJamendo } from './providers/JamendoProvider';
import { searchYouTube } from './YoutubeExtractor';
import { searchAllSources } from './MultiSourceResolver';
import type { UnifiedSearchResult } from './MultiSourceResolver';
import { logger } from '@/utils/logger';
import type { YouTubeSearchResult } from '@/types/track';

const PROVIDER_TIMEOUT_MS = 4500;

/** Supported source slugs for `searchMusic.sources`. */
export type SearchSource =
  | 'saavn'
  | 'saavn-mirror'
  | 'youtube'
  | 'piped'
  | 'invidious'
  | 'audius'
  | 'soundcloud'
  | 'internet_archive'
  | 'jamendo';

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export interface SearchMusicOptions {
  /**
   * Caller-provided AbortSignal (e.g. from React Query). We don't have a
   * way to cancel the underlying `RNBlobUtil.fetch` mid-flight, but checking
   * `signal.aborted` between the parallel provider calls means a rapidly
   * typing user doesn't keep paying for stale post-processing.
   */
  signal?: AbortSignal;
  /**
   * Which sources to query. Defaults to `['saavn', 'youtube']` to preserve
   * the original UI-facing behavior. Settings → "Find more sources" can opt
   * into the wider chain.
   */
  sources?: SearchSource[];
}

/**
 * Registry mapping source slug → search function. Used by the optional
 * `sources` knob on `searchMusic`. Keeping it as a const map (rather than a
 * switch inside the loop) makes adding new sources a one-line change.
 */
const SOURCE_RUNNERS: Record<SearchSource, (q: string, n: number) => Promise<YouTubeSearchResult[]>> = {
  saavn: searchSaavn,
  'saavn-mirror': searchSaavnMirrors,
  youtube: searchYouTube,
  piped: searchPipedMusic,
  invidious: searchInvidiousMusic,
  audius: searchAudius,
  soundcloud: searchSoundCloud,
  internet_archive: searchInternetArchive,
  jamendo: searchJamendo,
};

export async function searchMusic(
  query: string,
  limit = 15,
  options: SearchMusicOptions = {},
): Promise<YouTubeSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const { signal } = options;
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  // ── Backward-compatible default: saavn + youtube. ───────────────────────
  if (!options.sources || options.sources.length === 0) {
    const [saavnRes, ytRes] = await Promise.allSettled([
      withTimeout(searchSaavn(trimmed, limit), PROVIDER_TIMEOUT_MS, 'Saavn search'),
      withTimeout(searchYouTube(trimmed, limit), PROVIDER_TIMEOUT_MS, 'YouTube search'),
    ]);

    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const saavnResults: YouTubeSearchResult[] =
      saavnRes.status === 'fulfilled' ? saavnRes.value : [];
    if (saavnRes.status === 'rejected') {
      logger.warn('[searchMusic] Saavn failed:', saavnRes.reason);
    }

    const ytResults: YouTubeSearchResult[] =
      ytRes.status === 'fulfilled' ? ytRes.value : [];
    if (ytRes.status === 'rejected') {
      logger.warn('[searchMusic] YouTube failed:', ytRes.reason);
    }

    if (saavnResults.length === 0 && ytResults.length === 0) {
      if (ytRes.status === 'rejected') throw ytRes.reason;
      if (saavnRes.status === 'rejected') throw saavnRes.reason;
      return [];
    }

    if (saavnResults.length >= 3) {
      return saavnResults.slice(0, limit);
    }

    const taggedYt = ytResults.map((r) => ({
      ...r,
      provider: r.provider ?? ('youtube' as const),
    }));

    return [...saavnResults, ...taggedYt].slice(0, limit);
  }

  // ── Explicit-sources path. Saavn-style results first if present. ────────
  const runners = options.sources.map((slug) => ({
    slug,
    run: SOURCE_RUNNERS[slug],
  }));

  const settled = await Promise.allSettled(
    runners.map(({ slug, run }) =>
      withTimeout(run(trimmed, limit), PROVIDER_TIMEOUT_MS, `${slug} search`).then(
        (rows) => ({ slug, rows }),
      ),
    ),
  );

  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const bySlug = new Map<SearchSource, YouTubeSearchResult[]>();
  for (const result of settled) {
    if (result.status !== 'fulfilled') {
      logger.warn('[searchMusic] source failed:', result.reason);
      continue;
    }
    bySlug.set(result.value.slug, result.value.rows);
  }

  // Saavn first (best Bollywood coverage), then the rest in caller-specified order.
  const out: YouTubeSearchResult[] = [];
  const seen = new Set<string>();
  const slugOrder: SearchSource[] = ['saavn', 'saavn-mirror', ...options.sources.filter((s) => s !== 'saavn' && s !== 'saavn-mirror')];
  for (const slug of slugOrder) {
    const rows = bySlug.get(slug);
    if (!rows) continue;
    for (const row of rows) {
      const key = `${row.provider ?? slug}:${row.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...row, provider: row.provider ?? (slug === 'saavn' || slug === 'saavn-mirror' ? 'saavn' : 'youtube') });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

// ── Deep search ─────────────────────────────────────────────────────────────

export interface DeepSearchOptions extends SearchMusicOptions {
  /** Per-source result cap. Defaults to 5. */
  limitPerSource?: number;
}

/**
 * Fans out the query to every supported source via the MultiSourceResolver's
 * `searchAllSources` helper. Returns the ranked, deduped unified list.
 *
 * Used by Settings → "Find more sources" (and any future UI that wants
 * maximum coverage at the cost of a slower search).
 */
export async function searchMusicDeep(
  query: string,
  options: DeepSearchOptions = {},
): Promise<UnifiedSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  if (options.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
  return searchAllSources(trimmed, options.limitPerSource ?? 5);
}
