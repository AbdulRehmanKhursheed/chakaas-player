import React, { useCallback, useEffect } from 'react';
import {
  View,
  StyleSheet,
  Dimensions,
  Pressable,
  Platform,
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
  /** Background colour of the sheet surface. */
  backgroundColor?: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function BottomSheet({
  isVisible,
  onClose,
  children,
  snapPoint,
  showHandle = true,
  backgroundColor = '#F2F2F7',
}: BottomSheetProps) {
  const sheetHeight = snapPoint ?? SCREEN_HEIGHT * 0.6;

  // translateY: 0 = fully open, sheetHeight = fully closed/off-screen
  const translateY = useSharedValue(sheetHeight);
  const backdropOpacity = useSharedValue(0);

  const openSheet = useCallback(() => {
    backdropOpacity.value = withTiming(1, { duration: 250 });
    translateY.value = withSpring(0, SPRING_CONFIG);
  }, []);

  const closeSheet = useCallback(() => {
    backdropOpacity.value = withTiming(0, { duration: 200 });
    translateY.value = withSpring(sheetHeight, SPRING_CONFIG);
  }, [sheetHeight]);

  useEffect(() => {
    if (isVisible) {
      openSheet();
    } else {
      closeSheet();
    }
  }, [isVisible]);

  const handleClose = useCallback(() => {
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
    // Disable pointer events when invisible
    pointerEvents: backdropOpacity.value === 0 ? 'none' : 'auto',
  }));

  if (!isVisible && translateY.value >= sheetHeight) {
    // Fully offscreen and not visible — skip rendering
    // We still render to allow the close animation to play
  }

  return (
    <View style={styles.portal} pointerEvents={isVisible ? 'auto' : 'none'}>
      {/* Backdrop */}
      <Animated.View style={[styles.backdrop, backdropAnimStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={handleClose} />
      </Animated.View>

      {/* Sheet */}
      <PanGestureHandler onGestureEvent={gestureHandler}>
        <Animated.View
          style={[
            styles.sheet,
            {
              height: sheetHeight,
              backgroundColor,
            },
            sheetAnimStyle,
          ]}
        >
          {showHandle && (
            <View style={styles.handleContainer}>
              <View style={styles.handle} />
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
    backgroundColor: 'rgba(29,29,31,0.34)',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -8 },
        shadowOpacity: 0.14,
        shadowRadius: 20,
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
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#8E8E93',
  },
});
