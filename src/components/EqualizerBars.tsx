/**
 * EqualizerBars — animated "now playing" indicator. Faux-EQ (we can't read
 * live PCM frequencies from RNTP) but each bar runs its own staggered
 * Reanimated cycle so it reads as music-reactive rather than a plain loop.
 *
 * Two modes:
 *   - `playing=true`  → bars cycle continuously
 *   - `playing=false` → bars freeze at low height
 *
 * Renders zero JS work after mount: animations live in worklets.
 */
import React, { useEffect, useMemo } from 'react';
import { View, StyleSheet, type ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  cancelAnimation,
  Easing,
} from 'react-native-reanimated';

interface EqualizerBarsProps {
  /** Whether playback is active. Bars freeze when false. */
  playing: boolean;
  /** Number of bars. 3 for compact, 5 for hero. */
  count?: number;
  /** Bar width in px. */
  barWidth?: number;
  /** Total height the bars can reach (in px). */
  height?: number;
  /** Bar fill colour. */
  color?: string;
  /** Spacing between bars. */
  gap?: number;
  /** Optional style on the wrapper. */
  style?: ViewStyle;
}

interface BarConfig {
  duration: number;
  delay: number;
  minScale: number;
}

function buildBarConfigs(count: number): BarConfig[] {
  // Pseudo-random but deterministic so bars look uncoordinated yet stable.
  const seeds = [
    { duration: 480, delay: 0, minScale: 0.25 },
    { duration: 360, delay: 80, minScale: 0.4 },
    { duration: 540, delay: 160, minScale: 0.2 },
    { duration: 420, delay: 40, minScale: 0.3 },
    { duration: 600, delay: 200, minScale: 0.15 },
    { duration: 380, delay: 120, minScale: 0.35 },
    { duration: 460, delay: 240, minScale: 0.22 },
  ];
  return Array.from({ length: count }, (_, i) => seeds[i % seeds.length]);
}

function Bar({
  config,
  playing,
  width,
  height,
  color,
}: {
  config: BarConfig;
  playing: boolean;
  width: number;
  height: number;
  color: string;
}) {
  const scale = useSharedValue(config.minScale);

  useEffect(() => {
    if (playing) {
      // Fire after the per-bar delay so neighbouring bars don't move in
      // lockstep.
      scale.value = withSequence(
        withTiming(config.minScale, { duration: config.delay }),
        withRepeat(
          withSequence(
            withTiming(1, {
              duration: config.duration,
              easing: Easing.inOut(Easing.ease),
            }),
            withTiming(config.minScale, {
              duration: config.duration,
              easing: Easing.inOut(Easing.ease),
            }),
          ),
          -1,
          true,
        ),
      );
    } else {
      cancelAnimation(scale);
      scale.value = withTiming(config.minScale, { duration: 220 });
    }
    return () => {
      cancelAnimation(scale);
    };
  }, [playing, config, scale]);

  const animStyle = useAnimatedStyle(() => ({
    height: scale.value * height,
  }));

  return (
    <Animated.View
      style={[
        {
          width,
          backgroundColor: color,
          borderRadius: width / 2,
          alignSelf: 'flex-end',
        },
        animStyle,
      ]}
    />
  );
}

export function EqualizerBars({
  playing,
  count = 5,
  barWidth = 6,
  height = 60,
  color = '#FFFFFF',
  gap = 6,
  style,
}: EqualizerBarsProps) {
  const configs = useMemo(() => buildBarConfigs(count), [count]);
  return (
    <View style={[styles.row, { height, gap }, style]}>
      {configs.map((cfg, i) => (
        <Bar
          key={i}
          config={cfg}
          playing={playing}
          width={barWidth}
          height={height}
          color={color}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
});
