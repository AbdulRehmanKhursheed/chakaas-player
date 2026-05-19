/**
 * Lightweight logger for the Chakaas Player app.
 *
 * `log`, `warn`, and `info` are no-ops in production builds.
 * `error` always logs, even in production, so critical failures are never silenced.
 *
 * In addition, `error` and `warn` route through `crashSink` so the entries
 * survive app reloads and can be exported later when adb logcat isn't
 * available. The sink is required lazily inside each call so a fault in the
 * sink module can never break the logger itself.
 */

// React Native sets __DEV__ to `true` when running in development mode.
// eslint-disable-next-line no-undef
const isDev = __DEV__;

function captureToSink(level: 'error' | 'warn', args: unknown[]): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { crashSink } = require('./crashSink');
    // First arg is typically a tag like "[Foo]"; pull it out if present so the
    // dump is easier to scan. Fall back to "logger".
    let tag = 'logger';
    const firstArg = args[0];
    if (typeof firstArg === 'string') {
      const tagMatch = firstArg.match(/^\[([^\]]+)\]/);
      if (tagMatch) tag = tagMatch[1];
    }
    if (level === 'error') {
      // If the very first arg is an Error, capture that directly so its stack
      // is preserved verbatim. Otherwise pass the whole arg array.
      const errArg = args.find((a) => a instanceof Error);
      crashSink.captureError(errArg ?? args, tag);
    } else {
      crashSink.captureWarn(args, tag);
    }
  } catch {
    /* sink unavailable — logger continues unaffected */
  }
}

export const logger = {
  /** General-purpose log. Silenced in production. */
  log: (...args: unknown[]): void => {
    if (isDev) console.log('[Chakaas]', ...args);
  },

  /** Warning log. Silenced in production console, but always captured to the crash sink. */
  warn: (...args: unknown[]): void => {
    if (isDev) console.warn('[Chakaas]', ...args);
    captureToSink('warn', args);
  },

  /** Error log. Always active, including production, and captured to the crash sink. */
  error: (...args: unknown[]): void => {
    console.error('[Chakaas]', ...args);
    captureToSink('error', args);
  },

  /** Info log. Silenced in production. */
  info: (...args: unknown[]): void => {
    if (isDev) console.info('[Chakaas]', ...args);
  },
};
