/**
 * Layout constants and helpers shared across screens.
 *
 * The app overlays a floating bottom tab bar plus a MiniPlayer above it, so
 * any scrollable list needs enough bottom padding to keep its last items
 * from being covered. These constants mirror the values in
 * `BottomTabNavigator.tsx` and `MiniPlayer.tsx` — keep in sync if you tweak
 * the chrome there.
 */

export const MINI_PLAYER_HEIGHT = 70;
export const TAB_BAR_HEIGHT_BASE = 58;
export const TAB_BAR_BOTTOM_MARGIN = 12;
export const TAB_BAR_EXTRA_HEIGHT = 10;
// MiniPlayer sits flush on top of the tab bar — no floating gap. Keep in
// sync with `MINI_PLAYER_GAP` in BottomTabNavigator.tsx.
export const MINI_PLAYER_GAP = 0;

/**
 * Bottom inset that clears the floating tab bar.
 *
 * When `withMiniPlayer` is true, also reserves space for the MiniPlayer
 * overlay (visible whenever a track is active). The 32 px tail covers
 * scroll bounce / over-scroll on Android.
 *
 * Reserving MiniPlayer space when nothing is playing leaves a giant empty
 * strip at the bottom of every list — pass `false` in that state.
 */
export function getScreenBottomInset(
  insetsBottom: number,
  withMiniPlayer = true,
): number {
  const tabChrome =
    TAB_BAR_BOTTOM_MARGIN +
    TAB_BAR_HEIGHT_BASE +
    insetsBottom +
    TAB_BAR_EXTRA_HEIGHT;
  if (!withMiniPlayer) {
    return tabChrome + 16;
  }
  return tabChrome + MINI_PLAYER_GAP + MINI_PLAYER_HEIGHT + 32;
}

/**
 * Normalise a local file path so React Native's `Image` / FastImage will
 * actually load it on Android. RNBlobUtil and some MediaLibrary code paths
 * return bare absolute paths (e.g. `/data/user/0/.../artwork.jpg`); FastImage
 * only resolves these when prefixed with `file://`.
 *
 * Remote URLs (http/https), data URIs, and `content://` URIs are returned
 * unchanged.
 */
export function normalizeLocalUri(uri: string | null | undefined): string | null {
  if (!uri) return null;
  if (
    uri.startsWith('http://') ||
    uri.startsWith('https://') ||
    uri.startsWith('file://') ||
    uri.startsWith('content://') ||
    uri.startsWith('data:') ||
    uri.startsWith('asset://')
  ) {
    return uri;
  }
  if (uri.startsWith('/')) return `file://${uri}`;
  return uri;
}
