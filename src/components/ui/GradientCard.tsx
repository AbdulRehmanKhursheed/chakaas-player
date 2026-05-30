import React from 'react';
import {
  StyleSheet,
  Pressable,
  ViewStyle,
  StyleProp,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useTheme } from '@/theme';

// ─── Props ───────────────────────────────────────────────────────────────────

interface GradientCardProps {
  /** Array of colour stops, e.g. ['#FA233B', '#FF6B8A'] */
  colors: readonly [string, string, ...string[]];
  /** Override for the outer container */
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  borderRadius?: number;
  /** If provided, the card is pressable */
  onPress?: () => void;
  /** Direction of the gradient — defaults to a subtle top-to-bottom */
  start?: { x: number; y: number };
  end?: { x: number; y: number };
  /** Opacity for the gradient overlay (0–1). Defaults to 1. */
  gradientOpacity?: number;
}

// ─── Component ───────────────────────────────────────────────────────────────

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function GradientCard({
  colors,
  style,
  children,
  borderRadius = 16,
  onPress,
  start = { x: 0, y: 0 },
  end = { x: 1, y: 1 },
  gradientOpacity = 1,
}: GradientCardProps) {
  const scale = useSharedValue(1);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    if (onPress) {
      scale.value = withSpring(0.96, { damping: 18, stiffness: 280 });
    }
  };

  const handlePressOut = () => {
    if (onPress) {
      scale.value = withSpring(1, { damping: 18, stiffness: 280 });
    }
  };

  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[{ borderRadius, overflow: 'hidden' }, style, animStyle]}
      disabled={!onPress}
    >
      <LinearGradient
        colors={colors}
        start={start}
        end={end}
        style={[
          StyleSheet.absoluteFill,
          { opacity: gradientOpacity },
        ]}
      />
      {children}
    </AnimatedPressable>
  );
}

// ─── Preset variants ─────────────────────────────────────────────────────────

/** Accent gradient — arc-reactor cyan→blue, used for featured/hero cards */
export function AccentGradientCard(
  props: Omit<GradientCardProps, 'colors'>,
) {
  const { colors } = useTheme();
  return (
    <GradientCard
      colors={colors.brandGradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      {...props}
    />
  );
}

/** Gold gradient — Iron Man gold, for premium CTAs / cards */
export function GoldGradientCard(
  props: Omit<GradientCardProps, 'colors'>,
) {
  const { colors } = useTheme();
  return (
    <GradientCard
      colors={colors.goldGradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      {...props}
    />
  );
}

/** Dark elevated surface gradient — for cards with a subtle depth feel */
export function SurfaceGradientCard(
  props: Omit<GradientCardProps, 'colors'>,
) {
  const { colors } = useTheme();
  return (
    <GradientCard
      colors={[colors.bgRaised, colors.bgElevated]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      {...props}
    />
  );
}

/** Bottom-fade gradient — placed over artwork to ensure text legibility.
 *  Fades to the near-black app canvas so artwork blends into the dark UI. */
export function ArtworkFadeGradient({
  style,
}: {
  style?: StyleProp<ViewStyle>;
  borderRadius?: number;
}) {
  return (
    <LinearGradient
      colors={['transparent', 'rgba(3,5,8,0.6)', 'rgba(3,5,8,0.95)']}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={[StyleSheet.absoluteFill, style]}
      pointerEvents="none"
    />
  );
}
