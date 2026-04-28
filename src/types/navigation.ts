import type {
  NativeStackNavigationProp as RNNativeStackNavigationProp,
} from '@react-navigation/native-stack';
import type {
  BottomTabNavigationProp as RNBottomTabNavigationProp,
} from '@react-navigation/bottom-tabs';

// ---------------------------------------------------------------------------
// Root stack
// ---------------------------------------------------------------------------

/**
 * Param list for the root native stack navigator.
 * Screens that live outside the bottom tab bar (e.g. full-screen modals)
 * are declared here alongside the MainTabs entry point.
 */
export type RootStackParamList = {
  /** Entry point – renders the bottom tab navigator. */
  MainTabs: undefined;
  /** Full-screen Now Playing modal. */
  NowPlaying: undefined;
  /** Full-screen queue/up-next modal. */
  Queue: undefined;
  /** Playlist detail view. */
  PlaylistDetail: { playlistId: string };
  /** Artist detail view – shows all tracks and albums for a given artist. */
  ArtistDetail: { artist: string };
  /** Album detail view – shows tracklist for a given album. */
  AlbumDetail: { album: string };
};

// ---------------------------------------------------------------------------
// Bottom tab navigator
// ---------------------------------------------------------------------------

/**
 * Param list for the bottom tab navigator (nested inside RootStack > MainTabs).
 */
export type BottomTabParamList = {
  /** Home / featured content screen. */
  Home: undefined;
  /** User's music library (local tracks, playlists, artists, albums). */
  Library: undefined;
  /** YouTube and local-library search. Accepts an optional pre-filled query. */
  Search: { query?: string } | undefined;
  /** Active and completed downloads. */
  Downloads: undefined;
  /** App settings and preferences. */
  Settings: undefined;
};

// ---------------------------------------------------------------------------
// Convenience navigation prop types
// ---------------------------------------------------------------------------

/**
 * Navigation prop for any screen that lives directly in the RootStack.
 *
 * @example
 * ```ts
 * import type { RootStackNavigationProp } from '@/types/navigation';
 *
 * type Props = { navigation: RootStackNavigationProp<'NowPlaying'> };
 * ```
 */
export type RootStackNavigationProp<
  RouteName extends keyof RootStackParamList = keyof RootStackParamList,
> = RNNativeStackNavigationProp<RootStackParamList, RouteName>;

/**
 * Navigation prop for any screen that lives inside the BottomTabNavigator.
 *
 * @example
 * ```ts
 * import type { BottomTabNavigationProp } from '@/types/navigation';
 *
 * type Props = { navigation: BottomTabNavigationProp<'Library'> };
 * ```
 */
export type BottomTabNavigationProp<
  RouteName extends keyof BottomTabParamList = keyof BottomTabParamList,
> = RNBottomTabNavigationProp<BottomTabParamList, RouteName>;
