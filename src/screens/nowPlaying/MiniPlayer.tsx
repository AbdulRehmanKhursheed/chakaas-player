import React, { useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  Platform,
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
  Easing,
} from 'react-native-reanimated';
import { PanGestureHandler } from 'react-native-gesture-handler';
import { useNavigation } from '@react-navigation/native';
import { useActiveTrack, useProgress } from 'react-native-track-player';
import * as Haptics from 'expo-haptics';
import { usePlayer } from '@/features/player/usePlayer';
import type { RootStackNavigationProp } from '@/types/navigation';
import { TrackArtwork } from '@/components/track/TrackArtwork';

// ─── Constants ──────────────────────────────────────────────────────────────

const MINI_PLAYER_HEIGHT = 70;
const SWIPE_UP_THRESHOLD = -40;
const SPRING_CONFIG = {
  damping: 20,
  stiffness: 180,
  mass: 0.8,
};

// ─── Marquee Text ────────────────────────────────────────────────────────────

interface MarqueeTextProps {
  text: string;
  style: object;
}

function MarqueeText({ text, style }: MarqueeTextProps) {
  const offset = useSharedValue(0);
  const containerWidth = useSharedValue(0);
  const textWidth = useSharedValue(0);

  useEffect(() => {
    if (textWidth.value > containerWidth.value && containerWidth.value > 0) {
      const distance = textWidth.value - containerWidth.value + 16;
      const duration = distance * 22;

      const animate = () => {
        offset.value = withTiming(-distance, {
          duration,
          easing: Easing.linear,
        }, (finished) => {
          if (finished) {
            offset.value = withTiming(0, { duration: 600 }, (done) => {
              if (done) animate();
            });
          }
        });
      };

      const timer = setTimeout(animate, 1200);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [text]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.value }],
  }));

  return (
    <View
      style={{ overflow: 'hidden', flex: 1 }}
      onLayout={(e) => { containerWidth.value = e.nativeEvent.layout.width; }}
    >
      <Animated.Text
        style={[style, animStyle]}
        numberOfLines={1}
        onLayout={(e) => { textWidth.value = e.nativeEvent.layout.width; }}
      >
        {text}
      </Animated.Text>
    </View>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function MiniPlayer() {
  const navigation = useNavigation<RootStackNavigationProp<'NowPlaying'>>();
  const activeTrack = useActiveTrack();
  const progress = useProgress(250);
  const { isPlaying, togglePlayPause, skipToNext } = usePlayer();

  // Entrance animation — slide up from below the tab bar
  const translateY = useSharedValue(MINI_PLAYER_HEIGHT + 20);
  const gestureTranslateY = useSharedValue(0);
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

  const handlePlayPause = useCallback(() => {
    togglePlayPause();
  }, [togglePlayPause]);

  const handleSkipNext = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    skipToNext();
  }, [skipToNext]);

  // Pan gesture — swipe up to open NowPlaying, swipe down to bounce back
  const gestureHandler = useAnimatedGestureHandler({
    onStart: (_, ctx: { startY: number }) => {
      ctx.startY = gestureTranslateY.value;
    },
    onActive: (event, ctx) => {
      // Only allow upward swipe
      const newValue = ctx.startY + event.translationY;
      gestureTranslateY.value = Math.min(0, newValue * 0.6);
    },
    onEnd: (event) => {
      if (event.translationY < SWIPE_UP_THRESHOLD || event.velocityY < -600) {
        runOnJS(navigateToNowPlaying)();
        gestureTranslateY.value = withSpring(0, SPRING_CONFIG);
      } else {
        gestureTranslateY.value = withSpring(0, SPRING_CONFIG);
      }
    },
  });

  const containerAnimStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: translateY.value + gestureTranslateY.value },
    ],
    opacity: opacity.value,
  }));

  // Progress ratio for the thin bar
  const progressRatio = progress.duration > 0
    ? progress.position / progress.duration
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
    <PanGestureHandler onGestureEvent={gestureHandler}>
      <Animated.View style={[styles.container, containerAnimStyle]}>
        {/* Progress bar — sits flush at the top edge */}
        <View style={styles.progressTrack}>
          <Animated.View style={[styles.progressFill, progressBarStyle]} />
        </View>

        <Pressable style={styles.innerRow} onPress={navigateToNowPlaying}>
          {/* Artwork */}
          <TrackArtwork
            uri={activeTrack.artwork ?? null}
            blurhash={null}
            size={48}
            borderRadius={8}
          />

          {/* Track info */}
          <View style={styles.info}>
            <MarqueeText
              text={activeTrack.title ?? 'Unknown Title'}
              style={styles.title}
            />
            <Text style={styles.artist} numberOfLines={1}>
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
              <Ionicons
                name={isPlaying ? 'pause' : 'play'}
                size={22}
                color="#FA233B"
                style={!isPlaying ? styles.playIconNudge : undefined}
              />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleSkipNext}
              style={styles.skipButton}
              hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
              accessibilityLabel="Skip to next song"
              accessibilityRole="button"
            >
              <Ionicons name="play-skip-forward" size={22} color="#3A3A3C" />
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
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    marginHorizontal: 12,
    marginBottom: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(60,60,67,0.12)',
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.12,
        shadowRadius: 18,
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
    backgroundColor: '#E5E5EA',
  },
  progressFill: {
    height: 2,
    backgroundColor: '#FA233B',
  },
  innerRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 2, // offset for the 2px progress bar
    gap: 12,
  },
  info: {
    flex: 1,
    justifyContent: 'center',
    gap: 2,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1D1D1F',
    letterSpacing: -0.1,
  },
  artist: {
    fontSize: 12,
    fontWeight: '400',
    color: '#6E6E73',
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
});
