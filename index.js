// ─── Hermes polyfills (must run before any module that needs them) ──────────
// youtubei.js does `class Foo extends EventTarget` and uses CustomEvent;
// Hermes (RN 0.76) ships with broken/missing implementations. Force-install
// class-based versions on every global object reference RN exposes.
(function installEventTargetPolyfill() {
  class _Event {
    constructor(type, opts) {
      this.type = String(type);
      this.bubbles = !!(opts && opts.bubbles);
      this.cancelable = !!(opts && opts.cancelable);
      this.composed = !!(opts && opts.composed);
      this.defaultPrevented = false;
      this.target = null;
      this.currentTarget = null;
    }
    preventDefault() { this.defaultPrevented = true; }
    stopPropagation() {}
    stopImmediatePropagation() {}
  }
  class _CustomEvent extends _Event {
    constructor(type, opts) {
      super(type, opts);
      this.detail = opts && 'detail' in opts ? opts.detail : null;
    }
  }
  class _EventTarget {
    constructor() { this.__listeners = new Map(); }
    addEventListener(type, listener, options) {
      if (!listener) return;
      const t = String(type);
      if (!this.__listeners.has(t)) this.__listeners.set(t, new Map());
      this.__listeners.get(t).set(listener, options || {});
    }
    removeEventListener(type, listener) {
      const t = String(type);
      const m = this.__listeners.get(t);
      if (m) m.delete(listener);
    }
    dispatchEvent(event) {
      const m = this.__listeners.get(event.type);
      if (!m) return true;
      for (const [listener, options] of m) {
        try {
          if (typeof listener === 'function') listener.call(this, event);
          else if (listener && typeof listener.handleEvent === 'function') listener.handleEvent(event);
        } catch (err) {
          setTimeout(() => { throw err; });
        }
        if (options && options.once) m.delete(listener);
      }
      return !event.defaultPrevented;
    }
  }
  // Force-install on every global reference (don't trust typeof check —
  // Hermes may expose a half-broken EventTarget that fails class-extends).
  const targets = [];
  if (typeof globalThis !== 'undefined') targets.push(globalThis);
  if (typeof global !== 'undefined') targets.push(global);
  for (const g of targets) {
    g.Event = _Event;
    g.CustomEvent = _CustomEvent;
    g.EventTarget = _EventTarget;
  }
  console.log('[Chakaas] Polyfills installed. EventTarget:', typeof globalThis.EventTarget);
})();

import { AppRegistry, Text, View, ScrollView } from 'react-native';
import React from 'react';
// ─────────────────────────────────────────────────────────────────────────────
// Notifee foreground-service registration — MUST run at module top-level
// before any displayNotification({ android: { asForegroundService: true } })
// fires, otherwise Android refuses to display the notification and the
// download pipeline crashes. The task returns a Promise that never resolves,
// keeping the service alive until DownloadManager calls stopForegroundService.
// ─────────────────────────────────────────────────────────────────────────────
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const notifee = require('@notifee/react-native').default;
  notifee.registerForegroundService(() => {
    return new Promise(() => {
      /* Keep service alive — DownloadManager stops it explicitly via
         stopForegroundService(). Resolving here would tear it down too early. */
    });
  });
} catch (e) {
  // Non-fatal — downloads will fall back to normal notifications.
  // eslint-disable-next-line no-console
  console.warn('[Chakaas] notifee registerForegroundService failed:', e);
}

// ─────────────────────────────────────────────────────────────────────────────
// Global error capture: any uncaught error / module-import crash gets stored
// here so we can render it on screen instead of showing a black screen.
// ─────────────────────────────────────────────────────────────────────────────
// Lazily resolve crashSink — it's a TS module compiled by Metro, and we want
// boot to keep going even if its own require somehow fails.
function captureBootError(tag, e) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { crashSink } = require('./src/utils/crashSink');
    crashSink.captureError(e, tag);
    crashSink.flush();
  } catch (_ignored) {
    /* sink unavailable — bootError fallback below still renders the screen */
  }
}

let bootError = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const RNTrackPlayer = require('react-native-track-player').default;
  const { PlaybackService } = require('./src/features/player/playerService');
  RNTrackPlayer.registerPlaybackService(() => PlaybackService);
} catch (e) {
  bootError = e;
  captureBootError('boot.trackPlayer', e);
}

let App;
try {
  App = require('./src/app/App').default;
} catch (e) {
  if (!bootError) bootError = e;
  captureBootError('boot.app', e);
}

const ErrorScreen = ({ err }) =>
  React.createElement(
    ScrollView,
    {
      style: { flex: 1, backgroundColor: '#F5F5F7' },
      contentContainerStyle: { padding: 24, paddingTop: 64 },
    },
    React.createElement(
      Text,
      { style: { color: '#FA233B', fontSize: 22, fontWeight: '700' } },
      'Chakaas crashed on boot',
    ),
    React.createElement(
      Text,
      { style: { color: '#6E6E73', fontSize: 13, marginTop: 8, marginBottom: 16 } },
      'Send this screen to the dev.',
    ),
    React.createElement(
      Text,
      { style: { color: '#FA233B', fontSize: 14, fontWeight: '600', marginTop: 12 } },
      'Error',
    ),
    React.createElement(
      Text,
      {
        style: {
          color: '#3A3A3C',
          fontSize: 12,
          fontFamily: 'monospace',
          marginTop: 4,
        },
      },
      `${err?.name || 'Error'}: ${err?.message || String(err)}`,
    ),
    err?.stack
      ? React.createElement(
          React.Fragment,
          null,
          React.createElement(
            Text,
            {
              style: {
                color: '#FA233B',
                fontSize: 14,
                fontWeight: '600',
                marginTop: 16,
              },
            },
            'Stack',
          ),
          React.createElement(
            Text,
            {
              style: {
                color: '#3A3A3C',
                fontSize: 11,
                fontFamily: 'monospace',
                marginTop: 4,
                lineHeight: 16,
              },
            },
            err.stack,
          ),
        )
      : null,
  );

const RootComponent = () => {
  if (bootError) return React.createElement(ErrorScreen, { err: bootError });
  if (App) return React.createElement(App);
  return React.createElement(
    View,
    { style: { flex: 1, backgroundColor: '#F5F5F7' } },
    React.createElement(
      Text,
      { style: { color: '#FA233B', padding: 20 } },
      'Chakaas: App component not loaded.',
    ),
  );
};

AppRegistry.registerComponent('main', () => RootComponent);
