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
// Global error capture: any uncaught error / module-import crash gets stored
// here so we can render it on screen instead of showing a black screen.
// ─────────────────────────────────────────────────────────────────────────────
let bootError = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const RNTrackPlayer = require('react-native-track-player').default;
  const { PlaybackService } = require('./src/features/player/playerService');
  RNTrackPlayer.registerPlaybackService(() => PlaybackService);
} catch (e) {
  bootError = e;
}

let App;
try {
  App = require('./src/app/App').default;
} catch (e) {
  if (!bootError) bootError = e;
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
      { style: { color: '#999', fontSize: 13, marginTop: 8, marginBottom: 16 } },
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
          color: '#E0E0E0',
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
                color: '#E0E0E0',
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
