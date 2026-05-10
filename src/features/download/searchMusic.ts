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
import { searchYouTube } from './YoutubeExtractor';
import { logger } from '@/utils/logger';
import type { YouTubeSearchResult } from '@/types/track';

const PROVIDER_TIMEOUT_MS = 4500;

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

export async function searchMusic(
  query: string,
  limit = 15,
): Promise<YouTubeSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  // Fire both providers concurrently. allSettled so one failure doesn't
  // cancel the other — we still want to return whatever did succeed.
  const [saavnRes, ytRes] = await Promise.allSettled([
    withTimeout(searchSaavn(trimmed, limit), PROVIDER_TIMEOUT_MS, 'Saavn search'),
    withTimeout(searchYouTube(trimmed, limit), PROVIDER_TIMEOUT_MS, 'YouTube search'),
  ]);

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
