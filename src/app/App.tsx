import React, { useEffect } from 'react';
import { StatusBar } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { DatabaseProvider } from './providers/DatabaseProvider';
import { TrackPlayerProvider } from '@/features/player/TrackPlayerProvider';
import { RootNavigator } from './navigation/RootNavigator';
import { configureBackgroundFetch } from '@/features/backgroundSync/BackgroundFetchHandler';
import { DownloadManager } from '@/features/download/DownloadManager';
import { navigationTheme } from './navigation/theme';
import { ErrorBoundary } from './ErrorBoundary';
import { GlobalSheets } from './GlobalSheets';

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
// Root App component
// ---------------------------------------------------------------------------

/**
 * App is the entry point rendered by index.js.
 *
 * Provider order (outermost → innermost):
 *   GestureHandlerRootView  – must be the absolute root for RNGH
 *   DatabaseProvider        – WatermelonDB context
 *   QueryClientProvider     – TanStack Query cache
 *   TrackPlayerProvider     – initialises react-native-track-player
 *   SafeAreaProvider        – safe-area insets context
 *   NavigationContainer     – React Navigation
 *     StatusBar             – kept inside NavigationContainer so the theme is
 *                             available but rendered before RootNavigator so
 *                             it applies on the very first frame
 *     RootNavigator         – all screens
 */
export default function App() {
  // Kick off react-native-background-fetch registration once on mount.
  useEffect(() => {
    configureBackgroundFetch();
    // Register foreground notification event handler for download controls
    return DownloadManager.registerForegroundListener();
  }, []);

  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <DatabaseProvider>
          <QueryClientProvider client={queryClient}>
            <TrackPlayerProvider>
              <SafeAreaProvider>
                <NavigationContainer theme={navigationTheme}>
                  <StatusBar
                    barStyle="dark-content"
                    backgroundColor="#F5F5F7"
                    translucent={false}
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
