/**
 * MarqueeText
 * ───────────
 *
 * Auto-scrolling text for long titles. The text sits in a clipped container
 * and, when it would overflow, scrolls horizontally at a constant speed.
 * Cycle: pause 1.5s → scroll until the end is visible → pause 1.5s → snap
 * back to start → repeat. When the text fits inside the container, the
 * marquee is a no-op and the text renders normally.
 *
 * The scroll animation runs entirely on the UI thread via Reanimated's
 * `withRepeat` + `withSequence` so JS-thread work doesn't stutter it.
 */
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  type TextProps,
  type LayoutChangeEvent,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  withDelay,
  Easing,
  cancelAnimation,
} from 'react-native-reanimated';

interface MarqueeTextProps extends TextProps {
  children: string;
  /** Pixels-per-second scroll speed. Default 35 — feels like Apple Music. */
  speed?: number;
  /** Pause at each end of the cycle. Default 1500ms. */
  pauseMs?: number;
}

export function MarqueeText({
  children,
  speed = 35,
  pauseMs = 1500,
  style,
  ...textProps
}: MarqueeTextProps) {
  const [containerWidth, setContainerWidth] = useState(0);
  const [textWidth, setTextWidth] = useState(0);

  const offset = useSharedValue(0);

  // When `children` changes, the underlying Text re-lays-out and `onLayout`
  // fires with the new width. But if the new string happens to render at
  // the same width as the previous one (or the layout cycle is skipped on
  // a recycled row), the stale measurement keeps the old animation running.
  // Reset the measured text width whenever the text content changes so the
  // next layout pass re-establishes overflow.
  useEffect(() => {
    setTextWidth(0);
    cancelAnimation(offset);
    offset.value = 0;
  }, [children, offset]);

  const overflow = textWidth - containerWidth;
  const shouldScroll = overflow > 4 && containerWidth > 0;

  useEffect(() => {
    if (!shouldScroll) {
      cancelAnimation(offset);
      offset.value = 0;
      return;
    }

    const scrollMs = Math.max(2000, (overflow / speed) * 1000);
    offset.value = 0;
    offset.value = withRepeat(
      withSequence(
        withDelay(pauseMs, withTiming(-overflow, {
          duration: scrollMs,
          easing: Easing.linear,
        })),
        withDelay(pauseMs, withTiming(0, { duration: 0 })),
      ),
      -1,
      false,
    );

    return () => {
      cancelAnimation(offset);
    };
  }, [shouldScroll, overflow, speed, pauseMs, offset]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.value }],
  }));

  const handleContainerLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    setContainerWidth((prev) => (prev === w ? prev : w));
  };

  const handleTextLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    setTextWidth((prev) => (prev === w ? prev : w));
  };

  return (
    <View
      style={styles.container}
      onLayout={handleContainerLayout}
    >
      <Animated.View style={animStyle}>
        <Text
          {...textProps}
          numberOfLines={1}
          onLayout={handleTextLayout}
          style={[style, styles.text]}
        >
          {children}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    flexDirection: 'row',
  },
  // Force the text to render at its intrinsic width so we can measure overflow.
  text: { flexShrink: 0 },
});
