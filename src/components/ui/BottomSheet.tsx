import React, { useCallback, useEffect } from 'react';
import {
  View,
  StyleSheet,
  Dimensions,
  Pressable,
  Platform,
  Keyboard,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  runOnJS,
  useAnimatedGestureHandler,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { PanGestureHandler } from 'react-native-gesture-handler';
import { BlurView } from 'expo-blur';
import { useTheme } from '@/theme';

// ─── Constants ───────────────────────────────────────────────────────────────

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

const SPRING_CONFIG = {
  damping: 28,
  stiffness: 220,
  mass: 0.9,
};

const DISMISS_THRESHOLD = 80; // px dragged down to trigger dismiss
const VELOCITY_THRESHOLD = 800; // px/s downward velocity to trigger dismiss

// ─── Props ───────────────────────────────────────────────────────────────────

interface BottomSheetProps {
  isVisible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Height of the sheet when fully open, in px. Default: 60% of screen. */
  snapPoint?: number;
  /** Whether to show the drag handle at the top. Default true. */
  showHandle?: boolean;
  /** Background colour of the sheet surface. Defaults to the themed elevated surface. */
  backgroundColor?: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function BottomSheet({
  isVisible,
  onClose,
  children,
  snapPoint,
  showHandle = true,
  backgroundColor,
}: BottomSheetProps) {
  const { colors, isDark } = useTheme();
  const sheetSurface = backgroundColor ?? colors.bgElevated;
  const sheetHeight = snapPoint ?? SCREEN_HEIGHT * 0.6;

  // translateY: 0 = fully open, sheetHeight = fully closed/off-screen
  const translateY = useSharedValue(sheetHeight);
  const backdropOpacity = useSharedValue(0);

  const openSheet = useCallback(() => {
    backdropOpacity.value = withTiming(1, { duration: 250 });
    translateY.value = withSpring(0, SPRING_CONFIG);
  }, [backdropOpacity, translateY]);

  const closeSheet = useCallback(() => {
    backdropOpacity.value = withTiming(0, { duration: 200 });
    translateY.value = withSpring(sheetHeight, SPRING_CONFIG);
  }, [backdropOpacity, sheetHeight, translateY]);

  useEffect(() => {
    if (isVisible) {
      openSheet();
    } else {
      // Dismiss any open keyboard when the sheet is being hidden — e.g. a
      // playlist-create sheet that had focused a TextInput.
      Keyboard.dismiss();
      closeSheet();
    }
  }, [isVisible, openSheet, closeSheet]);

  const handleClose = useCallback(() => {
    Keyboard.dismiss();
    closeSheet();
    // Delay the state update slightly so animation can begin
    setTimeout(onClose, 250);
  }, [closeSheet, onClose]);

  // Gesture — drag the sheet down to dismiss
  const gestureHandler = useAnimatedGestureHandler({
    onStart: (_, ctx: { startY: number }) => {
      ctx.startY = translateY.value;
    },
    onActive: (event, ctx) => {
      // Only allow downward drag
      const newVal = ctx.startY + event.translationY;
      translateY.value = Math.max(0, newVal);

      // Update backdrop opacity in sync with drag
      backdropOpacity.value = interpolate(
        translateY.value,
        [0, sheetHeight],
        [1, 0],
        Extrapolation.CLAMP,
      );
    },
    onEnd: (event) => {
      if (
        event.translationY > DISMISS_THRESHOLD ||
        event.velocityY > VELOCITY_THRESHOLD
      ) {
        runOnJS(handleClose)();
      } else {
        // Snap back open
        translateY.value = withSpring(0, SPRING_CONFIG);
        backdropOpacity.value = withTiming(1, { duration: 200 });
      }
    },
  });

  const sheetAnimStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const backdropAnimStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  return (
    <View style={styles.portal} pointerEvents={isVisible ? 'auto' : 'none'}>
      {/* Backdrop */}
      <Animated.View style={[styles.backdrop, { backgroundColor: colors.overlay }, backdropAnimStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={handleClose} />
      </Animated.View>

      {/* Sheet */}
      <PanGestureHandler onGestureEvent={gestureHandler}>
        <Animated.View
          style={[
            styles.sheet,
            {
              height: sheetHeight,
              backgroundColor: sheetSurface,
              borderColor: colors.borderAccent,
            },
            sheetAnimStyle,
          ]}
        >
          {/* Dark frosted-glass layer for the Arc Reactor look. */}
          <BlurView
            intensity={isDark ? 30 : 20}
            tint={isDark ? 'dark' : 'light'}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          {showHandle && (
            <View style={styles.handleContainer}>
              <View style={[styles.handle, { backgroundColor: colors.textTertiary }]} />
            </View>
          )}
          {children}
        </Animated.View>
      </PanGestureHandler>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  portal: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    zIndex: 1000,
    elevation: 1000,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -6 },
        shadowOpacity: 0.3,
        shadowRadius: 24,
      },
      android: { elevation: 24 },
    }),
  },
  handleContainer: {
    width: '100%',
    alignItems: 'center',
    paddingVertical: 10,
  },
  handle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    opacity: 0.7,
  },
});
