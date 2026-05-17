/**
 * Tiny HTTP helper used by the multi-source resolver providers.
 *
 * Wraps `fetch` (the RN polyfill) with:
 *   - An AbortController so every request has a hard timeout.
 *   - A consistent `User-Agent` for public APIs to identify us cleanly.
 *   - Convenience JSON parsing with a typed return value.
 *
 * Why not RNBlobUtil.fetch here?
 *   RNBlobUtil is great for downloads (it writes directly to disk and exposes
 *   progress events), but it doesn't expose `AbortController`. The resolver
 *   needs per-request timeouts so a single hung public instance can't take
 *   down the chain. `fetch` is the right tool for the metadata/discovery hops.
 */
import { logger } from './logger';

const DEFAULT_TIMEOUT_MS = 8_000;
const USER_AGENT = 'Chakaas/1.0 (Personal Music App)';

export interface HttpJsonOptions {
  /** Hard timeout in ms. Defaults to 8s. */
  timeoutMs?: number;
  /** Additional headers merged on top of the default UA + Accept. */
  headers?: Record<string, string>;
  /** Externally-supplied signal (combined with the internal timeout signal). */
  signal?: AbortSignal;
}

export class HttpError extends Error {
  status: number;
  url: string;

  constructor(status: number, url: string, message?: string) {
    super(message ?? `HTTP ${status} ${url}`);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
  }
}

interface CombinedSignal {
  signal: AbortSignal;
  /** Detach every listener installed on the parent signals. */
  dispose(): void;
}

/**
 * Combines multiple AbortSignals into one. Returns both the combined signal
 * AND a `dispose` callback the caller MUST run when its operation completes,
 * so listeners on long-lived parent signals don't accumulate.
 */
function combineSignals(signals: Array<AbortSignal | undefined>): CombinedSignal {
  const controller = new AbortController();
  const cleanups: Array<() => void> = [];

  for (const sig of signals) {
    if (!sig) continue;
    if (sig.aborted) {
      controller.abort();
      break;
    }
    const onAbort = (): void => controller.abort();
    sig.addEventListener('abort', onAbort, { once: true });
    cleanups.push(() => sig.removeEventListener('abort', onAbort));
  }

  return {
    signal: controller.signal,
    dispose: () => {
      for (const c of cleanups) c();
    },
  };
}

/**
 * GETs a URL with a hard timeout and returns parsed JSON. Throws an
 * `HttpError` on non-2xx, a `TypeError`/`AbortError` on network failure.
 */
export async function httpGetJson<T>(
  url: string,
  options: HttpJsonOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
  const combined = combineSignals([timeoutController.signal, options.signal]);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json, text/plain, */*',
        ...(options.headers ?? {}),
      },
      signal: combined.signal,
    });

    if (!response.ok) {
      throw new HttpError(response.status, url);
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
    combined.dispose();
  }
}

/**
 * GETs a URL and returns the raw response text. Same timeout + UA defaults
 * as `httpGetJson`. Used by providers that need to scrape HTML.
 */
export async function httpGetText(
  url: string,
  options: HttpJsonOptions = {},
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
  const combined = combineSignals([timeoutController.signal, options.signal]);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/plain, text/html, */*',
        ...(options.headers ?? {}),
      },
      signal: combined.signal,
    });

    if (!response.ok) {
      throw new HttpError(response.status, url);
    }

    return await response.text();
  } finally {
    clearTimeout(timer);
    combined.dispose();
  }
}

/**
 * Convenience wrapper — race a promise against a hard timeout. Used by the
 * resolver to bound a *whole provider* (not just a single HTTP call) before
 * falling through to the next source.
 */
export function withDeadline<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    p.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** Logs and swallows — convenience for the resolver chain. */
export function logFailure(label: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  logger.warn(`[${label}] ${message}`);
}

export const RESOLVER_USER_AGENT = USER_AGENT;
