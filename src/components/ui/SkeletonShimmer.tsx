/**
 * SkeletonShimmer
 * ───────────────
 *
 * Apple-Music-style shimmer placeholder. A dark base block with a brighter
 * highlight band that sweeps left-to-right on a loop, driven entirely on
 * the UI thread via Reanimated so it stays smooth while the JS thread is
 * busy hydrating real data.
 *
 * Variants:
 *   <SkeletonShimmer />     — primitive coloured rectangle
 *   <TrackRowSkeleton />    — single-row placeholder matching a track row
 *   <CardSkeleton />        — square card placeholder for hero carousels
 *   <ListSkeleton count />  — N stacked TrackRowSkeleton items
 */
import React, { useEffect } from 'react';
import { View, StyleSheet, type DimensionValue } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  interpolate,
  cancelAnimation,
  Easing,
} from 'react-native-reanimated';

interface ShimmerProps {
  width?: DimensionValue;
  height?: DimensionValue;
  borderRadius?: number;
}

const SHIMMER_DURATION_MS = 1100;
// Light-theme tokens — kept inline so the component reads correctly on the
// app's white surface regardless of what the global `palette.shimmer*`
// tokens are set to. The palette ships with dark values (used by an
// alternate dark theme); using them here produced near-black skeletons on
// a white background.
const SHIMMER_BASE = '#E5E5EA';
const SHIMMER_HIGHLIGHT = '#F2F2F7';

export function SkeletonShimmer({
  width = '100%',
  height = 14,
  borderRadius = 6,
}: ShimmerProps) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(
      withTiming(1, { duration: SHIMMER_DURATION_MS, easing: Easing.linear }),
      -1,
      false,
    );
    // Reanimated's `withRepeat(-1)` keeps mutating the shared value until
    // explicitly cancelled. Without this cleanup, popping the screen leaves
    // an orphan UI-thread worklet running forever.
    return () => {
      cancelAnimation(progress);
    };
  }, [progress]);

  const highlightStyle = useAnimatedStyle(() => {
    // Move from -100% to +100% across the base width so the highlight sweeps
    // out of view on each side.
    const translateX = interpolate(progress.value, [0, 1], [-200, 200]);
    return { transform: [{ translateX }] };
  });

  return (
    <View
      style={[
        styles.base,
        {
          width,
          height,
          borderRadius,
          backgroundColor: SHIMMER_BASE,
        },
      ]}
    >
      <Animated.View
        style={[
          styles.highlight,
          { backgroundColor: SHIMMER_HIGHLIGHT, borderRadius },
          highlightStyle,
        ]}
      />
    </View>
  );
}

export function TrackRowSkeleton() {
  return (
    <View style={styles.row}>
      <SkeletonShimmer width={50} height={50} borderRadius={8} />
      <View style={styles.rowMeta}>
        <SkeletonShimmer width="78%" height={13} borderRadius={4} />
        <View style={styles.gap6} />
        <SkeletonShimmer width="45%" height={11} borderRadius={4} />
      </View>
      <SkeletonShimmer width={28} height={11} borderRadius={4} />
    </View>
  );
}

export function CardSkeleton({ size = 160 }: { size?: number }) {
  return (
    <View style={{ width: size }}>
      <SkeletonShimmer width={size} height={size} borderRadius={12} />
      <View style={styles.gap8} />
      <SkeletonShimmer width="80%" height={12} borderRadius={4} />
      <View style={styles.gap6} />
      <SkeletonShimmer width="55%" height={10} borderRadius={4} />
    </View>
  );
}

export function ListSkeleton({ count = 6 }: { count?: number }) {
  return (
    <View>
      {Array.from({ length: count }, (_, i) => (
        <TrackRowSkeleton key={i} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  base: { overflow: 'hidden' },
  highlight: { ...StyleSheet.absoluteFillObject, opacity: 0.65 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    gap: 12,
  },
  rowMeta: { flex: 1 },
  gap6: { height: 6 },
  gap8: { height: 8 },
});
