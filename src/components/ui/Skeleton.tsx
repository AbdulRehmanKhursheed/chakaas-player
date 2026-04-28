import React from 'react';
import { View, StyleSheet } from 'react-native';
import { MotiView } from 'moti';
import { Skeleton } from 'moti/skeleton';

// ─── Theme ───────────────────────────────────────────────────────────────────

const SKELETON_COLORS: [string, ...string[]] = ['#F2F2F7', '#D2D2D7', '#F2F2F7'];

// ─── SkeletonText ─────────────────────────────────────────────────────────────

export function SkeletonText({ width }: { width: number | string }) {
  return (
    <Skeleton
      colorMode="light"
      colors={SKELETON_COLORS}
      width={width as number}
      height={12}
      radius={4}
    />
  );
}

// ─── SkeletonCard ─────────────────────────────────────────────────────────────

export function SkeletonCard({ width, height }: { width: number; height: number }) {
  return (
    <Skeleton
      colorMode="light"
      colors={SKELETON_COLORS}
      width={width}
      height={height}
      radius={12}
    />
  );
}

// ─── SkeletonTrackRow ─────────────────────────────────────────────────────────

export function SkeletonTrackRow() {
  return (
    <MotiView
      style={styles.row}
      // Stagger the fade-in on mount for a refined feel
      from={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ type: 'timing', duration: 300 }}
    >
      {/* Artwork placeholder */}
      <Skeleton
        colorMode="light"
        colors={SKELETON_COLORS}
        width={56}
        height={56}
        radius={8}
      />

      {/* Text block */}
      <View style={styles.textBlock}>
        {/* Title line */}
        <Skeleton
          colorMode="light"
          colors={SKELETON_COLORS}
          width="85%"
          height={13}
          radius={4}
        />
        <View style={styles.spacer4} />
        {/* Meta line */}
        <Skeleton
          colorMode="light"
          colors={SKELETON_COLORS}
          width="55%"
          height={11}
          radius={4}
        />
      </View>

      {/* Right block */}
      <View style={styles.rightBlock}>
        <Skeleton
          colorMode="light"
          colors={SKELETON_COLORS}
          width={28}
          height={11}
          radius={4}
        />
      </View>
    </MotiView>
  );
}

// ─── SkeletonTrackList ────────────────────────────────────────────────────────
// Convenience: renders N skeleton rows for a full list placeholder

export function SkeletonTrackList({ count = 8 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <MotiView
          key={i}
          from={{ opacity: 0, translateY: 6 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 300, delay: i * 50 }}
        >
          <SkeletonTrackRow />
        </MotiView>
      ))}
    </>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  row: {
    height: 72,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 12,
  },
  textBlock: {
    flex: 1,
    justifyContent: 'center',
  },
  spacer4: {
    height: 4,
  },
  rightBlock: {
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
});
