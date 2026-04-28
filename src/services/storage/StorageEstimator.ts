/**
 * StorageEstimator
 * ────────────────
 *
 * Centralised storage-budget estimation for the download flow.
 *
 * Every value flows from one of three sources:
 *   1. The OS  — free / total bytes, via `RNBlobUtil.fs.df()` (see
 *      `node_modules/react-native-blob-util/index.d.ts:455`). On Android we
 *      read the `internal_free` / `internal_total` *string* fields and coerce
 *      to numbers; on iOS we read the numeric `free` / `total` fields. Both
 *      shapes are merged in the `RNFetchBlobDf` type, so we read defensively.
 *   2. The library — `tracksCollection.query().fetchCount()` for the live
 *      track count.
 *   3. A constant — `AVG_TRACK_BYTES`, our calibrated average per-track
 *      footprint (see below).
 *
 * The single source of truth: every "will it fit?" question routes through
 * `getRecommendedDownloadCount()` so the UI always sees a coherent number.
 */

import RNBlobUtil from 'react-native-blob-util';
import { tracksCollection } from '@/db';
import { logger } from '@/utils/logger';

// ── Constants ──────────────────────────────────────────────────────────────

/**
 * Estimated bytes consumed by a single fully-downloaded track.
 *
 * Breakdown (target premium 320k AAC):
 *   • ~8.5 MB AAC audio (320 kbps × ~3:30 average track length)
 *   •  ~50 KB cached artwork JPEG
 *   • Headroom for occasional longer tracks / metadata
 *
 * Slight over-estimate so capacity warnings err on the safe side.
 */
export const AVG_TRACK_BYTES = 9 * 1024 * 1024; // 9 MB

/**
 * Free-space safety buffer. We reserve this many bytes before computing how
 * many tracks "fit" — even on tight devices the OS / other apps need scratch
 * space, and dipping below this can make the phone visibly sluggish.
 */
const FREE_SPACE_BUFFER = 500 * 1024 * 1024; // 500 MB

/** Hard ceiling on how many tracks can be planned in a single session. */
const MAX_PER_SESSION = 25;

// ── formatBytes ────────────────────────────────────────────────────────────

/**
 * Formats a byte count as a short human-readable string. Examples:
 *
 *   formatBytes(0)            → "0 B"
 *   formatBytes(900)          → "900 B"
 *   formatBytes(1500)         → "1.5 KB"
 *   formatBytes(108_000_000)  → "108 MB"
 *   formatBytes(34_300_000_000) → "32.0 GB"
 *
 * Picks the largest unit where the value is ≥ 1, rounds to 1 decimal place
 * for KB/MB/GB and to a whole number for bytes.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';

  const KB = 1024;
  const MB = KB * 1024;
  const GB = MB * 1024;

  if (bytes < KB) return `${Math.round(bytes)} B`;
  if (bytes < MB) return `${(bytes / KB).toFixed(1)} KB`;
  if (bytes < GB) {
    // Whole-number MB once we're past 100 MB to keep the UI compact.
    const mb = bytes / MB;
    return mb >= 100 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
  }
  return `${(bytes / GB).toFixed(1)} GB`;
}

// ── StorageInfo ────────────────────────────────────────────────────────────

export interface StorageInfo {
  /** Total internal storage on the device, in bytes. */
  totalBytes: number;
  /** Free space currently available, in bytes. */
  freeBytes: number;
  /** Free bytes minus the safety buffer; never below 0. */
  usableBytes: number;
}

/**
 * Reads the current free-/total-bytes figure for the device's primary storage.
 *
 * Android: the `df()` payload exposes `internal_free` / `internal_total` as
 * *strings* (the underlying `StatFs` API returns 64-bit values that don't fit
 * in a JS number when treated as ints, so the bridge stringifies them).
 *
 * iOS: the same call returns numeric `free` / `total` fields directly.
 *
 * Both shapes are unioned into `RNFetchBlobDf`; we read whichever is present
 * and coerce safely. Any error or missing field falls through to a
 * conservative all-zero result.
 */
export async function getStorageInfo(): Promise<StorageInfo> {
  try {
    const df = await RNBlobUtil.fs.df();

    // Coerce both Android (string) and iOS (number) shapes via Number(...)
    // — empty/undefined values become NaN which we then floor to 0.
    const toNum = (v: string | number | undefined): number => {
      if (v === undefined || v === null) return 0;
      const n = typeof v === 'number' ? v : Number(v);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    };

    const free = toNum(df.internal_free) || toNum(df.free);
    const total = toNum(df.internal_total) || toNum(df.total);

    const usableBytes = Math.max(0, free - FREE_SPACE_BUFFER);

    return { totalBytes: total, freeBytes: free, usableBytes };
  } catch (err) {
    logger.error('[StorageEstimator] df() failed:', err);
    return { totalBytes: 0, freeBytes: 0, usableBytes: 0 };
  }
}

// ── LibrarySpaceInfo ───────────────────────────────────────────────────────

export interface LibrarySpaceInfo {
  /** How many tracks are currently in the library (DB count). */
  trackCount: number;
  /** Library cap (passed in by caller — usually MAX_LIBRARY_SIZE = 1500). */
  maxLibrarySize: number;
  /** trackCount × AVG_TRACK_BYTES — purely an estimate. */
  estimatedUsedBytes: number;
  /** (maxLibrarySize − trackCount) × AVG_TRACK_BYTES. */
  estimatedRemainingBytes: number;
  /** Slots remaining in the library cap (clamped at 0). */
  remainingCapacity: number;
}

/**
 * Library-cap accounting.
 *
 * Pure DB-derived numbers — no file-system calls. This complements
 * `getStorageInfo()` (device free space) so the UI can show *both*
 * "library is X / 1500 full" and "device has Y GB free".
 */
export async function getLibrarySpaceInfo(
  maxLibrarySize: number,
): Promise<LibrarySpaceInfo> {
  let trackCount = 0;
  try {
    trackCount = await tracksCollection.query().fetchCount();
  } catch (err) {
    logger.error('[StorageEstimator] tracks fetchCount failed:', err);
  }

  const remainingCapacity = Math.max(0, maxLibrarySize - trackCount);
  return {
    trackCount,
    maxLibrarySize,
    estimatedUsedBytes: trackCount * AVG_TRACK_BYTES,
    estimatedRemainingBytes: remainingCapacity * AVG_TRACK_BYTES,
    remainingCapacity,
  };
}

// ── getRecommendedDownloadCount ────────────────────────────────────────────

export interface RecommendedDownloadInfo {
  /** Suggested count to default the stepper to. */
  recommended: number;
  /** Hard upper bound the stepper should refuse to exceed. */
  maxAllowed: number;
  /** Library-cap headroom (post-buffer). */
  remainingCapacity: number;
  /** How many tracks fit in `usableBytes`. */
  fitsByStorage: number;
  /** Free space after subtracting the safety buffer, in bytes. */
  usableBytes: number;
  /** Raw free bytes reported by the OS. */
  freeBytes: number;
  /** Total bytes on the device's primary storage. */
  totalBytes: number;
  /** Plain-English explanation, e.g. "32.4 GB free, 1342 slots remaining — recommending 12". */
  reason: string;
}

/**
 * Single source of truth for how many tracks the user should download today.
 *
 * Bounds the stepper to `[0, min(remainingCapacity, fitsByStorage, MAX_PER_SESSION)]`
 * and picks a sensible default that biases low when storage or library
 * headroom is tight.
 */
export async function getRecommendedDownloadCount(
  maxLibrarySize: number,
): Promise<RecommendedDownloadInfo> {
  const [{ remainingCapacity }, { totalBytes, freeBytes, usableBytes }] =
    await Promise.all([
      getLibrarySpaceInfo(maxLibrarySize),
      getStorageInfo(),
    ]);

  const fitsByStorage = Math.floor(usableBytes / AVG_TRACK_BYTES);
  const maxAllowed = Math.max(
    0,
    Math.min(remainingCapacity, fitsByStorage, MAX_PER_SESSION),
  );

  // Pick a default that biases low when constrained.
  let recommended: number;
  if (maxAllowed === 0) {
    recommended = 0;
  } else if (maxAllowed <= 5) {
    recommended = maxAllowed; // user is near a limit — just take what's left
  } else if (fitsByStorage < 20 || remainingCapacity < 50) {
    recommended = Math.min(5, maxAllowed); // tight — be conservative
  } else if (fitsByStorage < 100 || remainingCapacity < 200) {
    recommended = Math.min(10, maxAllowed); // moderate
  } else {
    recommended = Math.min(12, maxAllowed); // healthy — sweet spot
  }

  let reason: string;
  if (maxAllowed === 0) {
    if (remainingCapacity === 0) {
      reason = 'Library is full (1 500 song cap reached).';
    } else if (freeBytes < FREE_SPACE_BUFFER) {
      reason = `Only ${formatBytes(freeBytes)} free — free up space first.`;
    } else {
      reason = 'No room to download right now.';
    }
  } else {
    reason =
      `${formatBytes(freeBytes)} free, ${remainingCapacity.toLocaleString()} ` +
      `slot${remainingCapacity === 1 ? '' : 's'} remaining — recommending ${recommended}.`;
  }

  return {
    recommended,
    maxAllowed,
    remainingCapacity,
    fitsByStorage,
    usableBytes,
    freeBytes,
    totalBytes,
    reason,
  };
}
