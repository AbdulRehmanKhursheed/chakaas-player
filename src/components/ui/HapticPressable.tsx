/**
 * HapticPressable
 * ───────────────
 *
 * Drop-in replacement for RN's `Pressable` that fires a lightweight haptic
 * tap on `onPressIn`. Same props surface as `Pressable` plus a `hapticStyle`
 * to pick the feedback intensity — selection by default so it feels like
 * iOS list-row navigation; medium/heavy for important actions like Like or
 * Add-to-Queue.
 *
 * Haptics are fire-and-forget on the JS thread (expo-haptics returns a
 * Promise that we deliberately don't await) so they never block render.
 */
import React, { useCallback } from 'react';
import {
  Pressable,
  type PressableProps,
  type GestureResponderEvent,
} from 'react-native';
import * as Haptics from 'expo-haptics';

export type HapticStyle = 'light' | 'medium' | 'heavy' | 'selection';

export interface HapticPressableProps extends PressableProps {
  /** Haptic intensity fired on press-in. Default `'selection'`. */
  hapticStyle?: HapticStyle;
  /** If true, skip the haptic (useful when prop is conditional). */
  disableHaptic?: boolean;
}

function fireHaptic(style: HapticStyle): void {
  // Wrapped in a try so a missing native module on an older device doesn't
  // crash the press handler.
  try {
    switch (style) {
      case 'light':
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        return;
      case 'medium':
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        return;
      case 'heavy':
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        return;
      case 'selection':
      default:
        void Haptics.selectionAsync();
        return;
    }
  } catch {
    // ignore — haptics are a nice-to-have
  }
}

export function HapticPressable({
  hapticStyle = 'selection',
  disableHaptic = false,
  onPressIn,
  disabled,
  accessibilityRole,
  ...rest
}: HapticPressableProps) {
  const handlePressIn = useCallback(
    (e: GestureResponderEvent) => {
      // Never fire haptics for a disabled control — the underlying `Pressable`
      // already suppresses `onPress`, but `onPressIn` can still arrive on some
      // platforms when the touchable is rendered but disabled.
      if (disabled) {
        onPressIn?.(e);
        return;
      }
      if (!disableHaptic) fireHaptic(hapticStyle);
      onPressIn?.(e);
    },
    [disabled, disableHaptic, hapticStyle, onPressIn],
  );

  return (
    <Pressable
      {...rest}
      disabled={disabled}
      accessibilityRole={accessibilityRole ?? 'button'}
      onPressIn={handlePressIn}
    />
  );
}
