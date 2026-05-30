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
import { LinearGradient } from 'expo-linear-gradient';
import type { RepeatModeKey } from '@/features/player/usePlayer';
import { useTheme } from '@/theme';

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
  glowColor,
  gradientColors,
}: {
  isPlaying: boolean;
  isLoading?: boolean;
  onPress: () => void;
  glowColor: string;
  gradientColors: readonly [string, string, ...string[]];
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
      {/* Arc-reactor glow ring behind the FAB */}
      <Animated.View
        style={[styles.playCircle, { shadowColor: glowColor }, animStyle]}
      >
        <LinearGradient
          colors={gradientColors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.playGradient}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color="#07090D" />
          ) : (
            <Ionicons
              name={isPlaying ? 'pause' : 'play'}
              size={31}
              color="#07090D"
              style={!isPlaying ? styles.playIconNudge : undefined}
            />
          )}
        </LinearGradient>
      </Animated.View>
    </TouchableOpacity>
  );
}

// ─── Skip button (prev / next) ─────────────────────────────────────────────

function SkipButton({
  direction,
  onPress,
  color,
}: {
  direction: 'prev' | 'next';
  onPress: () => void;
  color: string;
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
          color={color}
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
  inactiveColor,
  disabledColor,
  badgeColor,
  disabled = false,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  active: boolean;
  badge?: string;
  onPress: () => void;
  accentColor: string;
  inactiveColor: string;
  disabledColor: string;
  badgeColor: string;
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
          color={disabled ? disabledColor : active ? accentColor : inactiveColor}
        />
        <Animated.View
          style={[styles.activeDot, { backgroundColor: accentColor }, dotStyle]}
        >
          {badge ? (
            <View style={[styles.badgeOne, { backgroundColor: badgeColor }]} />
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
  accentColor,
}: PlayerControlsProps) {
  const { colors } = useTheme();
  const accent = accentColor ?? colors.accent;
  const repeatBadge = repeatMode === 'track' ? '1' : undefined;
  const repeatActive = repeatMode !== 'off';

  // Arc-reactor FAB: a glowing two-stop gradient driven by the (album-derived)
  // accent so it still tints per-track, settling into the brand cyan→blue feel.
  const playGradient: readonly [string, string] = [accent, colors.brandGradient[1]];

  return (
    <View style={styles.row}>
      {/* Shuffle */}
      <IconButton
        icon="shuffle"
        active={shuffleEnabled && false}
        onPress={onShuffle}
        accentColor={accent}
        inactiveColor={colors.textSecondary}
        disabledColor={colors.textTertiary}
        badgeColor={colors.bg}
        disabled
      />

      {/* Previous */}
      <SkipButton direction="prev" onPress={onPrevious} color={colors.textPrimary} />

      {/* Play / Pause */}
      <PlayButton
        isPlaying={isPlaying}
        isLoading={isLoading}
        onPress={onPlayPause}
        glowColor={accent}
        gradientColors={playGradient}
      />

      {/* Next */}
      <SkipButton direction="next" onPress={onNext} color={colors.textPrimary} />

      {/* Repeat */}
      <IconButton
        icon={repeatMode === 'track' ? 'repeat-outline' : 'repeat'}
        active={repeatActive}
        badge={repeatBadge}
        onPress={onRepeat}
        accentColor={accent}
        inactiveColor={colors.textSecondary}
        disabledColor={colors.textTertiary}
        badgeColor={colors.bg}
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

  // ── Play button — glowing arc-reactor FAB ─────────────────────────────────
  playCircle: {
    width: 70,
    height: 70,
    borderRadius: 35,
    ...Platform.select({
      ios: {
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.85,
        shadowRadius: 22,
      },
      android: { elevation: 16 },
    }),
  },
  playGradient: {
    width: 70,
    height: 70,
    borderRadius: 35,
    justifyContent: 'center',
    alignItems: 'center',
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
  },
});
