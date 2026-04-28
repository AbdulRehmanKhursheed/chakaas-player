/**
 * VolumeSlider — Same visual language as ProgressSlider but controls volume.
 *
 * Features:
 *   - Mute speaker icon left, full-volume speaker icon right
 *   - Accent played portion, pan + tap gesture
 *   - Calls TrackPlayer.setVolume on release
 *   - Persists volume to playerStore
 */

import React, { useCallback, useEffect } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedGestureHandler,
  withSpring,
  withTiming,
  runOnJS,
  interpolate,
  Extrapolation,
  clamp,
} from 'react-native-reanimated';
import {
  PanGestureHandler,
  TapGestureHandler,
  type PanGestureHandlerGestureEvent,
  type TapGestureHandlerGestureEvent,
} from 'react-native-gesture-handler';
import TrackPlayer from 'react-native-track-player';
import * as Haptics from 'expo-haptics';
import { usePlayerStore } from '@/stores/playerStore';

// ─── Constants ───────────────────────────────────────────────────────────────

const TRACK_HEIGHT = 5;
const THUMB_SIZE = 14;
const HIT_SLOP = { top: 20, bottom: 20, left: 0, right: 0 };
const SPRING_FAST = { damping: 18, stiffness: 260, mass: 0.6 };

// ─── Types ───────────────────────────────────────────────────────────────────

interface VolumeSliderProps {
  accentColor?: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function VolumeSlider({ accentColor = '#FA233B' }: VolumeSliderProps) {
  const storeVolume = usePlayerStore((s) => s.volume);
  const setStoreVolume = usePlayerStore((s) => s.setVolume);

  const trackWidth = useSharedValue(0);
  const isDragging = useSharedValue(false);
  const scrubFraction = useSharedValue(storeVolume);
  const thumbScale = useSharedValue(0);
  const thumbOpacity = useSharedValue(0);

  // Keep scrubFraction in sync with external volume changes
  useEffect(() => {
    if (!isDragging.value) {
      scrubFraction.value = withTiming(storeVolume, { duration: 80 });
    }
  }, [storeVolume]);

  // ── Helpers ────────────────────────────────────────────────────────────────

  const triggerHaptic = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const commitVolume = useCallback(
    (fraction: number) => {
      const clamped = Math.min(1, Math.max(0, fraction));
      TrackPlayer.setVolume(clamped);
      setStoreVolume(clamped);
    },
    [setStoreVolume],
  );

  // ── Pan gesture ────────────────────────────────────────────────────────────
  type PanCtx = { startFraction: number };

  const panHandler = useAnimatedGestureHandler<PanGestureHandlerGestureEvent, PanCtx>({
    onStart: (_, ctx) => {
      isDragging.value = true;
      ctx.startFraction = scrubFraction.value;
      thumbOpacity.value = withTiming(1, { duration: 100 });
      thumbScale.value = withSpring(1, SPRING_FAST);
      runOnJS(triggerHaptic)();
    },
    onActive: (event, ctx) => {
      if (trackWidth.value === 0) return;
      const delta = event.translationX / trackWidth.value;
      scrubFraction.value = clamp(ctx.startFraction + delta, 0, 1);
    },
    onEnd: () => {
      isDragging.value = false;
      const finalFraction = scrubFraction.value;
      thumbScale.value = withSpring(0.7, SPRING_FAST, () => {
        thumbOpacity.value = withTiming(0, { duration: 150 });
        thumbScale.value = withTiming(0, { duration: 150 });
      });
      runOnJS(commitVolume)(finalFraction);
      runOnJS(triggerHaptic)();
    },
    onFail: () => {
      isDragging.value = false;
      thumbScale.value = withTiming(0, { duration: 150 });
      thumbOpacity.value = withTiming(0, { duration: 150 });
    },
  });

  // ── Tap gesture ────────────────────────────────────────────────────────────
  const tapHandler = useAnimatedGestureHandler<TapGestureHandlerGestureEvent>({
    onEnd: (event) => {
      if (trackWidth.value === 0) return;
      const fraction = clamp(event.x / trackWidth.value, 0, 1);
      scrubFraction.value = fraction;
      runOnJS(commitVolume)(fraction);
      runOnJS(triggerHaptic)();
    },
  });

  // ── Animated styles ────────────────────────────────────────────────────────

  const filledBarStyle = useAnimatedStyle(() => ({
    width: `${interpolate(scrubFraction.value, [0, 1], [0, 100], Extrapolation.CLAMP)}%`,
  }));

  const thumbStyle = useAnimatedStyle(() => {
    const leftOffset = interpolate(
      scrubFraction.value,
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

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <View style={styles.row}>
      <Ionicons name="volume-mute" size={18} color="#8E8E93" />

      {/* Slider */}
      <View style={styles.sliderFlex}>
        <TapGestureHandler onGestureEvent={tapHandler}>
          <Animated.View>
            <PanGestureHandler onGestureEvent={panHandler} hitSlop={HIT_SLOP}>
              <Animated.View
                style={styles.trackContainer}
                onLayout={(e) => {
                  trackWidth.value = e.nativeEvent.layout.width;
                }}
              >
                <View style={styles.trackBg} />
                <Animated.View
                  style={[styles.trackFilled, { backgroundColor: accentColor }, filledBarStyle]}
                />
                <Animated.View
                  style={[styles.thumb, thumbStyle]}
                  pointerEvents="none"
                />
              </Animated.View>
            </PanGestureHandler>
          </Animated.View>
        </TapGestureHandler>
      </View>

      <Ionicons name="volume-high" size={18} color="#8E8E93" />
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  sliderFlex: {
    flex: 1,
  },
  trackContainer: {
    width: '100%',
    height: THUMB_SIZE + 16,
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
  trackFilled: {
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
});
