/**
 * searchMusic — unified search entry point.
 *
 * Strategy:
 *   1. Hit JioSaavn first. For Bollywood / Hindi / Indian content (the entire
 *      target use case of Chakaas) Saavn has a curated, anti-bot-free catalog
 *      with proper artist/album metadata and lossless 320 kbps M4A.
 *   2. Fall back to YouTube only when Saavn returns nothing — needed for
 *      independent uploads, mashups, regional language tracks Saavn lacks,
 *      and the rare YouTube-exclusive.
 *
 * The user-facing UX prefers Saavn results because they download reliably
 * (no IP throttling, no cipher), play back at premium quality (320 kbps AAC
 * passthrough), and ship with real metadata. YouTube is the safety net.
 */
import { searchSaavn } from './providers/SaavnProvider';
import { searchYouTube } from './YoutubeExtractor';
import { logger } from '@/utils/logger';
import type { YouTubeSearchResult } from '@/types/track';

/**
 * Returns up to `limit` results, Saavn-first then YouTube fallback.
 *
 * If Saavn errors but YouTube succeeds, only YouTube results come back. If
 * both providers fail, the error from YouTube is propagated (it's the more
 * informative one — Saavn errors usually mean a transient JSON parse).
 */
export async function searchMusic(
  query: string,
  limit = 15,
): Promise<YouTubeSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  let saavnResults: YouTubeSearchResult[] = [];
  try {
    saavnResults = await searchSaavn(trimmed, limit);
  } catch (err) {
    logger.warn('[searchMusic] Saavn search failed, will try YouTube:', err);
  }

  // Saavn returned a healthy result set — return it directly. We do not blend
  // YouTube in because mixing the two confuses dedupe and library-match logic
  // (same song under two different IDs).
  if (saavnResults.length >= 3) {
    return saavnResults.slice(0, limit);
  }

  let ytResults: YouTubeSearchResult[] = [];
  try {
    ytResults = await searchYouTube(trimmed, limit);
  } catch (err) {
    logger.error('[searchMusic] YouTube fallback also failed:', err);
    if (saavnResults.length === 0) throw err;
  }

  // Mark any unmarked results as YouTube for discriminator clarity.
  const taggedYt = ytResults.map((r) => ({
    ...r,
    provider: r.provider ?? ('youtube' as const),
  }));

  // Saavn had < 3 hits but might still have something useful. Show Saavn
  // first (better source), then YouTube to fill out the list.
  const merged: YouTubeSearchResult[] = [...saavnResults, ...taggedYt];
  return merged.slice(0, limit);
}
