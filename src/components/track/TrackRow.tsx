import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TouchableOpacity,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  withSequence,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import type { Track } from '@/types/track';
import { useTheme } from '@/theme';
import { TrackArtwork } from './TrackArtwork';

// ─── Playing Indicator ───────────────────────────────────────────────────────

function PlayingIndicator() {
  const { colors } = useTheme();
  const bar1 = useSharedValue(0.4);
  const bar2 = useSharedValue(0.7);
  const bar3 = useSharedValue(0.5);

  React.useEffect(() => {
    const animate = (sv: Animated.SharedValue<number>, delay: number, min: number, max: number) => {
      const loop = () => {
        sv.value = withSequence(
          withTiming(max, { duration: 300 + delay }),
          withTiming(min, { duration: 300 + delay * 0.5 }, loop),
        );
      };
      const t = setTimeout(loop, delay);
      return () => clearTimeout(t);
    };

    const c1 = animate(bar1, 0, 0.25, 1.0);
    const c2 = animate(bar2, 150, 0.3, 0.9);
    const c3 = animate(bar3, 80, 0.2, 0.85);

    return () => {
      c1();
      c2();
      c3();
    };
  }, []);

  const bar1Style = useAnimatedStyle(() => ({ transform: [{ scaleY: bar1.value }] }));
  const bar2Style = useAnimatedStyle(() => ({ transform: [{ scaleY: bar2.value }] }));
  const bar3Style = useAnimatedStyle(() => ({ transform: [{ scaleY: bar3.value }] }));

  return (
    <View style={indicatorStyles.container}>
      <Animated.View style={[indicatorStyles.bar, { backgroundColor: colors.accent }, bar1Style]} />
      <Animated.View style={[indicatorStyles.bar, { backgroundColor: colors.accent }, bar2Style]} />
      <Animated.View style={[indicatorStyles.bar, { backgroundColor: colors.accent }, bar3Style]} />
    </View>
  );
}

const indicatorStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    height: 14,
    width: 18,
  },
  bar: {
    width: 3,
    height: 14,
    borderRadius: 1.5,
    transformOrigin: 'bottom',
  },
});

// ─── Duration formatter ──────────────────────────────────────────────────────

function formatDuration(ms: number | null | undefined): string {
  if (!ms || !Number.isFinite(ms) || ms <= 0) return '--:--';
  const totalSec = Math.round(ms / 1000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface TrackRowProps {
  track: Track;
  isPlaying?: boolean;
  onPress: () => void;
  onLongPress: () => void;
  showArtwork?: boolean;
}

// ─── Component ───────────────────────────────────────────────────────────────

function TrackRowImpl({
  track,
  isPlaying = false,
  onPress,
  onLongPress,
  showArtwork = true,
}: TrackRowProps) {
  const { colors } = useTheme();
  const scale = useSharedValue(1);
  const bgOpacity = useSharedValue(0);

  const handlePressIn = useCallback(() => {
    scale.value = withSpring(0.97, { damping: 20, stiffness: 300 });
    bgOpacity.value = withTiming(1, { duration: 80 });
  }, []);

  const handlePressOut = useCallback(() => {
    scale.value = withSpring(1, { damping: 20, stiffness: 300 });
    bgOpacity.value = withTiming(0, { duration: 200 });
  }, []);

  const handleLongPress = useCallback(() => {
    // Fire-and-forget — expo-haptics returns a Promise we intentionally
    // don't await, and we never want a missing native module on an older
    // device to crash the press handler.
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {
      // ignore
    }
    onLongPress();
  }, [onLongPress]);

  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: bgOpacity.value,
  }));

  const artworkUri = track.artwork_path;

  return (
    <Animated.View style={[styles.container, rowStyle]}>
      {/* Pressed-state highlight — raised surface tile on the dark canvas. */}
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          styles.pressOverlay,
          { backgroundColor: colors.bgRaised },
          overlayStyle,
        ]}
      />

      <Pressable
        style={styles.pressable}
        onPress={onPress}
        onLongPress={handleLongPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        delayLongPress={350}
        accessibilityRole="button"
        accessibilityLabel={`${track.title} by ${track.artist}`}
        accessibilityState={{ selected: isPlaying }}
      >
        {/* Artwork */}
        {showArtwork && (
          <View style={styles.artworkWrapper}>
            <TrackArtwork
              uri={artworkUri}
              blurhash={null}
              size={56}
              borderRadius={12}
            />
            {/* Currently-playing overlay on artwork */}
            {isPlaying && (
              <View style={styles.artworkPlayingOverlay}>
                <PlayingIndicator />
              </View>
            )}
          </View>
        )}

        {/* Track info */}
        <View style={styles.info}>
          <View style={styles.titleRow}>
            <Text
              style={[
                styles.title,
                { color: isPlaying ? colors.accent : colors.textPrimary },
              ]}
              numberOfLines={1}
            >
              {track.title}
            </Text>
            {track.liked && (
              <Ionicons name="heart" size={13} color={colors.accent} />
            )}
          </View>
          <Text style={[styles.meta, { color: colors.textSecondary }]} numberOfLines={1}>
            {track.artist}
            {track.album ? ` · ${track.album}` : ''}
          </Text>
        </View>

        {/* Right side */}
        <View style={styles.right}>
          <Text style={[styles.duration, { color: colors.textTertiary }]}>
            {formatDuration(track.duration_ms)}
          </Text>
          <TouchableOpacity
            style={styles.menuButton}
            onPress={handleLongPress}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 4 }}
            accessibilityRole="button"
            accessibilityLabel="More options"
          >
            <Ionicons name="ellipsis-vertical" size={17} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
      </Pressable>
    </Animated.View>
  );
}

// Memoised so reordering / unrelated parent renders don't bounce every row
// in a long list. The default shallow compare is what we want: parent
// passes new `onPress` callbacks via stable `useCallback`, so identity is
// preserved across renders that don't actually affect this row.
export const TrackRow = React.memo(TrackRowImpl);

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    height: 72,
    position: 'relative',
  },
  pressOverlay: {
    borderRadius: 12,
    zIndex: 0,
  },
  pressable: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 12,
    zIndex: 1,
  },
  artworkWrapper: {
    position: 'relative',
  },
  artworkPlayingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(3,5,8,0.62)',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  info: {
    flex: 1,
    justifyContent: 'center',
    gap: 3,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
    letterSpacing: -0.1,
  },
  meta: {
    fontSize: 12,
    fontWeight: '400',
  },
  right: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 6,
  },
  duration: {
    fontSize: 11,
    fontWeight: '400',
    fontVariant: ['tabular-nums'],
  },
  menuButton: {
    justifyContent: 'center',
    alignItems: 'center',
  },
});
