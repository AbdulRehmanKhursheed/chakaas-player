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

interface BlurHeaderProps {
  /** Shared value tracking the host scroll view's contentOffset.y. */
  scrollY: SharedValue<number>;
  /** Title text — large and bold, matching Apple Music section pages. */
  title: string;
  /** Optional right slot (e.g. a downloads button, sort button, etc.). */
  rightAction?: React.ReactNode;
  /** Optional left slot (e.g. a back button). */
  leftAction?: React.ReactNode;
  /** Override default tint colour for the blur. */
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
  tint = 'light',
  collapsing = true,
}: BlurHeaderProps) {
  const insets = useSafeAreaInsets();
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
        <BlurView intensity={60} tint={tint} style={StyleSheet.absoluteFill} />
        <Animated.View
          pointerEvents="none"
          style={[styles.tintOverlay, surfaceStyle]}
        />
      </View>

      <View style={styles.bar}>
        <View style={styles.side}>{leftAction}</View>
        <Animated.Text
          numberOfLines={1}
          style={[styles.title, titleStyle]}
        >
          {title}
        </Animated.Text>
        <View style={styles.side}>{rightAction}</View>
      </View>

      <Animated.View style={[styles.hairline, hairlineStyle]} />
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
    // Apple-style frosted tint — matches `palette.glass` but kept inline so
    // the component is self-contained and doesn't require a theme provider.
    backgroundColor: 'rgba(245,245,247,0.78)',
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
    color: '#1D1D1F',
    letterSpacing: -0.6,
    textAlign: 'left',
    marginLeft: 4,
  },
  hairline: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(60,60,67,0.18)',
  },
});
