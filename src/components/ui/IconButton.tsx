import React, { useCallback } from 'react';
import {
  StyleSheet,
  Pressable,
  ViewStyle,
  StyleProp,
  View,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

// ─── Types ───────────────────────────────────────────────────────────────────

type HapticStyle = 'light' | 'medium' | 'heavy' | 'none';
type ButtonVariant = 'circular' | 'square' | 'ghost';

interface IconButtonProps {
  /** React element icon, or a short text fallback for legacy callers */
  icon: React.ReactNode | string;
  onPress: () => void;
  /** Outer container size in px. Default 44 */
  size?: number;
  /** Icon / tint colour. Defaults to #1D1D1F */
  color?: string;
  /** Background colour. Defaults to transparent for ghost. */
  backgroundColor?: string;
  /** 'circular' | 'square' | 'ghost'. Default 'circular' */
  variant?: ButtonVariant;
  /** Haptic feedback style on press. Default 'light' */
  hapticStyle?: HapticStyle;
  /** Scale-down factor on press. Default 0.88 */
  activeScale?: number;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Optional accessibility label */
  accessibilityLabel?: string;
}

// ─── Helper ──────────────────────────────────────────────────────────────────

function triggerHaptic(style: HapticStyle) {
  try {
    switch (style) {
      case 'light':
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        break;
      case 'medium':
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        break;
      case 'heavy':
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        break;
      default:
        break;
    }
  } catch {
    // ignore — haptics are a nice-to-have
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export function IconButton({
  icon,
  onPress,
  size = 44,
  color = '#1D1D1F',
  backgroundColor,
  variant = 'circular',
  hapticStyle = 'light',
  activeScale = 0.88,
  disabled = false,
  style,
  accessibilityLabel,
}: IconButtonProps) {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);

  const handlePressIn = useCallback(() => {
    if (disabled) return;
    scale.value = withSpring(activeScale, { damping: 15, stiffness: 300, mass: 0.6 });
    opacity.value = withTiming(0.75, { duration: 80 });
  }, [activeScale, disabled, opacity, scale]);

  const handlePressOut = useCallback(() => {
    if (disabled) return;
    scale.value = withSpring(1, { damping: 18, stiffness: 300, mass: 0.6 });
    opacity.value = withTiming(1, { duration: 150 });
  }, [disabled, opacity, scale]);

  const handlePress = useCallback(() => {
    if (disabled) return;
    if (hapticStyle !== 'none') {
      triggerHaptic(hapticStyle);
    }
    onPress();
  }, [disabled, hapticStyle, onPress]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  const borderRadius = variant === 'circular' ? size / 2 : variant === 'square' ? 10 : 0;
  const bgColor = backgroundColor ?? (variant === 'ghost' ? 'transparent' : 'rgba(60,60,67,0.08)');

  const iconEl = typeof icon === 'string'
    ? (
      <Animated.Text
        style={{
          fontSize: size * 0.45,
          color,
          lineHeight: size * 0.55,
          includeFontPadding: false,
          textAlignVertical: 'center',
        }}
      >
        {icon}
      </Animated.Text>
    )
    : icon;

  return (
    <Animated.View
      style={[
        {
          width: size,
          height: size,
          borderRadius,
          backgroundColor: bgColor,
          justifyContent: 'center',
          alignItems: 'center',
          overflow: 'hidden',
        },
        // A muted look on the disabled state makes it discoverable that
        // the button is currently inert.
        disabled && { opacity: 0.4 },
        animStyle,
        style,
      ]}
    >
      <Pressable
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={disabled}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        style={StyleSheet.absoluteFill}
      />
      <View pointerEvents="none">{iconEl}</View>
    </Animated.View>
  );
}

// ─── Accent variant ───────────────────────────────────────────────────────────

export function AccentIconButton(
  props: Omit<IconButtonProps, 'color' | 'backgroundColor'>,
) {
  return (
    <IconButton
      color="#FA233B"
      backgroundColor="rgba(250,35,59,0.10)"
      {...props}
    />
  );
}
