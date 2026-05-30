import React, { useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  Platform,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { useNavigation } from '@react-navigation/native';
import TrackPlayer, { useProgress } from 'react-native-track-player';
import * as Haptics from 'expo-haptics';
import { usePlayer, useStableActiveTrack } from '@/features/player/usePlayer';
import type { RootStackNavigationProp } from '@/types/navigation';
import { TrackArtwork } from '@/components/track/TrackArtwork';
import { useColorTheme, isDarkOrGrey } from '@/features/player/ColorTheme';
import { MarqueeText } from '@/components/ui/MarqueeText';
import { useTheme } from '@/theme';

// ─── Constants ──────────────────────────────────────────────────────────────

const MINI_PLAYER_HEIGHT = 70;
const SWIPE_UP_THRESHOLD = -40;
const SWIPE_HORIZONTAL_THRESHOLD = 60;
const SWIPE_HORIZONTAL_VELOCITY = 700;
const SPRING_CONFIG = {
  damping: 20,
  stiffness: 180,
  mass: 0.8,
};

// ─── Main Component ──────────────────────────────────────────────────────────

export function MiniPlayer() {
  const navigation = useNavigation<RootStackNavigationProp<'NowPlaying'>>();
  const { colors, isDark } = useTheme();
  // Stable subscription — does NOT tear down on each useProgress tick, so
  // PlaybackActiveTrackChanged events fired mid-render are never dropped.
  // Fixes the "MiniPlayer stuck on previous track while Library highlights
  // the new one" desync.
  const activeTrack = useStableActiveTrack();
  const progress = useProgress(250);
  const { isPlaying, togglePlayPause, skipToNext, skipToPrevious } = usePlayer();

  // Themed colours from the active track's artwork — fall back to the cyan
  // arc-reactor accent when the dominant is too dark / grey to read well.
  const themeColors = useColorTheme((s) => s.colors);
  const accent =
    !themeColors.dominant || isDarkOrGrey(themeColors.dominant)
      ? colors.accent
      : themeColors.dominant;

  // Entrance animation — slide up from below the tab bar
  const translateY = useSharedValue(MINI_PLAYER_HEIGHT + 20);
  const gestureTranslateY = useSharedValue(0);
  const gestureTranslateX = useSharedValue(0);
  const opacity = useSharedValue(0);

  // Animate in when we get an active track
  useEffect(() => {
    if (activeTrack) {
      opacity.value = withTiming(1, { duration: 200 });
      translateY.value = withSpring(0, SPRING_CONFIG);
    } else {
      opacity.value = withTiming(0, { duration: 150 });
      translateY.value = withTiming(MINI_PLAYER_HEIGHT + 20, { duration: 200 });
    }
  }, [!!activeTrack]);

  const navigateToNowPlaying = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    navigation.navigate('NowPlaying');
  }, [navigation]);

  // Play/pause press animation for the icon button.
  const playPressScale = useSharedValue(1);
  const playPressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: playPressScale.value }],
  }));

  const handlePlayPause = useCallback(() => {
    // Fire haptic at the call site so it lands immediately rather than after
    // the async TrackPlayer.play()/pause() round-trip. Medium = primary
    // transport action.
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    playPressScale.value = withSpring(0.85, { damping: 14, stiffness: 320, mass: 0.5 }, () => {
      playPressScale.value = withSpring(1, { damping: 14, stiffness: 320, mass: 0.5 });
    });
    void togglePlayPause();
  }, [togglePlayPause, playPressScale]);

  const handleSkipNext = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    void skipToNext();
  }, [skipToNext]);

  const handleSkipPrev = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    void skipToPrevious();
  }, [skipToPrevious]);

  const handleClose = useCallback(async () => {
    // Reset clears the queue, which is destructive — confirm before
    // discarding what the user is currently listening to.
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert(
      'Stop playback?',
      'This will clear the current queue.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Stop',
          style: 'destructive',
          onPress: async () => {
            try {
              await TrackPlayer.reset();
            } catch {
              // Player wasn't initialised — nothing to stop.
            }
          },
        },
      ],
      { cancelable: true },
    );
  }, []);

  // Pan gesture — vertical: swipe up to open NowPlaying; horizontal: swipe
  // left/right to skip next/prev. The dominant axis at gesture end decides
  // which action (if any) fires.
  const gestureHandler = useAnimatedGestureHandler({
    onStart: (_, ctx: { startX: number; startY: number }) => {
      ctx.startX = gestureTranslateX.value;
      ctx.startY = gestureTranslateY.value;
    },
    onActive: (event, ctx) => {
      // Track both axes; clamp upward-only on Y so a downward drag doesn't
      // tug the mini-player off the screen.
      const newY = ctx.startY + event.translationY;
      gestureTranslateY.value = Math.min(0, newY * 0.6);
      gestureTranslateX.value = (ctx.startX + event.translationX) * 0.6;
    },
    onEnd: (event) => {
      const absX = Math.abs(event.translationX);
      const absY = Math.abs(event.translationY);

      if (absY > absX) {
        // Vertical-dominant: open NowPlaying on swipe up.
        if (event.translationY < SWIPE_UP_THRESHOLD || event.velocityY < -600) {
          runOnJS(navigateToNowPlaying)();
        }
      } else if (absX > absY) {
        // Horizontal-dominant: skip prev (right swipe) / next (left swipe).
        if (
          event.translationX < -SWIPE_HORIZONTAL_THRESHOLD ||
          event.velocityX < -SWIPE_HORIZONTAL_VELOCITY
        ) {
          runOnJS(handleSkipNext)();
        } else if (
          event.translationX > SWIPE_HORIZONTAL_THRESHOLD ||
          event.velocityX > SWIPE_HORIZONTAL_VELOCITY
        ) {
          runOnJS(handleSkipPrev)();
        }
      }

      gestureTranslateY.value = withSpring(0, SPRING_CONFIG);
      gestureTranslateX.value = withSpring(0, SPRING_CONFIG);
    },
  });

  const containerAnimStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: translateY.value + gestureTranslateY.value },
      { translateX: gestureTranslateX.value },
    ],
    opacity: opacity.value,
  }));

  // Progress ratio for the thin bar
  const metadataDuration =
    typeof activeTrack?.duration === 'number' && activeTrack.duration > 0
      ? activeTrack.duration
      : 0;
  const duration = progress.duration > 0 ? progress.duration : metadataDuration;

  const progressRatio = duration > 0
    ? progress.position / duration
    : 0;

  const progressBarStyle = useAnimatedStyle(() => ({
    width: `${interpolate(
      progressRatio,
      [0, 1],
      [0, 100],
      Extrapolation.CLAMP,
    )}%` as any,
  }));

  if (!activeTrack) return null;

  return (
    // activeOffsetX/Y ensures small finger jitter on a tap doesn't get
    // misread as a swipe — fixes the "tap to play sometimes skips/opens
    // NowPlaying" feel reported on dense rows.
    <PanGestureHandler
      onGestureEvent={gestureHandler}
      activeOffsetX={[-12, 12]}
      activeOffsetY={[-12, 12]}
    >
      <Animated.View
        style={[
          styles.container,
          { borderColor: colors.borderAccent },
          containerAnimStyle,
        ]}
      >
        {/* Dark-glass base + faint album-accent wash */}
        <BlurView
          intensity={isDark ? 40 : 60}
          tint={isDark ? 'dark' : 'light'}
          style={StyleSheet.absoluteFill}
        />
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.bgElevated, opacity: isDark ? 0.82 : 0.9 }]}
        />
        <LinearGradient
          pointerEvents="none"
          colors={[`${accent}1F`, `${accent}00`]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />

        {/* Themed progress bar — sits flush at the top edge */}
        <View style={[styles.progressTrack, { backgroundColor: colors.bgRaised }]}>
          <Animated.View
            style={[styles.progressFill, { backgroundColor: accent }, progressBarStyle]}
          />
        </View>

        <Pressable style={styles.innerRow} onPress={navigateToNowPlaying}>
          {/* Artwork with subtle accent-color gradient corner overlay so the
              artwork visually ties into the rest of the mini-player tint. */}
          <View style={styles.artworkWrap}>
            <TrackArtwork
              uri={activeTrack.artwork ?? null}
              blurhash={null}
              size={48}
              borderRadius={8}
            />
            <LinearGradient
              pointerEvents="none"
              colors={[`${accent}00`, `${accent}33`]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.artworkOverlay}
            />
          </View>

          {/* Track info */}
          <View style={styles.info}>
            <MarqueeText style={[styles.title, { color: colors.textPrimary }]}>
              {activeTrack.title ?? 'Unknown Title'}
            </MarqueeText>
            <Text style={[styles.artist, { color: colors.textSecondary }]} numberOfLines={1}>
              {activeTrack.artist ?? 'Unknown Artist'}
            </Text>
          </View>

          {/* Controls */}
          <View style={styles.controls}>
            <TouchableOpacity
              onPress={handlePlayPause}
              style={styles.playButton}
              hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
              accessibilityLabel={isPlaying ? 'Pause current song' : 'Play current song'}
              accessibilityRole="button"
            >
              <Animated.View style={playPressStyle}>
                <Ionicons
                  name={isPlaying ? 'pause' : 'play'}
                  size={22}
                  color={accent}
                  style={!isPlaying ? styles.playIconNudge : undefined}
                />
              </Animated.View>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleSkipNext}
              style={styles.skipButton}
              hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
              accessibilityLabel="Skip to next song"
              accessibilityRole="button"
            >
              <Ionicons name="play-skip-forward" size={22} color={colors.textPrimary} />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleClose}
              style={styles.closeButton}
              hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
              accessibilityLabel="Stop playback and close mini player"
              accessibilityRole="button"
            >
              <Ionicons name="close" size={20} color={colors.textTertiary} />
            </TouchableOpacity>
          </View>
        </Pressable>
      </Animated.View>
    </PanGestureHandler>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    height: MINI_PLAYER_HEIGHT,
    // Round only the top corners — bottom edge is flush against the tab bar.
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    marginHorizontal: 16,
    marginBottom: 0,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.35,
        shadowRadius: 16,
      },
      android: { elevation: 12 },
    }),
  },
  progressTrack: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    zIndex: 2,
  },
  progressFill: {
    height: 2,
  },
  innerRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 2, // offset for the 2px progress bar
    gap: 12,
    zIndex: 1,
  },
  artworkWrap: {
    width: 48,
    height: 48,
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative',
  },
  artworkOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 8,
  },
  info: {
    flex: 1,
    justifyContent: 'center',
    gap: 2,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: -0.1,
  },
  artist: {
    fontSize: 12,
    fontWeight: '400',
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  playButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playIconNudge: {
    marginLeft: 2,
  },
  skipButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 2,
  },
});
