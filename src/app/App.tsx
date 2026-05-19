import React, { useEffect, useRef } from 'react';
import { StatusBar, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { DatabaseProvider } from './providers/DatabaseProvider';
import { TrackPlayerProvider } from '@/features/player/TrackPlayerProvider';
import { RootNavigator, linking } from './navigation/RootNavigator';
import { configureBackgroundFetch } from '@/features/backgroundSync/BackgroundFetchHandler';
import { DownloadManager } from '@/features/download/DownloadManager';
import {
  decayAllScores,
  clearLegacySeedBiasOnce,
} from '@/features/recommendations/artistAffinity';
import { startPlayTracker } from '@/features/recommendations/playTracker';
import {
  cleanupBadLocalArtists,
  backfillPlayCounts,
  cleanupVoiceNotesAndClips,
} from '@/db/cleanup';
import { navigationTheme } from './navigation/theme';
import { ErrorBoundary } from './ErrorBoundary';
import { GlobalSheets } from './GlobalSheets';
import { logger } from '@/utils/logger';
import { crashSink } from '@/utils/crashSink';

// ---------------------------------------------------------------------------
// QueryClient – singleton created outside the component tree so it is never
// recreated on re-render.
// ---------------------------------------------------------------------------
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 min – data is considered fresh
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});

// ---------------------------------------------------------------------------
// One-shot boot guards
// ---------------------------------------------------------------------------
// React StrictMode (and Fast Refresh in dev) deliberately mounts & unmounts
// useEffect twice. Most of the boot tasks below are already self-idempotent
// (MMKV flags, refs inside startPlayTracker, etc.), but a couple — notably
// `BackgroundFetch.configure` and the foreground/cleanup chain — are cheaper
// and safer if we simply hard-guard them with module-level flags so the
// double-mount in dev cannot produce duplicate registrations or duplicate
// log lines on a real cold start either.
let _bootHandlersInstalled = false;
let _backgroundFetchConfigured = false;

/**
 * Run the one-time boot side-effects exactly once per JS runtime, even under
 * React StrictMode's double-mount. Returns a teardown that the App effect
 * can call on unmount; the teardown is a no-op if boot didn't actually fire
 * on this invocation (i.e. some other mount won the race).
 */
function installBootHandlers(): () => void {
  if (_bootHandlersInstalled) {
    return () => {
      /* boot already owned by an earlier mount; nothing to tear down here */
    };
  }
  _bootHandlersInstalled = true;

  if (!_backgroundFetchConfigured) {
    _backgroundFetchConfigured = true;
    void configureBackgroundFetch();
  }

  // The engine learns purely from real plays — no taste seeding. The
  // one-time wipe below removes any bias from earlier builds that did
  // seed artist scores. Both calls are MMKV-flag-guarded internally.
  clearLegacySeedBiasOnce();
  decayAllScores();

  // Re-parse any legacy device-import rows that an earlier importer
  // version saved with artist="00" / "01" etc. All three cleanups are
  // self-detecting no-ops once the DB is already healthy.
  void cleanupBadLocalArtists();
  void cleanupVoiceNotesAndClips();
  void backfillPlayCounts();

  // Module-level subscription: returns the same teardown if called twice
  // (idempotent), so we don't need to re-guard it here.
  const stopPlayTracker = startPlayTracker();

  // Ref-counted internally — safe to call multiple times.
  const stopDownloadListener = DownloadManager.registerForegroundListener();

  return () => {
    try {
      stopPlayTracker();
    } catch (err) {
      logger.warn('[App] stopPlayTracker failed:', err);
    }
    try {
      stopDownloadListener();
    } catch (err) {
      logger.warn('[App] stopDownloadListener failed:', err);
    }
    _bootHandlersInstalled = false;
  };
}

// ---------------------------------------------------------------------------
// Root App component
// ---------------------------------------------------------------------------

/**
 * App is the entry point rendered by index.js.
 *
 * Provider order (outermost → innermost):
 *   ErrorBoundary           – top-level crash catcher with reload action
 *   GestureHandlerRootView  – must be the absolute root for RNGH
 *   DatabaseProvider        – WatermelonDB context; shows branded loader
 *                             while the SQLite adapter sets up
 *   QueryClientProvider     – TanStack Query cache (mounts after DB so
 *                             queries can hit the DB on first render)
 *   TrackPlayerProvider     – initialises react-native-track-player
 *   SafeAreaProvider        – safe-area insets context
 *   NavigationContainer     – React Navigation
 *     StatusBar             – kept inside NavigationContainer so the theme is
 *                             available but rendered before RootNavigator so
 *                             it applies on the very first frame
 *     RootNavigator         – all screens
 *     GlobalSheets          – app-wide bottom sheets
 */
export default function App() {
  // Catch any unhandled JS exceptions and Promise rejections that escape
  // individual try-catch blocks so they never silently take down the app.
  //
  // Stored in a ref so the StrictMode double-mount can't accidentally wrap
  // our own handler twice (which would happen if the cleanup of the first
  // mount captured the second mount's handler as "prev").
  type GlobalErrorHandler = (error: Error, isFatal?: boolean) => void;
  const prevHandlerRef = useRef<GlobalErrorHandler | null>(null);
  useEffect(() => {
    if (prevHandlerRef.current === null) {
      prevHandlerRef.current = ErrorUtils.getGlobalHandler() as GlobalErrorHandler;
    }
    const prev = prevHandlerRef.current;
    const ours: GlobalErrorHandler = (error, isFatal) => {
      // eslint-disable-next-line no-console
      console.error(`[Chakaas] Global error (fatal=${String(isFatal)}):`, error);
      // Persist before the JS context potentially dies.
      try {
        crashSink.captureError(error, isFatal ? 'global.fatal' : 'global');
        crashSink.flush();
      } catch {
        /* never let the sink kill the global handler */
      }
      // Let the existing handler run so Metro/Sentry still sees it.
      prev?.(error, isFatal);
    };
    ErrorUtils.setGlobalHandler(ours);

    // Promise rejection handler — RN exposes process.on for the Node-like
    // global; HermesInternal also surfaces enablePromiseRejectionTracker. We
    // try both, defensively.
    type RejectionListener = (reason: unknown, _promise?: Promise<unknown>) => void;
    const onUnhandledRejection: RejectionListener = (reason) => {
      try {
        crashSink.captureError(reason, 'unhandledRejection');
        crashSink.flush();
      } catch {
        /* swallow */
      }
    };
    let detachRejection: (() => void) | null = null;
    try {
      const proc = (global as unknown as { process?: { on?: Function; off?: Function; removeListener?: Function } }).process;
      if (proc && typeof proc.on === 'function') {
        proc.on('unhandledRejection', onUnhandledRejection);
        detachRejection = () => {
          try {
            if (typeof proc.off === 'function') proc.off!('unhandledRejection', onUnhandledRejection);
            else if (typeof proc.removeListener === 'function')
              proc.removeListener!('unhandledRejection', onUnhandledRejection);
          } catch {
            /* ignore */
          }
        };
      }
    } catch {
      /* no process global — skip */
    }

    return () => {
      // Only restore if WE are still the active handler. Avoids clobbering
      // a downstream lib that installed its own handler after us.
      if (ErrorUtils.getGlobalHandler() === ours && prev) {
        ErrorUtils.setGlobalHandler(prev);
      }
      detachRejection?.();
    };
  }, []);

  // Kick off background-fetch + recommendation cleanups + play tracker once
  // per runtime. The helper internally guards against StrictMode double-mounts.
  useEffect(() => {
    return installBootHandlers();
  }, []);

  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <DatabaseProvider>
          <QueryClientProvider client={queryClient}>
            <TrackPlayerProvider>
              <SafeAreaProvider>
                <NavigationContainer theme={navigationTheme} linking={linking}>
                  <StatusBar
                    barStyle="dark-content"
                    backgroundColor="#F5F5F7"
                    translucent={Platform.OS === 'android' ? false : undefined}
                  />
                  <RootNavigator />
                  <GlobalSheets />
                </NavigationContainer>
              </SafeAreaProvider>
            </TrackPlayerProvider>
          </QueryClientProvider>
        </DatabaseProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
