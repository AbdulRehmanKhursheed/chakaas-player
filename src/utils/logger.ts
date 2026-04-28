/**
 * Lightweight logger for the Chakaas Player app.
 *
 * `log`, `warn`, and `info` are no-ops in production builds.
 * `error` always logs, even in production, so critical failures are never silenced.
 */

// React Native sets __DEV__ to `true` when running in development mode.
// eslint-disable-next-line no-undef
const isDev = __DEV__;

export const logger = {
  /** General-purpose log. Silenced in production. */
  log: (...args: unknown[]): void => {
    if (isDev) console.log('[Chakaas]', ...args);
  },

  /** Warning log. Silenced in production. */
  warn: (...args: unknown[]): void => {
    if (isDev) console.warn('[Chakaas]', ...args);
  },

  /** Error log. Always active, including production. */
  error: (...args: unknown[]): void => {
    console.error('[Chakaas]', ...args);
  },

  /** Info log. Silenced in production. */
  info: (...args: unknown[]): void => {
    if (isDev) console.info('[Chakaas]', ...args);
  },
};
