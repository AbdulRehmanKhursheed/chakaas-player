/**
 * Audio / time formatting and normalisation utilities.
 */

// ---------------------------------------------------------------------------
// Duration formatting
// ---------------------------------------------------------------------------

/**
 * Formats a duration given in milliseconds as a human-readable time string.
 *
 * Examples:
 *   225_000  → "3:45"
 *   3_802_000 → "1:03:22"
 *   59_000   → "0:59"
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const paddedSeconds = String(seconds).padStart(2, '0');

  if (hours > 0) {
    const paddedMinutes = String(minutes).padStart(2, '0');
    return `${hours}:${paddedMinutes}:${paddedSeconds}`;
  }

  return `${minutes}:${paddedSeconds}`;
}

/**
 * Formats a duration given in milliseconds as a short human-readable string.
 *
 * Examples:
 *   225_000  → "3m 45s"
 *   3_802_000 → "1h 3m 22s"
 *   45_000   → "45s"
 */
export function formatDurationShort(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);

  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Unit conversion
// ---------------------------------------------------------------------------

/** Converts milliseconds to seconds. */
export function msToSeconds(ms: number): number {
  return ms / 1000;
}

/** Converts seconds to milliseconds. */
export function secondsToMs(s: number): number {
  return s * 1000;
}

// ---------------------------------------------------------------------------
// File-system helpers
// ---------------------------------------------------------------------------

/**
 * Sanitises a string so it is safe to use as a file name on common file
 * systems (Android/Linux, Windows).
 *
 * - Strips characters illegal on FAT32/NTFS/ext4: `/ \ : * ? " < > |`
 * - Collapses consecutive whitespace to a single space
 * - Collapses consecutive dots to a single dot
 * - Trims leading/trailing whitespace and dots
 * - Truncates to 200 characters to stay well within path-length limits
 */
export function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\:*?"<>|]/g, '')   // strip illegal chars
    .replace(/\.{2,}/g, '.')         // collapse consecutive dots
    .replace(/\s+/g, ' ')            // collapse whitespace
    .trim()
    .replace(/^\.+|\.+$/g, '')       // trim leading/trailing dots
    .slice(0, 200)
    || 'Unknown';                    // guard against empty result
}

// ---------------------------------------------------------------------------
// Feature normalisation
// ---------------------------------------------------------------------------

/**
 * Normalises a BPM value to the range [0, 1] using a linear mapping from
 * 60 BPM (→ 0) to 200 BPM (→ 1). Values outside this range are clamped.
 *
 * The 60–200 BPM window covers the vast majority of popular music.
 */
export function normalizeTempo(bpm: number): number {
  const MIN_BPM = 60;
  const MAX_BPM = 200;
  return Math.max(0, Math.min(1, (bpm - MIN_BPM) / (MAX_BPM - MIN_BPM)));
}
