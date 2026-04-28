/**
 * PlayerControls — Shuffle / Prev / Play-Pause / Next / Repeat row.
 *
 * Design:
 *   - Play/Pause: accent circle, white icon, scale-spring on press
 *   - Prev / Next: 44 px white icon buttons
 *   - Shuffle / Repeat: icon buttons, accent when active
 *   - All buttons fire expo-haptics
 *   - Repeat mode badge shows "1" on top-right dot when track-repeat is active
 */

import React, { memo, useCallback } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import type { RepeatModeKey } from '@/features/player/usePlayer';

// ─── Constants ───────────────────────────────────────────────────────────────

const SPRING_PRESS = { damping: 12, stiffness: 320, mass: 0.5 };

// ─── Types ───────────────────────────────────────────────────────────────────

interface PlayerControlsProps {
  isPlaying: boolean;
  isLoading?: boolean;
  onPlayPause: () => void;
  onPrevious: () => void;
  onNext: () => void;
  repeatMode: RepeatModeKey;
  onRepeat: () => void;
  shuffleEnabled: boolean;
  onShuffle: () => void;
  accentColor?: string;
}

// ─── Animated play button ─────────────────────────────────────────────────────

function PlayButton({
  isPlaying,
  isLoading,
  onPress,
  accentColor,
}: {
  isPlaying: boolean;
  isLoading?: boolean;
  onPress: () => void;
  accentColor: string;
}) {
  const scale = useSharedValue(1);

  const handlePress = useCallback(() => {
    scale.value = withSpring(0.88, SPRING_PRESS, () => {
      scale.value = withSpring(1, SPRING_PRESS);
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onPress();
  }, [onPress]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <TouchableOpacity onPress={handlePress} activeOpacity={1}>
      <Animated.View
        style={[
          styles.playCircle,
          { backgroundColor: accentColor },
          animStyle,
        ]}
      >
        {isLoading ? (
          <ActivityIndicator size="small" color="#FFFFFF" />
        ) : (
          <Ionicons
            name={isPlaying ? 'pause' : 'play'}
            size={31}
            color="#FFFFFF"
            style={!isPlaying ? styles.playIconNudge : undefined}
          />
        )}
      </Animated.View>
    </TouchableOpacity>
  );
}

// ─── Skip button (prev / next) ─────────────────────────────────────────────

function SkipButton({
  direction,
  onPress,
}: {
  direction: 'prev' | 'next';
  onPress: () => void;
}) {
  const scale = useSharedValue(1);

  const handlePress = useCallback(() => {
    scale.value = withSpring(0.82, SPRING_PRESS, () => {
      scale.value = withSpring(1, SPRING_PRESS);
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onPress();
  }, [onPress]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <TouchableOpacity onPress={handlePress} activeOpacity={1} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
      <Animated.View style={[styles.skipButton, animStyle]}>
        <Ionicons
          name={direction === 'prev' ? 'play-skip-back' : 'play-skip-forward'}
          size={30}
          color="#1D1D1F"
        />
      </Animated.View>
    </TouchableOpacity>
  );
}

// ─── Shuffle / Repeat icon buttons ───────────────────────────────────────────

function IconButton({
  icon,
  active,
  badge,
  onPress,
  accentColor,
  disabled = false,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  active: boolean;
  badge?: string;
  onPress: () => void;
  accentColor: string;
  disabled?: boolean;
}) {
  const scale = useSharedValue(1);
  const activeOpacity = useSharedValue(active ? 1 : 0);

  // Animate active glow dot
  React.useEffect(() => {
    activeOpacity.value = withTiming(active ? 1 : 0, { duration: 200 });
  }, [active]);

  const handlePress = useCallback(() => {
    if (disabled) return;
    scale.value = withSpring(0.80, SPRING_PRESS, () => {
      scale.value = withSpring(1, SPRING_PRESS);
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  }, [disabled, onPress]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const dotStyle = useAnimatedStyle(() => ({
    opacity: activeOpacity.value,
  }));

  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={1}
      disabled={disabled}
      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
    >
      <Animated.View style={[styles.iconButton, animStyle]}>
        <Ionicons
          name={icon}
          size={22}
          color={disabled ? '#C7C7CC' : active ? accentColor : '#8E8E93'}
        />
        <Animated.View
          style={[styles.activeDot, { backgroundColor: accentColor }, dotStyle]}
        >
          {badge ? (
            <View style={styles.badgeOne} />
          ) : null}
        </Animated.View>
      </Animated.View>
    </TouchableOpacity>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

function PlayerControlsImpl({
  isPlaying,
  isLoading,
  onPlayPause,
  onPrevious,
  onNext,
  repeatMode,
  onRepeat,
  shuffleEnabled,
  onShuffle,
  accentColor = '#FA233B',
}: PlayerControlsProps) {
  const repeatBadge = repeatMode === 'track' ? '1' : undefined;
  const repeatActive = repeatMode !== 'off';

  return (
    <View style={styles.row}>
      {/* Shuffle */}
      <IconButton
        icon="shuffle"
        active={shuffleEnabled && false}
        onPress={onShuffle}
        accentColor={accentColor}
        disabled
      />

      {/* Previous */}
      <SkipButton direction="prev" onPress={onPrevious} />

      {/* Play / Pause */}
      <PlayButton
        isPlaying={isPlaying}
        isLoading={isLoading}
        onPress={onPlayPause}
        accentColor={accentColor}
      />

      {/* Next */}
      <SkipButton direction="next" onPress={onNext} />

      {/* Repeat */}
      <IconButton
        icon={repeatMode === 'track' ? 'repeat-outline' : 'repeat'}
        active={repeatActive}
        badge={repeatBadge}
        onPress={onRepeat}
        accentColor={accentColor}
      />
    </View>
  );
}

// Memoize so PlayerControls doesn't re-render on every parent tick (e.g.
// useProgress(500) in the parent NowPlayingScreen). Buttons keep their
// internal animation state across the parent's progress updates.
export const PlayerControls = memo(PlayerControlsImpl);

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
  },

  // ── Play button ─────────────────────────────────────────────────────────
  playCircle: {
    width: 66,
    height: 66,
    borderRadius: 33,
    justifyContent: 'center',
    alignItems: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.22,
        shadowRadius: 18,
      },
      android: { elevation: 14 },
    }),
  },
  playIconNudge: {
    marginLeft: 2,
  },

  // ── Skip buttons ─────────────────────────────────────────────────────────
  skipButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // ── Shuffle / Repeat ──────────────────────────────────────────────────────
  iconButton: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  activeDot: {
    position: 'absolute',
    bottom: -2,
    alignSelf: 'center',
    width: 5,
    height: 5,
    borderRadius: 2.5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeOne: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#FFFFFF',
  },
});
