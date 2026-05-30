/**
 * BlurHeader
 * ──────────
 *
 * Apple-style frosted header. The header is always laid out at the top of
 * the screen and uses a `BlurView` for its background. As the consumer
 * scrolls down, the blur tint, intensity, and hairline divider fade in so
 * the title visually "lifts" away from the content beneath it — matching
 * the system Music / Settings / Photos app behaviour.
 *
 * The `scrollY` shared value must be driven from `useAnimatedScrollHandler`
 * on the host scroll view so all interpolation stays on the UI thread.
 */
import React from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import Animated, {
  useAnimatedStyle,
  interpolate,
  Extrapolation,
  type SharedValue,
} from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/theme';

interface BlurHeaderProps {
  /** Shared value tracking the host scroll view's contentOffset.y. */
  scrollY: SharedValue<number>;
  /** Title text — large and bold, matching Apple Music section pages. */
  title: string;
  /** Optional right slot (e.g. a downloads button, sort button, etc.). */
  rightAction?: React.ReactNode;
  /** Optional left slot (e.g. a back button). */
  leftAction?: React.ReactNode;
  /** Override default tint colour for the blur. Defaults to the theme scheme. */
  tint?: 'light' | 'dark' | 'default';
  /** When true, the title size collapses on scroll (Apple-style large-title). */
  collapsing?: boolean;
}

const SCROLL_THRESHOLD = 60;

export function BlurHeader({
  scrollY,
  title,
  rightAction,
  leftAction,
  tint,
  collapsing = true,
}: BlurHeaderProps) {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const resolvedTint = tint ?? (isDark ? 'dark' : 'light');
  const topPad = Math.max(insets.top, Platform.OS === 'ios' ? 44 : 24);

  // Background opacity ramps 0 -> 1 as the user scrolls the first ~60px.
  // The BlurView itself is always mounted (it can't animate intensity
  // without an extra dep), and the alpha layer over it provides the
  // visual transition.
  const surfaceStyle = useAnimatedStyle(() => {
    const opacity = interpolate(
      scrollY.value,
      [0, SCROLL_THRESHOLD],
      [0, 1],
      Extrapolation.CLAMP,
    );
    return { opacity };
  });

  const hairlineStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      scrollY.value,
      [SCROLL_THRESHOLD - 10, SCROLL_THRESHOLD],
      [0, 1],
      Extrapolation.CLAMP,
    ),
  }));

  // Collapsing large title: shrinks from 28 -> 17 px and slides up subtly
  // so the header collapses into a compact bar — same trick the system
  // header uses in iOS 16+.
  const titleStyle = useAnimatedStyle(() => {
    if (!collapsing) return { fontSize: 28, transform: [{ translateY: 0 }] };
    const fontSize = interpolate(
      scrollY.value,
      [0, SCROLL_THRESHOLD],
      [28, 17],
      Extrapolation.CLAMP,
    );
    return { fontSize };
  });

  return (
    <View style={[styles.root, { paddingTop: topPad }]} pointerEvents="box-none">
      {/* Frosted-glass background — sits beneath everything else. */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <BlurView intensity={60} tint={resolvedTint} style={StyleSheet.absoluteFill} />
        <Animated.View
          pointerEvents="none"
          style={[styles.tintOverlay, { backgroundColor: colors.overlay }, surfaceStyle]}
        />
      </View>

      <View style={styles.bar}>
        <View style={styles.side}>{leftAction}</View>
        <Animated.Text
          numberOfLines={1}
          style={[styles.title, { color: colors.textPrimary }, titleStyle]}
        >
          {title}
        </Animated.Text>
        <View style={styles.side}>{rightAction}</View>
      </View>

      <Animated.View
        style={[styles.hairline, { backgroundColor: colors.borderAccent }, hairlineStyle]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    zIndex: 10,
  },
  tintOverlay: {
    ...StyleSheet.absoluteFillObject,
    // Frosted tint colour is themed at runtime via `colors.overlay`.
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 10,
    minHeight: 44,
  },
  side: {
    minWidth: 40,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    fontWeight: '800',
    letterSpacing: -0.6,
    textAlign: 'left',
    marginLeft: 4,
  },
  hairline: {
    height: StyleSheet.hairlineWidth,
  },
});
