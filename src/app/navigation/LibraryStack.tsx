import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { LibraryScreen } from '@/screens/library/LibraryScreen';
import { ArtistDetailScreen } from '@/screens/library/ArtistDetailScreen';
import { AlbumDetailScreen } from '@/screens/library/AlbumDetailScreen';

// ---------------------------------------------------------------------------
// Param list
// ---------------------------------------------------------------------------

/**
 * Param list for the Library tab's own nested stack.
 *
 * ArtistDetail and AlbumDetail also exist in the RootStackParamList for
 * navigation from other tabs (e.g. tapping an artist name in the Now Playing
 * screen). The in-tab versions use the same screen components but live inside
 * the Library stack so the tab bar remains visible.
 */
export type LibraryStackParamList = {
  Library: undefined;
  ArtistDetail: { artist: string };
  AlbumDetail: { album: string };
};

// ---------------------------------------------------------------------------
// Navigator instance
// ---------------------------------------------------------------------------

const Stack = createNativeStackNavigator<LibraryStackParamList>();

// ---------------------------------------------------------------------------
// LibraryStack
// ---------------------------------------------------------------------------

/**
 * LibraryStack covers the user's music library tab.
 *
 * Screen hierarchy
 * └── Library         – root list of tracks, albums, artists, playlists
 *     ├── ArtistDetail – all tracks / albums for a given artist
 *     └── AlbumDetail  – full tracklist for an album
 *
 * Both detail screens slide in from the right following standard iOS/Android
 * navigation conventions.
 */
export function LibraryStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#F5F5F7' },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="Library" component={LibraryScreen} />
      <Stack.Screen name="ArtistDetail" component={ArtistDetailScreen} />
      <Stack.Screen name="AlbumDetail" component={AlbumDetailScreen} />
    </Stack.Navigator>
  );
}
