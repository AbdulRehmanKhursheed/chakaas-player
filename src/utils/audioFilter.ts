/**
 * audioFilter — single source of truth for "is this audio asset something the
 * user actually wants in their music library?".
 *
 * Used by THREE independent layers so a single slip can't show WhatsApp
 * voice notes (or any other non-music asset) in the UI:
 *
 *   1. Import filter  — `src/features/localAudio/LocalAudioImporter.ts`
 *      blocks junk BEFORE it ever reaches the WatermelonDB `tracks` table.
 *
 *   2. Retroactive DB cleanup — `src/db/cleanup.ts`
 *      runs on every cold start AND on Settings → Clean Library. Scans every
 *      row (regardless of `source`) and purges anything that matches.
 *
 *   3. UI render filter — `src/screens/library/LibraryScreen.tsx`
 *      filters the WatermelonDB observable result in a `useMemo` BEFORE
 *      anything is handed to FlashList. Even if a junk row somehow survives
 *      layers 1 and 2, the user never sees it.
 *
 * Every layer feeds candidates through `isNonMusicTrack`. The function
 * returns `{ blocked, reason }` — the reason string is logged so the user
 * can read the Metro terminal and confirm filtering is actually running.
 *
 * Notes on robustness:
 *
 *   - Substring matching is case-insensitive and runs over a SINGLE
 *     "combined" string built from every field we have. This is how the
 *     WhatsApp path keyword catches `content://media/external/audio/media/...
 *     /WhatsApp/Media/WhatsApp Voice Notes/PTT-...-WA0001.opus` even when
 *     MediaLibrary surfaces the URI in different shapes on different OS
 *     versions.
 *
 *   - Filename regexes are run only over `filename`/`name` so they don't
 *     false-positive on benign substrings inside album names or paths.
 *
 *   - App-downloaded music (`source === 'saavn'` or `'youtube'`) should be
 *     filtered OUT of these checks at the call site. This module deliberately
 *     does NOT short-circuit on source — that's the caller's responsibility,
 *     so this filter remains pure / deterministic / testable.
 */

// React Native sets __DEV__ at build time.
// eslint-disable-next-line no-undef
declare const __DEV__: boolean;

export interface AudioCandidate {
  /** Disk path or content:// URI (e.g. `info.localUri` or `asset.uri`). */
  path?: string | null;
  /** Asset URI from MediaLibrary, when distinct from `path`. */
  uri?: string | null;
  /** Filename from MediaLibrary asset (`asset.filename`). */
  filename?: string | null;
  /** Alternate filename field — some asset shapes use `name`. */
  name?: string | null;
  /** Parsed track title (used by DB-row callers). */
  title?: string | null;
  /** Parsed artist (used by DB-row callers). */
  artist?: string | null;
  /** Album (used by DB-row callers). */
  album?: string | null;
  /** MediaStore `relative_path` if exposed. */
  relativePath?: string | null;
  /** MediaStore `bucket_display_name` if exposed. */
  bucketDisplayName?: string | null;
  /** Duration in MILLISECONDS. NOT seconds. */
  durationMs?: number;
}

/**
 * WhatsApp identifiers. Substring-matched over the combined-field string —
 * catches both legacy `/sdcard/WhatsApp/...` paths and the scoped-storage
 * `content://...WhatsApp...` form, plus the package id.
 */
const WHATSAPP_KEYWORDS: string[] = [
  'whatsapp',
  'com.whatsapp',
  'wa business',
  'whatsapp business',
  'whatsapp voice notes',
  'whatsapp audio',
  'whatsapp/media',
  'wa audio',
  '/wa/',
  'voice notes',
];

/** Other messaging-app folder/package identifiers. */
const MESSAGING_KEYWORDS: string[] = [
  'telegram',
  'org.telegram',
  'signal',
  'org.thoughtcrime.securesms',
  'threema',
  'ch.threema',
  'viber',
  '/viber/',
  'messenger',
  'com.facebook.orca',
];

/** Folders that are definitionally non-music. */
const VOICE_FOLDER_KEYWORDS: string[] = [
  '/voice notes/',
  '/voice memos/',
  '/voicerecorder/',
  '/recordings/',
  '/recorder/',
  '/call recordings/',
  '/sound recordings/',
  '/ringtones/',
  '/notifications/',
  '/alarms/',
  '/ui/',
  '/media/audio/notifications/',
];

/**
 * WhatsApp tags every file it produces with `WA<digits>` —
 * `PTT-20250505-WA0001.opus`, `AUD-20240101-WA0002.mp3`, etc.
 * The digit run is open-ended: heavy users blow past 9999 messages, so the
 * regex must accept `WA10000`/`WA12345`/... too. 100% specific in practice
 * because the literal `WA` prefix preceded by a word boundary is a unique
 * WhatsApp signature.
 */
const WHATSAPP_FILENAME_RE = /\bwa\s*\d{3,}\b/i;

/** Telegram doc-share pattern: `audio_2024-05-17_10-30-42.opus`. */
const TELEGRAM_FILENAME_RE = /^(audio|voice|video)[-_]\d{4}-\d{2}-\d{2}/i;

/** Generic voice/memo filename heuristics. */
const VOICE_FILENAME_RE =
  /(^|[^a-z0-9])(ptt|aud|vn|voice|rec(?:ording)?|note|memo|call|audio[-_]?\d+)([-_ ]|\d)/i;

/** Files named like UUIDs are virtually always non-music exports. */
const UUID_FILENAME_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Voice-only / messaging-only audio container extensions. */
const VOICE_EXTENSIONS: string[] = ['.opus', '.amr', '.3gp', '.3ga', '.awb', '.gsm'];

/** Append a candidate field to a haystack accumulator if it's a non-empty string. */
function appendField(acc: string, v: string | null | undefined): string {
  if (typeof v !== 'string' || v.length === 0) return acc;
  return acc.length === 0 ? v : `${acc} ${v}`;
}

/** Combine every field we have into one lowercase substring-searchable blob. */
function combinedHaystack(c: AudioCandidate): string {
  let acc = '';
  acc = appendField(acc, c.path);
  acc = appendField(acc, c.uri);
  acc = appendField(acc, c.filename);
  acc = appendField(acc, c.name);
  acc = appendField(acc, c.title);
  acc = appendField(acc, c.artist);
  acc = appendField(acc, c.album);
  acc = appendField(acc, c.relativePath);
  acc = appendField(acc, c.bucketDisplayName);
  return acc.toLowerCase();
}

/** Combine only the *location* fields — keeps title-mention false positives away. */
function locationHaystack(c: AudioCandidate): string {
  let acc = '';
  acc = appendField(acc, c.path);
  acc = appendField(acc, c.uri);
  acc = appendField(acc, c.filename);
  acc = appendField(acc, c.relativePath);
  acc = appendField(acc, c.bucketDisplayName);
  return acc.toLowerCase();
}

/** Substring check across a keyword list. Hot-path inner loop — keep tight. */
function anyKeyword(hay: string, keywords: readonly string[]): boolean {
  for (let i = 0; i < keywords.length; i++) {
    if (hay.includes(keywords[i])) return true;
  }
  return false;
}

export function isWhatsAppAudio(c: AudioCandidate): boolean {
  return anyKeyword(combinedHaystack(c), WHATSAPP_KEYWORDS);
}

export function isMessagingAudio(c: AudioCandidate): boolean {
  return anyKeyword(locationHaystack(c), MESSAGING_KEYWORDS);
}

export function isVoiceFolderAudio(c: AudioCandidate): boolean {
  return anyKeyword(locationHaystack(c), VOICE_FOLDER_KEYWORDS);
}

/**
 * Main entry. Returns `{ blocked, reason }`. `reason` is a short stable code
 * suitable for log lines (e.g. `'whatsapp'`, `'wa-filename'`, `'ext-.opus'`).
 *
 * Order of checks matters — most specific signals first, so the reason is
 * informative.
 */
export function isNonMusicTrack(c: AudioCandidate): {
  blocked: boolean;
  reason: string;
} {
  // 1. Path/URI/bucket keyword checks. Build each haystack once; the three
  //    public predicates above rebuild on-demand, but the orchestrator is on
  //    the hot path (library import + LibraryScreen render filter) so we
  //    inline the work to avoid recomputing locationHaystack twice.
  const combined = combinedHaystack(c);
  if (anyKeyword(combined, WHATSAPP_KEYWORDS)) return logged(c, true, 'whatsapp');
  const location = locationHaystack(c);
  if (anyKeyword(location, MESSAGING_KEYWORDS)) return logged(c, true, 'messaging-app');
  if (anyKeyword(location, VOICE_FOLDER_KEYWORDS)) return logged(c, true, 'voice-folder');

  // 2. Filename regex checks (only over filename/name to avoid title-substring
  //    false positives).
  const filename = ((c.filename || c.name || '') as string).toLowerCase();
  if (filename) {
    if (WHATSAPP_FILENAME_RE.test(filename)) return logged(c, true, 'wa-filename');
    if (TELEGRAM_FILENAME_RE.test(filename))
      return logged(c, true, 'telegram-filename');
    if (VOICE_FILENAME_RE.test(filename)) return logged(c, true, 'voice-filename');
    if (UUID_FILENAME_RE.test(filename)) return logged(c, true, 'uuid-filename');
    for (const ext of VOICE_EXTENSIONS) {
      if (filename.endsWith(ext)) return logged(c, true, `ext-${ext}`);
    }
  }

  // 3. DB-row signals (title / artist / duration). Only run when we actually
  //    have a title — pure-import callers pass title='' and we want to skip
  //    these checks for them.
  const title = ((c.title ?? '') as string).trim();
  if (title) {
    if (UUID_FILENAME_RE.test(title.toLowerCase()))
      return logged(c, true, 'uuid-title');
    if (title.length < 2) return logged(c, true, 'empty-title');
  } else if (c.title !== undefined && c.title !== null) {
    // Caller explicitly passed an empty title — that's a strong purge signal
    // for DB-row callers.
    return logged(c, true, 'empty-title');
  }

  const dur = c.durationMs ?? 0;
  if (dur > 0 && dur < 30_000) return logged(c, true, 'duration-lt-30s');

  // 4. Unknown artist + short duration heuristic (DB-row callers only).
  if (c.artist !== undefined && c.artist !== null) {
    const artistRaw = (c.artist as string).trim();
    const unknownArtist =
      !artistRaw ||
      artistRaw === 'Unknown Artist' ||
      /^(unknown|untitled|<unknown>|—|-)$/i.test(artistRaw);
    if (unknownArtist && dur > 0 && dur < 90_000)
      return logged(c, true, 'unknown-artist-short');
  }

  return logged(c, false, '');
}

/**
 * Verbose decision-logging gate. Off by default — flip the env var to see
 * every candidate the filter evaluates:
 *
 *   EXPO_AUDIO_FILTER_DEBUG=1 npx expo start
 *
 * `__DEV__` guard makes this a zero-cost no-op in release builds.
 */
function logged(
  candidate: AudioCandidate,
  blocked: boolean,
  reason: string,
): { blocked: boolean; reason: string } {
  if (__DEV__ && process.env.EXPO_AUDIO_FILTER_DEBUG) {
    // eslint-disable-next-line no-console
    console.log(
      '[AudioFilter] check:',
      JSON.stringify({
        filename: candidate.filename ?? candidate.name ?? null,
        title: candidate.title ?? null,
        artist: candidate.artist ?? null,
        durationMs: candidate.durationMs ?? 0,
        path: candidate.path ?? candidate.uri ?? null,
      }),
      '→',
      blocked ? `BLOCKED(${reason})` : 'ALLOWED',
    );
  }
  return { blocked, reason };
}
