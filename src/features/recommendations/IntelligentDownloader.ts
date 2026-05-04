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
  // filter inside the engine.
  const items = await getDiscoverFeed(Math.max(count * 2, 25));
  const suggestions = items.slice(0, count).map(toSuggestion);
  logger.info(
    `[IntelligentDownloader] Plan: ${suggestions.length} candidates (requested ${count}).`,
  );
  return suggestions;
}

/**
 * Returns one replacement suggestion that isn't already in `existingIds`.
 * Used by the "Skip" affordance on the plan-review cards.
 */
export async function getReplacementSuggestion(
  existingIds: string[],
): Promise<DownloadSuggestion | null> {
  const exclude = new Set(existingIds);
  const items = await getDiscoverFeed(50);
  const fresh = items.find((item) => !exclude.has(item.id));
  if (!fresh) {
    logger.warn('[IntelligentDownloader] No replacement found — pool exhausted.');
    return null;
  }
  return toSuggestion(fresh);
}
