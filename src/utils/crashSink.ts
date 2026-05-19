/**
 * crashSink
 * ─────────
 * MMKV-backed rolling buffer that captures `error` and `warn` events from the
 * logger plus uncaught JS exceptions and promise rejections, so we can review
 * what blew up after the fact when `adb logcat` isn't available.
 *
 * Design notes:
 *   • Uses its OWN MMKV instance (`chakaas-crash-sink`) so a corrupt buffer
 *     can never bring down general app storage.
 *   • Holds an in-memory buffer of up to 100 entries (newest last) and flushes
 *     to MMKV with a 500ms trailing debounce. AppState 'background' forces
 *     a synchronous flush so an OS-kill or crash on resume doesn't lose data.
 *   • Every public method is wrapped in try/catch — the sink must never throw
 *     into the logger (which would loop), and must never block the JS thread
 *     for more than a few ms.
 */

import { MMKV } from 'react-native-mmkv';
import { AppState, type AppStateStatus } from 'react-native';

export type LogLevel = 'error' | 'warn';

export interface LogEntry {
  ts: number;
  level: LogLevel;
  tag: string;
  message: string;
  stack?: string;
}

const STORAGE_KEY = 'entries.v1';
const MAX_ENTRIES = 100;
const DEBOUNCE_MS = 500;

// Lazily-initialised so a broken MMKV native module can't crash module load.
let _store: MMKV | null = null;
function getStore(): MMKV | null {
  if (_store) return _store;
  try {
    _store = new MMKV({ id: 'chakaas-crash-sink' });
    return _store;
  } catch {
    return null;
  }
}

// In-memory buffer is the source of truth; MMKV is just the persistence layer.
let buffer: LogEntry[] = loadFromStorage();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function loadFromStorage(): LogEntry[] {
  const store = getStore();
  if (!store) return [];
  try {
    const raw = store.getString(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is LogEntry =>
        e &&
        typeof e.ts === 'number' &&
        (e.level === 'error' || e.level === 'warn') &&
        typeof e.tag === 'string' &&
        typeof e.message === 'string',
    );
  } catch {
    return [];
  }
}

function flushNow(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  const store = getStore();
  if (!store) return;
  try {
    store.set(STORAGE_KEY, JSON.stringify(buffer));
  } catch {
    /* MMKV write failed — nothing we can do without recursing into logger. */
  }
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushNow();
  }, DEBOUNCE_MS);
}

function push(entry: LogEntry): void {
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) {
    buffer.splice(0, buffer.length - MAX_ENTRIES);
  }
  scheduleFlush();
}

function stringifyArg(v: unknown): string {
  if (v == null) return String(v);
  if (typeof v === 'string') return v;
  if (v instanceof Error) return v.message;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function extractMessage(input: unknown): { message: string; stack?: string } {
  if (input instanceof Error) {
    return { message: input.message || input.name || 'Error', stack: input.stack };
  }
  if (typeof input === 'string') return { message: input };
  if (Array.isArray(input)) {
    return { message: input.map(stringifyArg).join(' ') };
  }
  return { message: stringifyArg(input) };
}

// ── Public API ──────────────────────────────────────────────────────────────

export const crashSink = {
  captureError(err: unknown, tag: string = 'app'): void {
    try {
      const { message, stack } = extractMessage(err);
      push({ ts: Date.now(), level: 'error', tag, message, stack });
    } catch {
      /* swallow — never throw from the sink */
    }
  },

  captureWarn(msg: unknown, tag: string = 'app'): void {
    try {
      const { message, stack } = extractMessage(msg);
      push({ ts: Date.now(), level: 'warn', tag, message, stack });
    } catch {
      /* swallow */
    }
  },

  getEntries(): LogEntry[] {
    // Defensive copy — callers must not mutate our internal buffer.
    return buffer.slice();
  },

  clear(): void {
    buffer = [];
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    const store = getStore();
    if (store) {
      try {
        store.delete(STORAGE_KEY);
      } catch {
        /* ignore */
      }
    }
  },

  /**
   * Synchronous flush — call from a place where we suspect the JS context is
   * about to die (background, crash handler).
   */
  flush(): void {
    flushNow();
  },

  /**
   * Newest-first plain-text dump. Designed for the user to long-press / copy
   * out of a Text view and paste back to the dev.
   */
  exportAsText(): string {
    const entries = buffer.slice().reverse();
    if (entries.length === 0) return '(no entries)';
    const lines: string[] = [];
    lines.push(`# Chakaas crash sink — ${entries.length} entries`);
    lines.push(`# Exported ${new Date().toISOString()}`);
    lines.push('');
    for (const e of entries) {
      const when = new Date(e.ts).toISOString();
      lines.push(`[${when}] ${e.level.toUpperCase()} (${e.tag}) ${e.message}`);
      if (e.stack) {
        lines.push(e.stack);
      }
      lines.push('');
    }
    return lines.join('\n');
  },
};

// ── AppState wiring ─────────────────────────────────────────────────────────
// Force a synchronous flush whenever the app backgrounds so we don't lose the
// last few entries if the OS kills us before the debounce fires.
let _appStateInstalled = false;
function installAppStateFlush(): void {
  if (_appStateInstalled) return;
  _appStateInstalled = true;
  try {
    AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'background' || next === 'inactive') {
        flushNow();
      }
    });
  } catch {
    /* AppState unavailable (e.g. test env) — debounced flushes still run. */
  }
}
installAppStateFlush();
