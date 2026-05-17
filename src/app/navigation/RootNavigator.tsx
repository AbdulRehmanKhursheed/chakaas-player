import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { LinkingOptions } from '@react-navigation/native';

import { BottomTabNavigator } from './BottomTabNavigator';
import { NowPlayingScreen } from '@/screens/nowPlaying/NowPlayingScreen';
import { QueueScreen } from '@/screens/queue/QueueScreen';
import { PlaylistDetailScreen } from '@/screens/library/PlaylistDetailScreen';
import { ArtistDetailScreen } from '@/screens/library/ArtistDetailScreen';
import { AlbumDetailScreen } from '@/screens/library/AlbumDetailScreen';
import { ChakaasEngineScreen } from '@/screens/engine/ChakaasEngineScreen';
import type { RootStackParamList } from '@/types/navigation';

// ---------------------------------------------------------------------------
// Stack navigator
// ---------------------------------------------------------------------------

const Stack = createNativeStackNavigator<RootStackParamList>();

// ---------------------------------------------------------------------------
// Deep linking
// ---------------------------------------------------------------------------

/**
 * Deep-link configuration so notification taps / `chakaas://` URLs can route
 * straight to the relevant screen.
 *
 *   chakaas://nowplaying                       → NowPlayingScreen
 *   chakaas://queue                            → QueueScreen
 *   chakaas://album/:album                     → AlbumDetailScreen
 *   chakaas://artist/:artist                   → ArtistDetailScreen
 *   chakaas://playlist/:playlistId             → PlaylistDetailScreen
 *   chakaas://engine                           → ChakaasEngineScreen
 *   chakaas://(home|library|search|downloads|settings) → tab in MainTabs
 *
 * Notifee currently only fires intra-app actions (cancel-current/cancel-all)
 * so this config is mainly future-proofing — but it costs nothing at runtime
 * and means we don't have to re-architect when we add a "Tap to open" action.
 */
export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['chakaas://', 'https://chakaas.app'],
  config: {
    screens: {
      MainTabs: {
        screens: {
          Home: 'home',
          Library: 'library',
          Search: 'search',
          Downloads: 'downloads',
          Settings: 'settings',
        },
      },
      NowPlaying: 'nowplaying',
      Queue: 'queue',
      PlaylistDetail: 'playlist/:playlistId',
      ArtistDetail: 'artist/:artist',
      AlbumDetail: 'album/:album',
      ChakaasEngine: 'engine',
    },
  },
};

// ---------------------------------------------------------------------------
// RootNavigator
// ---------------------------------------------------------------------------

/**
 * RootNavigator is the top-level navigator for the entire app.
 *
 * Screen hierarchy
 * ├── MainTabs        – bottom tab navigator (home, library, search, settings)
 * ├── NowPlaying      – full-screen player modal (slides up from bottom)
 * ├── Queue           – up-next / queue management (slides from right)
 * ├── PlaylistDetail  – playlist detail view (slides from right)
 * ├── ArtistDetail    – artist discography view (slides from right)
 * └── AlbumDetail     – album tracklist view (slides from right)
 *
 * All screens share `headerShown: false` so each screen owns its header
 * styling entirely (or renders no header at all).
 */
export function RootNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#F5F5F7' },
      }}
    >
      {/* ── Tab entry point ─────────────────────────────────────────────── */}
      <Stack.Screen name="MainTabs" component={BottomTabNavigator} />

      {/* ── Full-screen modals ──────────────────────────────────────────── */}
      <Stack.Screen
        name="NowPlaying"
        component={NowPlayingScreen}
        options={{
          animation: 'slide_from_bottom',
          gestureEnabled: true,
          gestureDirection: 'vertical',
          // Prevent the gesture from interfering with the player's own
          // dismiss gesture by only activating outside the progress bar.
          fullScreenGestureEnabled: true,
        }}
      />

      {/* ── Secondary screens ───────────────────────────────────────────── */}
      <Stack.Screen
        name="Queue"
        component={QueueScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="PlaylistDetail"
        component={PlaylistDetailScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="ArtistDetail"
        component={ArtistDetailScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="AlbumDetail"
        component={AlbumDetailScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="ChakaasEngine"
        component={ChakaasEngineScreen}
        options={{ animation: 'slide_from_right' }}
      />
    </Stack.Navigator>
  );
}
