/**
 * onlineResultFilter — online-search analogue of `src/utils/audioFilter.ts`.
 *
 * The local `audioFilter` strips non-music device files (WhatsApp voice notes,
 * ringtones) before they reach the library. This module does the equivalent
 * job for *online* search rows (Saavn / YouTube), where the junk is different:
 * karaoke versions, covers, instrumentals, lyric videos, "slowed + reverb"
 * edits, 8D mixes, nightcore, and 1-hour loops drown out the real song.
 *
 * Two public helpers, mirroring the local filter's `{ blocked, reason }` shape:
 *
 *   - `isLowQualityOnlineResult(row, query)` → hard drop. Returns true only for
 *     rows we never want surfaced (junk keyword in title that the QUERY didn't
 *     ask for, or an obviously-non-song duration like a 1h+ loop).
 *
 *   - `scoreOnlineResult(row, query)` → soft signal in [0, 1]. Combines a
 *     token-set match against the query with a duration-shape preference
 *     (~90s–7min) and small junk penalties. `searchMusic` adds this on top of
 *     its own relevance score so a borderline cover sinks below the real song
 *     instead of being dropped outright.
 *
 * Both are pure / deterministic / dependency-free so the ranking pipeline in
 * `searchMusic` stays testable.
 */
import type { YouTubeSearchResult } from '@/types/track';

// ── Junk-keyword vocabulary ──────────────────────────────────────────────────

/**
 * Title tokens that mark a result as a non-canonical edit. Each entry carries
 * the keyword(s) that, if present in the user's QUERY, mean the user actually
 * wants that variant — so we neither drop nor penalise it.
 */
interface JunkRule {
  /** Regex matched against the normalised (lowercased) title. */
  re: RegExp;
  /** Substrings that, if present in the query, exempt this rule. */
  queryAllow: string[];
  /** When true a match is a hard drop; otherwise it's only a score penalty. */
  hardDrop: boolean;
}

const JUNK_RULES: JunkRule[] = [
  { re: /\bkaraoke\b/, queryAllow: ['karaoke'], hardDrop: true },
  { re: /\binstrumental\b/, queryAllow: ['instrumental'], hardDrop: false },
  { re: /\b(cover|covered)\b/, queryAllow: ['cover'], hardDrop: false },
  { re: /\blyrics?\b|\blyric video\b/, queryAllow: ['lyric', 'lyrics'], hardDrop: false },
  { re: /\bslowed\b/, queryAllow: ['slowed'], hardDrop: false },
  { re: /\breverb\b/, queryAllow: ['reverb'], hardDrop: false },
  { re: /\b8d\b/, queryAllow: ['8d'], hardDrop: false },
  { re: /\bnightcore\b/, queryAllow: ['nightcore'], hardDrop: true },
  { re: /\bsped up\b|\bspeed up\b/, queryAllow: ['sped', 'speed'], hardDrop: false },
  { re: /\bremix\b/, queryAllow: ['remix'], hardDrop: false },
  { re: /\bmashup\b/, queryAllow: ['mashup'], hardDrop: false },
  // Long-form loops / compilations — "1 hour", "10 hours", "loop", "non stop".
  { re: /\b\d+\s*hours?\b|\b1\s*hr\b|\bloop\b|\bnon[-\s]?stop\b/, queryAllow: ['hour', 'loop', 'nonstop', 'non stop'], hardDrop: true },
];

// ── Duration shape ─────────────────────────────────────────────────────────

/** Preferred song-length window. Outside this we only soft-penalise. */
const DURATION_IDEAL_MIN_MS = 90_000; // 1:30
const DURATION_IDEAL_MAX_MS = 7 * 60_000; // 7:00
/** Anything past this is almost certainly a loop / mix / DJ set — hard drop. */
const DURATION_HARD_MAX_MS = 20 * 60_000; // 20:00

function normalizeTitle(s: string): string {
  return (s || '').toLowerCase();
}

function queryAllows(lowerQuery: string, allow: string[]): boolean {
  for (const token of allow) {
    if (lowerQuery.includes(token)) return true;
  }
  return false;
}

/**
 * Hard-drop predicate. Returns true when the row is junk the user did NOT ask
 * for, or when its duration is clearly not a single song.
 */
export function isLowQualityOnlineResult(
  row: YouTubeSearchResult,
  query: string,
): boolean {
  const title = normalizeTitle(row.title);
  if (!title) return true;

  const lowerQuery = (query || '').toLowerCase();

  for (const rule of JUNK_RULES) {
    if (!rule.hardDrop) continue;
    if (rule.re.test(title) && !queryAllows(lowerQuery, rule.queryAllow)) {
      return true;
    }
  }

  const dur = row.duration_ms ?? 0;
  // 0 = unknown (common for Saavn rows we still want); only drop on a known,
  // clearly-too-long duration.
  if (dur > 0 && dur > DURATION_HARD_MAX_MS) return true;

  return false;
}

/**
 * Soft quality score in [0, 1] combining query token-set overlap, duration
 * shape, and small junk penalties. Higher is better. Callers fold this into
 * their own relevance ranking.
 */
export function scoreOnlineResult(
  row: YouTubeSearchResult,
  query: string,
): number {
  const title = normalizeTitle(row.title);
  const lowerQuery = (query || '').toLowerCase();

  let score = tokenSetRatio(lowerQuery, `${title} ${(row.author || '').toLowerCase()}`);

  // Duration shape: full credit inside the ideal window, taper outside it.
  const dur = row.duration_ms ?? 0;
  if (dur > 0) {
    if (dur >= DURATION_IDEAL_MIN_MS && dur <= DURATION_IDEAL_MAX_MS) {
      score += 0.1;
    } else if (dur < DURATION_IDEAL_MIN_MS) {
      score -= 0.15; // very short clip — likely a snippet / interlude
    } else {
      score -= 0.1; // long — extended / live cut
    }
  }

  // Soft junk penalties for variants the query didn't request.
  for (const rule of JUNK_RULES) {
    if (rule.hardDrop) continue;
    if (rule.re.test(title) && !queryAllows(lowerQuery, rule.queryAllow)) {
      score -= 0.2;
    }
  }

  if (score < 0) return 0;
  if (score > 1) return 1;
  return score;
}

// ── Token-set ratio ─────────────────────────────────────────────────────────

const STOPWORDS = new Set(['the', 'a', 'an', 'of', 'and', 'from', 'feat', 'ft', 'with']);

function tokenize(s: string): Set<string> {
  const out = new Set<string>();
  for (const tok of s.split(/[^a-z0-9ऀ-ॿ]+/i)) {
    const t = tok.trim();
    if (!t || STOPWORDS.has(t)) continue;
    out.add(t);
  }
  return out;
}

/**
 * Token-set ratio: |query ∩ candidate| / |query|. Range [0, 1]. Measures how
 * many of the query's meaningful tokens appear in the candidate, independent
 * of word order — exactly the right shape for "did this row match what the
 * user typed?".
 */
export function tokenSetRatio(query: string, candidate: string): number {
  const q = tokenize(query);
  if (q.size === 0) return 0;
  const c = tokenize(candidate);
  let hits = 0;
  for (const tok of q) {
    if (c.has(tok)) hits += 1;
  }
  return hits / q.size;
}
