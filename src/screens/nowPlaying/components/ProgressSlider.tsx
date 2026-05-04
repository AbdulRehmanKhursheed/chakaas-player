/**
 * ProgressSlider — Premium Reanimated 3 scrubber for the Now Playing screen.
 *
 * Features:
 *   - Full-width accent/grey track (4 px)
 *   - Animated thumb that appears and scales on touch
 *   - Pan-gesture scrubbing with haptic feedback
 *   - Tap-anywhere-on-track to seek
 *   - Elapsed time (left) + total duration (right)
 */

import React, { useCallback } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedGestureHandler,
  useAnimatedReaction,
  withSpring,
  withTiming,
  runOnJS,
  interpolate,
  Extrapolation,
  clamp,
} from 'react-native-reanimated';
import {
  PanGestureHandler,
  type PanGestureHandlerGestureEvent,
} from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { formatDuration } from '@/utils/audio';

// ─── Constants ───────────────────────────────────────────────────────────────

const TRACK_HEIGHT = 5;
const THUMB_SIZE = 16;
const HIT_SLOP = { top: 20, bottom: 20, left: 0, right: 0 };

const SPRING_FAST = { damping: 18, stiffness: 260, mass: 0.6 };

// ─── Types ───────────────────────────────────────────────────────────────────

interface ProgressSliderProps {
  /** Total track duration in seconds. */
  duration: number;
  /** Current playback position in seconds. */
  position: number;
  /** Called when the user finishes a scrub gesture with the target position. */
  onSeek: (position: number) => void;
  /** Accent colour for the played portion. */
  accentColor?: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ProgressSlider({
  duration,
  position,
  onSeek,
  accentColor = '#FA233B',
}: ProgressSliderProps) {
  // Width of the rendered track — set via onLayout
  const trackWidth = useSharedValue(0);

  // Whether the user is currently dragging (suppresses RNTP position updates)
  const isDragging = useSharedValue(false);

  // Scrub position as a fraction [0, 1] (only valid while dragging)
  const scrubFraction = useSharedValue(0);

  // Optimistic post-release fraction. While ≥ 0 the bar stays at this
  // position instead of snapping back to the polled `playFraction`. Cleared
  // by the reaction below once RNTP's position catches up — eliminates the
  // visible "thumb jumps backward then forward" after release on Android,
  // where seekTo() can take 200–500 ms to settle.
  const optimisticEndFraction = useSharedValue(-1);

  // Thumb visibility & scale
  const thumbScale = useSharedValue(0);
  const thumbOpacity = useSharedValue(0);

  // ── Helpers ────────────────────────────────────────────────────────────────

  const triggerHaptic = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const handleSeek = useCallback(
    (fraction: number) => {
      const clamped = Math.min(1, Math.max(0, fraction));
      onSeek(clamped * duration);
    },
    [duration, onSeek],
  );

  // ── Derived fraction from RNTP progress (clamped, safe) ───────────────────
  const playFraction = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;

  // Once the polled position catches up to within ~1% of the optimistic
  // target, release the lock so the bar resumes following live playback.
  useAnimatedReaction(
    () => playFraction,
    (current) => {
      if (
        optimisticEndFraction.value >= 0 &&
        Math.abs(current - optimisticEndFraction.value) < 0.01
      ) {
        optimisticEndFraction.value = -1;
      }
    },
  );

  // ── Pan gesture (tap or drag to scrub) ─────────────────────────────────────
  const panHandler = useAnimatedGestureHandler<PanGestureHandlerGestureEvent>({
    onStart: (event) => {
      if (trackWidth.value === 0) return;
      isDragging.value = true;
      scrubFraction.value = clamp(event.x / trackWidth.value, 0, 1);

      // Show & enlarge thumb
      thumbOpacity.value = withTiming(1, { duration: 100 });
      thumbScale.value = withSpring(1, SPRING_FAST);
      runOnJS(triggerHaptic)();
    },
    onActive: (event) => {
      if (trackWidth.value === 0) return;
      scrubFraction.value = clamp(event.x / trackWidth.value, 0, 1);
    },
    onEnd: () => {
      isDragging.value = false;
      const finalFraction = scrubFraction.value;
      // Hold the bar at the release position so it doesn't snap backward
      // while RNTP completes the (async) seek.
      optimisticEndFraction.value = finalFraction;

      // Shrink thumb after a brief pause
      thumbScale.value = withSpring(0.7, SPRING_FAST, () => {
        thumbOpacity.value = withTiming(0, { duration: 150 });
        thumbScale.value = withTiming(0, { duration: 150 });
      });

      runOnJS(handleSeek)(finalFraction);
      runOnJS(triggerHaptic)();
    },
    onCancel: () => {
      isDragging.value = false;
      thumbScale.value = withTiming(0, { duration: 150 });
      thumbOpacity.value = withTiming(0, { duration: 150 });
    },
    onFail: () => {
      isDragging.value = false;
      thumbScale.value = withTiming(0, { duration: 150 });
      thumbOpacity.value = withTiming(0, { duration: 150 });
    },
  });

  // ── Animated styles ────────────────────────────────────────────────────────

  const playedBarStyle = useAnimatedStyle(() => {
    const fraction = isDragging.value
      ? scrubFraction.value
      : optimisticEndFraction.value >= 0
        ? optimisticEndFraction.value
        : playFraction;
    return {
      width: `${interpolate(fraction, [0, 1], [0, 100], Extrapolation.CLAMP)}%`,
    };
  });

  const thumbStyle = useAnimatedStyle(() => {
    const fraction = isDragging.value
      ? scrubFraction.value
      : optimisticEndFraction.value >= 0
        ? optimisticEndFraction.value
        : playFraction;
    const leftOffset = interpolate(
      fraction,
      [0, 1],
      [0, trackWidth.value - THUMB_SIZE],
      Extrapolation.CLAMP,
    );
    return {
      left: leftOffset,
      opacity: thumbOpacity.value,
      transform: [{ scale: thumbScale.value }],
    };
  });

  // ── Time labels ────────────────────────────────────────────────────────────
  const elapsedLabel = formatDuration(position * 1000);
  const totalLabel = formatDuration(duration * 1000);

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <View style={styles.wrapper}>
      {/* Track + thumb hit area */}
      <PanGestureHandler onGestureEvent={panHandler} hitSlop={HIT_SLOP} minDist={0}>
        <Animated.View
          style={styles.trackContainer}
          onLayout={(e) => {
            trackWidth.value = e.nativeEvent.layout.width;
          }}
        >
          {/* Background track */}
          <View style={styles.trackBg} />

          {/* Played portion */}
          <Animated.View
            style={[styles.trackPlayed, { backgroundColor: accentColor }, playedBarStyle]}
          />

          {/* Thumb */}
          <Animated.View
            style={[styles.thumb, thumbStyle]}
            pointerEvents="none"
          />
        </Animated.View>
      </PanGestureHandler>

      {/* Time labels */}
      <View style={styles.timeRow}>
        <Text style={styles.timeLabel}>{elapsedLabel}</Text>
        <Text style={styles.timeLabel}>{totalLabel}</Text>
      </View>
    </View>
  );
}


// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
  },
  trackContainer: {
    width: '100%',
    height: THUMB_SIZE + 16, // tall enough for comfortable touch
    justifyContent: 'center',
  },
  trackBg: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    backgroundColor: '#E5E5EA',
  },
  trackPlayed: {
    position: 'absolute',
    left: 0,
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
  },
  thumb: {
    position: 'absolute',
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    top: (THUMB_SIZE + 16 - THUMB_SIZE) / 2,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.18,
        shadowRadius: 5,
      },
      android: { elevation: 4 },
    }),
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  timeLabel: {
    fontSize: 11,
    fontWeight: '500',
    color: '#8E8E93',
    letterSpacing: 0.3,
  },
});
