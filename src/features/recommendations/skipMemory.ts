/**
 * skipMemory — persistent "never recommend this again" set.
 *
 * Why this exists:
 *   The user repeatedly hit the same handful of songs in Discover, and once
 *   they skipped or dismissed one, it still kept reappearing on every
 *   refresh because the upstream Saavn ranking is deterministic and the
 *   candidate pool was small. This module records every track the user
 *   explicitly rejected (skip on play, × on the row) so discoverEngine can
 *   filter them out of every future feed.
 *
 * Keys we store (two parallel forms to maximise hits):
 *   1. `<source>:<id>`               — exact match for the same provider row.
 *   2. `fp:<title>|||<artist>`       — normalised fingerprint so the same
 *                                      song coming from a different Saavn
 *                                      mirror / alt id is also blocked.
 *
 * Persistence is in the general MMKV store as a JSON string array. Bounded
 * to MAX_ENTRIES with FIFO eviction so the file can't grow unbounded.
 */
import { AppState, type AppStateStatus } from 'react-native';
import { storage } from '@/services/storage/mmkv';

const STORAGE_KEY = 'discover_skip_memory_v1';
const MAX_ENTRIES = 5000;
/** Debounce window before flushing the in-memory cache to MMKV. */
const PERSIST_DEBOUNCE_MS = 1000;

let _cache: Set<string> | null = null;
let _persistTimer: ReturnType<typeof setTimeout> | null = null;
let _appStateSubscribed = false;

/**
 * Register an AppState listener that synchronously flushes any pending
 * debounced write when the app goes inactive/background. Without this, skips
 * recorded in the last second before the user kills the app are lost — the
 * setTimeout never fires because the JS thread is suspended.
 *
 * Registered lazily on first use so this module remains import-side-effect-
 * free in tests / SSR-like contexts.
 */
function ensureAppStateHook(): void {
  if (_appStateSubscribed) return;
  _appStateSubscribed = true;
  AppState.addEventListener('change', (state: AppStateStatus) => {
    if (state !== 'active' && _persistTimer !== null) {
      clearTimeout(_persistTimer);
      _persistTimer = null;
      persistNow();
    }
  });
}

function load(): Set<string> {
  if (_cache) return _cache;
  try {
    const raw = storage.getString(STORAGE_KEY);
    _cache = new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    _cache = new Set();
  }
  return _cache;
}

/** Synchronously write the current cache to MMKV (used by the debounce timer). */
function persistNow(): void {
  if (!_cache) return;
  // Bound size — drop oldest in place. Mutating `_cache` (instead of
  // reassigning the reference) keeps any caller that held the Set returned
  // from `getAllSkippedKeys()` consistent with the live state.
  if (_cache.size > MAX_ENTRIES) {
    const dropCount = _cache.size - MAX_ENTRIES;
    let i = 0;
    for (const key of _cache) {
      if (i >= dropCount) break;
      _cache.delete(key);
      i += 1;
    }
  }
  storage.set(STORAGE_KEY, JSON.stringify(Array.from(_cache)));
}

/**
 * Schedule an MMKV flush. Multiple synchronous `addToSkipMemory` calls in
 * a row coalesce into one write — useful when the user rapidly dismisses
 * several Discover suggestions in succession.
 *
 * Reads (`isSkipped`, `getAllSkippedKeys`) always see the current in-memory
 * state because we mutate `_cache` synchronously before scheduling persist.
 */
function persist(): void {
  if (!_cache) return;
  ensureAppStateHook();
  if (_persistTimer !== null) clearTimeout(_persistTimer);
  _persistTimer = setTimeout(() => {
    _persistTimer = null;
    persistNow();
  }, PERSIST_DEBOUNCE_MS);
}

/**
 * Lowercase, strip parenthetical/bracket annotations ("(From XYZ)", "[Remix]"),
 * collapse punctuation. Keeps Devanagari unicode block so Hindi titles still
 * fingerprint usefully.
 */
export function normalizeFingerprint(title: string, artist: string): string {
  const norm = (s: string): string =>
    s
      .toLowerCase()
      .replace(/\s*\((?:from|feat\.?|featuring|with|ft\.?)[^)]*\)\s*/gi, ' ')
      .replace(/\s*\[[^\]]*\]\s*/g, ' ')
      .replace(/[^a-z0-9ऀ-ॿ\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  return `${norm(title)}|||${norm(artist)}`;
}

export interface SkipMemoryEntry {
  /** Provider id (saavn song id, youtube video id). Optional — fp still applies. */
  id?: string | null;
  /** 'saavn' | 'youtube' | etc. */
  source?: string | null;
  title: string;
  artist: string;
}

export function addToSkipMemory(entry: SkipMemoryEntry): void {
  const set = load();
  if (entry.id && entry.source) {
    set.add(`${entry.source}:${entry.id}`);
  }
  set.add(`fp:${normalizeFingerprint(entry.title, entry.artist)}`);
  persist();
}

/**
 * Inverse of `addToSkipMemory`. Used by `playTracker` when the user actually
 * completes a track — if they changed their mind after an earlier skip, the
 * recommendation engine should be allowed to surface it again.
 */
export function removeFromSkipMemory(entry: SkipMemoryEntry): void {
  const set = load();
  let changed = false;
  if (entry.id && entry.source) {
    if (set.delete(`${entry.source}:${entry.id}`)) changed = true;
  }
  if (set.delete(`fp:${normalizeFingerprint(entry.title, entry.artist)}`))
    changed = true;
  if (changed) persist();
}

export function isSkipped(entry: SkipMemoryEntry): boolean {
  const set = load();
  if (entry.id && entry.source && set.has(`${entry.source}:${entry.id}`)) return true;
  if (set.has(`fp:${normalizeFingerprint(entry.title, entry.artist)}`)) return true;
  return false;
}

/** Returns a snapshot of every stored skip key. Cheap — a single Set clone. */
export function getAllSkippedKeys(): Set<string> {
  return new Set(load());
}

export function clearSkipMemory(): void {
  // Drop any pending debounced write so it can't resurrect the old contents
  // after we wipe the cache.
  if (_persistTimer !== null) {
    clearTimeout(_persistTimer);
    _persistTimer = null;
  }
  // Clear in place to preserve any reference returned by `getAllSkippedKeys()`
  // — those callers should observe the wipe rather than hold a stale set.
  if (_cache) _cache.clear();
  else _cache = new Set();
  storage.delete(STORAGE_KEY);
}

export function getSkipMemorySize(): number {
  return load().size;
}
