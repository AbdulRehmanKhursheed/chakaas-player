/**
 * SwipeableTrackRow
 * ─────────────────
 *
 * Wraps any track row component with Spotify/Apple-Music-style swipe
 * actions. Right-swipe reveals a single "Like" pill (gold heart).
 * Left-swipe reveals "Add to Queue" and "Download" actions side-by-side.
 *
 * Behaviour notes
 * ---------------
 *  • Action handlers are optional — pass only the ones the host screen
 *    knows how to handle. A row with no `onSwipeLike` simply won't reveal
 *    a right-swipe action.
 *  • A light haptic fires the first time the swipe crosses the reveal
 *    threshold (so the user knows it'll trigger on release) and a
 *    medium haptic fires when the action actually runs.
 *  • Built on `Swipeable` from react-native-gesture-handler — it ships
 *    its own gesture + Reanimated wiring so we don't have to reinvent
 *    PanGestureHandler for this.
 */
import React, { useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Swipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, {
  interpolate,
  useAnimatedStyle,
  Extrapolation,
  type SharedValue,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';

// ─── Constants ────────────────────────────────────────────────────────────────

const ACCENT_GOLD = '#FFD700';
const ACCENT_PRIMARY = '#FA233B';
const ACCENT_TEAL = '#1DB954';
const ACTION_WIDTH = 84;
const HAPTIC_THRESHOLD = 60;

// ─── Props ────────────────────────────────────────────────────────────────────

interface SwipeableTrackRowProps {
  children: React.ReactNode;
  /** Right-swipe action — typically toggle Like. */
  onSwipeLike?: () => void;
  /** First left-swipe action — typically Add to Queue. */
  onSwipeQueue?: () => void;
  /** Second left-swipe action — typically Download. */
  onSwipeDownload?: () => void;
  /** Optional style override for the row container. */
  containerStyle?: StyleProp<ViewStyle>;
  /** If true (default), close on action so the row springs back. */
  closeOnAction?: boolean;
  /** Disable the swipe gesture entirely (e.g. while in selection mode). */
  disabled?: boolean;
}

// ─── Action pill ──────────────────────────────────────────────────────────────

interface ActionPillProps {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  color: string;
  progress: SharedValue<number>;
  side: 'left' | 'right';
  index: number;
  total: number;
  onPress: () => void;
}

function ActionPill({
  icon,
  label,
  color,
  progress,
  side,
  index,
  total,
  onPress,
}: ActionPillProps) {
  // Pills enter from the outer edge — translate based on progress so the
  // animation feels physically connected to the swipe gesture.
  const pillStyle = useAnimatedStyle(() => {
    const span = ACTION_WIDTH * total;
    const initialOffset = side === 'left' ? span : -span;
    const tx = interpolate(
      progress.value,
      [0, 1],
      [initialOffset / (total - index || 1), 0],
      Extrapolation.CLAMP,
    );
    const scale = interpolate(progress.value, [0, 0.6, 1], [0.6, 0.95, 1], Extrapolation.CLAMP);
    return { transform: [{ translateX: tx }, { scale }] };
  });

  return (
    <Animated.View
      style={[
        styles.pillWrap,
        { width: ACTION_WIDTH },
        pillStyle,
      ]}
    >
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => [
          styles.pill,
          { backgroundColor: color },
          pressed && styles.pillPressed,
        ]}
      >
        <Ionicons name={icon} size={22} color="#0A0A0A" />
        <Text style={styles.pillLabel}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fireHaptic(style: 'light' | 'medium'): void {
  try {
    void Haptics.impactAsync(
      style === 'light'
        ? Haptics.ImpactFeedbackStyle.Light
        : Haptics.ImpactFeedbackStyle.Medium,
    );
  } catch {
    // ignore
  }
}

// ─── Main component ───────────────────────────────────────────────────────────

export function SwipeableTrackRow({
  children,
  onSwipeLike,
  onSwipeQueue,
  onSwipeDownload,
  containerStyle,
  closeOnAction = true,
  disabled = false,
}: SwipeableTrackRowProps) {
  const ref = useRef<SwipeableMethods>(null);
  const crossedThreshold = useRef(false);

  // Reset our threshold-haptic guard when the row springs back open or shut.
  const handleSwipeableWillOpen = useCallback(() => {
    crossedThreshold.current = false;
  }, []);
  const handleSwipeableWillClose = useCallback(() => {
    crossedThreshold.current = false;
  }, []);

  const handleClose = useCallback(() => {
    if (closeOnAction) ref.current?.close();
  }, [closeOnAction]);

  const handleLike = useCallback(() => {
    if (!onSwipeLike) return;
    fireHaptic('medium');
    onSwipeLike();
    handleClose();
  }, [onSwipeLike, handleClose]);

  const handleQueue = useCallback(() => {
    if (!onSwipeQueue) return;
    fireHaptic('medium');
    onSwipeQueue();
    handleClose();
  }, [onSwipeQueue, handleClose]);

  const handleDownload = useCallback(() => {
    if (!onSwipeDownload) return;
    fireHaptic('medium');
    onSwipeDownload();
    handleClose();
  }, [onSwipeDownload, handleClose]);

  const renderRightActions = useCallback(
    (
      _progressAnimatedValue: SharedValue<number>,
      _dragAnimatedValue: SharedValue<number>,
    ) => {
      if (!onSwipeLike) return null;
      // Mirror dragAnimatedValue into a 0-1 progress shared value.
      // Reanimated swipeable already gives us the progress value, so we
      // pass it directly to our pill animation.
      return (
        <View style={[styles.actionContainer, styles.actionContainerRight]}>
          <ActionPill
            icon="heart"
            label="Like"
            color={ACCENT_GOLD}
            progress={_progressAnimatedValue}
            side="right"
            index={0}
            total={1}
            onPress={handleLike}
          />
        </View>
      );
    },
    [onSwipeLike, handleLike],
  );

  const renderLeftActions = useCallback(
    (
      _progressAnimatedValue: SharedValue<number>,
      _dragAnimatedValue: SharedValue<number>,
    ) => {
      const pills: React.ReactNode[] = [];
      if (onSwipeQueue) {
        pills.push(
          <ActionPill
            key="queue"
            icon="list"
            label="Queue"
            color={ACCENT_TEAL}
            progress={_progressAnimatedValue}
            side="left"
            index={pills.length}
            total={2}
            onPress={handleQueue}
          />,
        );
      }
      if (onSwipeDownload) {
        pills.push(
          <ActionPill
            key="download"
            icon="arrow-down"
            label="Save"
            color={ACCENT_PRIMARY}
            progress={_progressAnimatedValue}
            side="left"
            index={pills.length}
            total={2}
            onPress={handleDownload}
          />,
        );
      }
      if (pills.length === 0) return null;
      return (
        <View style={[styles.actionContainer, styles.actionContainerLeft]}>
          {pills}
        </View>
      );
    },
    [onSwipeQueue, onSwipeDownload, handleQueue, handleDownload],
  );

  const handleSwipeableOpenStartDrag = useCallback(
    (direction: 'left' | 'right') => {
      // Fire the reveal haptic the first time we cross the threshold
      // during this gesture. Swipeable doesn't give us a per-pixel value
      // on a UI-thread callback, so we lean on `onSwipeableOpen` for the
      // confirmed reveal and use this as the "starting" tick.
      if (!crossedThreshold.current) {
        crossedThreshold.current = true;
        fireHaptic('light');
      }
      void direction;
    },
    [],
  );

  // No actions configured? Render plain.
  if (!onSwipeLike && !onSwipeQueue && !onSwipeDownload) {
    return <View style={containerStyle}>{children}</View>;
  }

  // Selection mode (or any other host-driven lock) suppresses the swipe
  // gesture so taps can be used for selection toggling instead.
  if (disabled) {
    return <View style={containerStyle}>{children}</View>;
  }

  return (
    <Swipeable
      ref={ref}
      friction={1.6}
      overshootFriction={6}
      leftThreshold={HAPTIC_THRESHOLD}
      rightThreshold={HAPTIC_THRESHOLD}
      // Yield to vertical parent scrolls (FlatList/ScrollView). The swipe must
      // travel ≥12px horizontally before it activates, and fails entirely if
      // the user has already moved ≥14px vertically — preventing the gesture
      // from "grabbing" the row when the user actually wants to scroll the
      // list.
      activeOffsetX={[-12, 12]}
      failOffsetY={[-14, 14]}
      renderLeftActions={renderLeftActions}
      renderRightActions={renderRightActions}
      onSwipeableWillOpen={handleSwipeableWillOpen}
      onSwipeableWillClose={handleSwipeableWillClose}
      onSwipeableOpenStartDrag={handleSwipeableOpenStartDrag}
      containerStyle={containerStyle}
    >
      {children}
    </Swipeable>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  actionContainer: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  actionContainerLeft: {
    flexDirection: 'row',
  },
  actionContainerRight: {
    flexDirection: 'row-reverse',
  },
  pillWrap: {
    alignSelf: 'stretch',
  },
  pill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    gap: 4,
  },
  pillPressed: {
    opacity: 0.72,
  },
  pillLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#0A0A0A',
    letterSpacing: 0.2,
  },
});
