/**
 * IntelligentDownloader — builds a ranked plan of songs the user is likely to
 * enjoy, used by the Downloads screen's "Find Songs" flow.
 *
 * Implementation notes:
 *   - Re-uses the artist-affinity engine and `getDiscoverFeed` so this module
 *     stays a thin adapter and we only have one ranking pipeline to maintain.
 *   - Wraps each Saavn search result in a `DownloadSuggestion` with a
 *     human-readable rationale ("Because you like Arijit Singh") and an
 *     estimated file size for the size readout in the UI.
 *   - `getReplacementSuggestion` is used when the user taps "Skip" on a
 *     planned card — it returns one fresh candidate that isn't already in
 *     the plan and isn't in the library.
 */

import { AVG_TRACK_BYTES, formatBytes } from '@/services/storage/StorageEstimator';
import { getDiscoverFeed, type DiscoverItem } from './discoverEngine';
import { logger } from '@/utils/logger';

// ── Public types ───────────────────────────────────────────────────────────

export interface DownloadSuggestion {
  /** Provider-native ID. Saavn song id (e.g. "aRZbUYD7") in this engine. */
  videoId: string;
  title: string;
  artist: string;
  thumbnail: string;
  duration_ms: number;
  /** Human-readable explanation, e.g. "Because you like Arijit Singh". */
  rationale: string;
  /** Estimated final on-disk size in bytes. */
  estimatedBytes: number;
  /** Pre-formatted size string. */
  estimatedSizeReadable: string;
  /** Composite score; higher is better. */
  priorityScore: number;
  /** Provider tag — Saavn for everything coming through this engine. */
  provider: 'saavn';
  /** Saavn-specific download metadata, threaded through to DownloadManager. */
  saavnEncryptedUrl: string;
  saavnHas320kbps: boolean;
  saavnAlbum: string;
}

// ── Adapter ────────────────────────────────────────────────────────────────

function toSuggestion(item: DiscoverItem): DownloadSuggestion {
  return {
    videoId: item.id,
    title: item.title,
    artist: item.author,
    thumbnail: item.thumbnail,
    duration_ms: item.duration_ms,
    rationale: item.reason,
    estimatedBytes: AVG_TRACK_BYTES,
    estimatedSizeReadable: formatBytes(AVG_TRACK_BYTES),
    priorityScore: item.score,
    provider: 'saavn',
    saavnEncryptedUrl: item.saavnEncryptedUrl ?? '',
    saavnHas320kbps: item.saavnHas320kbps ?? false,
    saavnAlbum: item.saavnAlbum ?? '',
  };
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Builds a ranked plan of `count` candidate downloads. Returns fewer than
 * `count` items when the engine couldn't surface enough fresh suggestions
 * (e.g. tiny seed + most matches already in library).
 */
export async function buildDownloadCandidates(
  count: number,
): Promise<DownloadSuggestion[]> {
  if (count <= 0) return [];
  // Pull a generous over-sample so we have headroom for the dedupe / library
  // filter inside the engine. If the engine itself throws (network outage,
  // DB read failure), let it propagate — the caller wraps this in a flow
  // state that surfaces a user-facing error card.
  let items;
  try {
    items = await getDiscoverFeed(Math.max(count * 2, 25));
  } catch (err) {
    logger.warn('[IntelligentDownloader] getDiscoverFeed threw:', err);
    throw err instanceof Error ? err : new Error(String(err));
  }
  if (!Array.isArray(items)) {
    logger.warn('[IntelligentDownloader] getDiscoverFeed returned non-array');
    return [];
  }
  const suggestions = items.slice(0, count).map(toSuggestion);
  logger.info(
    `[IntelligentDownloader] Plan: ${suggestions.length} candidates (requested ${count}).`,
  );
  return suggestions;
}

// ── Replacement-suggestion pool cache ─────────────────────────────────────
//
// The Downloads-screen plan lets the user tap "Skip" repeatedly to swap any
// suggestion they don't like. Previously every tap fired a full
// `getDiscoverFeed(50)` round-trip — 8 parallel Saavn searches per skip.
// 10 skips = 80 API calls.
//
// We now fetch a 50-item pool ONCE, hand out one fresh item per skip, and
// only refetch when the pool is exhausted (or 30 minutes pass — `pool_v1`
// is short-lived; the user's taste profile may have shifted by then).
let _replacementPool: DiscoverItem[] = [];
let _replacementPoolFetchedAt = 0;
const REPLACEMENT_POOL_TTL_MS = 30 * 60 * 1000;

/**
 * Returns one replacement suggestion that isn't already in `existingIds`.
 * Used by the "Skip" affordance on the plan-review cards.
 *
 * Caches the suggestion pool across calls so repeated skips don't fire a
 * fresh Saavn fan-out every tap.
 */
export async function getReplacementSuggestion(
  existingIds: string[],
): Promise<DownloadSuggestion | null> {
  const exclude = new Set(existingIds);
  const now = Date.now();
  const poolExpired = now - _replacementPoolFetchedAt > REPLACEMENT_POOL_TTL_MS;

  // First try to satisfy from the cached pool.
  let fresh = !poolExpired
    ? _replacementPool.find((item) => !exclude.has(item.id))
    : undefined;

  if (!fresh) {
    // Pool empty / exhausted / expired — refill once. Catch defensively so
    // a transient network failure here doesn't bubble up to the Skip handler
    // and crash the touch handler.
    try {
      _replacementPool = await getDiscoverFeed(50);
      _replacementPoolFetchedAt = now;
      fresh = _replacementPool.find((item) => !exclude.has(item.id));
    } catch (err) {
      logger.warn('[IntelligentDownloader] replacement pool refill failed:', err);
      return null;
    }
  }

  if (!fresh) {
    logger.warn('[IntelligentDownloader] No replacement found — pool exhausted.');
    return null;
  }

  // Remove the handed-out item from the pool so the next skip gets a
  // genuinely different track without re-comparing against `existingIds`.
  _replacementPool = _replacementPool.filter((item) => item.id !== fresh!.id);

  return toSuggestion(fresh);
}

/**
 * Wipes the cached replacement pool — call from places that materially change
 * the user's taste profile (e.g. a session-wide refresh, large skip storm).
 * Exposed for future use; not currently invoked.
 */
export function clearReplacementPool(): void {
  _replacementPool = [];
  _replacementPoolFetchedAt = 0;
}
