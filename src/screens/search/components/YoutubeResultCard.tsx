import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import FastImage from 'react-native-fast-image';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme';
import type { YouTubeSearchResult } from '@/types/track';

// ─── Types ────────────────────────────────────────────────────────────────────

interface YoutubeResultCardProps {
  result: YouTubeSearchResult;
  onDownload: (id: string, title: string, artist: string, thumbnail: string) => void;
  /**
   * Tapping the play button triggers a transient stream (no download). When
   * omitted, the play button is hidden — keeps the component back-compatible
   * for callers that only want download UX.
   */
  onStream?: (result: YouTubeSearchResult) => void;
  /** Show a spinner on the play button while the stream URL is resolving. */
  isStreamLoading?: boolean;
  downloadProgress?: number; // 0-100, undefined = not downloading
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

function parseArtistTitle(title: string): { artist: string; trackTitle: string } {
  // Try "Artist - Title" pattern
  const dashIdx = title.indexOf(' - ');
  if (dashIdx > 0) {
    return {
      artist: title.substring(0, dashIdx).trim(),
      trackTitle: title.substring(dashIdx + 3).trim(),
    };
  }
  return { artist: '', trackTitle: title };
}

// ─── Download progress indicator ──────────────────────────────────────────────

interface ProgressBarProps {
  progress: number; // 0-100
}

function ProgressBar({ progress }: ProgressBarProps) {
  const { colors } = useTheme();
  return (
    <View style={[progressStyles.track, { backgroundColor: colors.bgRaised }]}>
      <View
        style={[progressStyles.fill, { width: `${progress}%`, backgroundColor: colors.accent }]}
      />
    </View>
  );
}

const progressStyles = StyleSheet.create({
  track: {
    height: 2,
    borderRadius: 1,
    marginTop: 6,
    overflow: 'hidden',
  },
  fill: {
    height: 2,
    borderRadius: 1,
  },
});

// ─── Component ────────────────────────────────────────────────────────────────

export function YoutubeResultCard({
  result,
  onDownload,
  onStream,
  isStreamLoading = false,
  downloadProgress,
}: YoutubeResultCardProps) {
  const { colors } = useTheme();
  const isDownloading =
    downloadProgress !== undefined && downloadProgress < 100;
  const isDone = downloadProgress === 100;

  // Show views for YouTube rows and the album for Saavn rows. The Saavn
  // provider stopped overloading `view_count` to mean album, so we read the
  // dedicated `saavnAlbum` field here instead.
  const subtitle =
    (result.provider ?? 'youtube') === 'saavn'
      ? result.saavnAlbum ?? ''
      : result.view_count;

  const scaleAnim = useSharedValue(1);
  const playScaleAnim = useSharedValue(1);

  const handleDownloadPress = useCallback(() => {
    if (isDownloading || isDone) return;
    const { artist, trackTitle } = parseArtistTitle(result.title);
    onDownload(result.id, trackTitle || result.title, artist || result.author, result.thumbnail);
  }, [result, onDownload, isDownloading, isDone]);

  const handleStreamPress = useCallback(() => {
    if (isStreamLoading || !onStream) return;
    onStream(result);
  }, [result, onStream, isStreamLoading]);

  const animatedButtonStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scaleAnim.value }],
  }));

  const animatedPlayStyle = useAnimatedStyle(() => ({
    transform: [{ scale: playScaleAnim.value }],
  }));

  const handlePressIn = useCallback(() => {
    scaleAnim.value = withTiming(0.88, { duration: 80 });
  }, [scaleAnim]);

  const handlePressOut = useCallback(() => {
    scaleAnim.value = withTiming(1, { duration: 120 });
  }, [scaleAnim]);

  const handlePlayPressIn = useCallback(() => {
    playScaleAnim.value = withTiming(0.88, { duration: 80 });
  }, [playScaleAnim]);

  const handlePlayPressOut = useCallback(() => {
    playScaleAnim.value = withTiming(1, { duration: 120 });
  }, [playScaleAnim]);

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      {/* Thumbnail — large edge-to-edge artwork */}
      <View style={[styles.thumbnailContainer, { backgroundColor: colors.bgRaised, borderColor: colors.border }]}>
        <FastImage
          source={{
            uri: result.thumbnail,
            priority: FastImage.priority.low,
            cache: FastImage.cacheControl.immutable,
          }}
          style={styles.thumbnail}
          resizeMode={FastImage.resizeMode.cover}
        />
        {/* Duration badge */}
        {result.duration_ms > 0 && (
          <View style={styles.durationBadge}>
            <Text style={styles.durationBadgeText}>
              {formatDuration(result.duration_ms)}
            </Text>
          </View>
        )}
      </View>

      {/* Metadata */}
      <View style={styles.meta}>
        <Text style={[styles.title, { color: colors.textPrimary }]} numberOfLines={2}>
          {result.title}
        </Text>
        <Text style={[styles.channel, { color: colors.textSecondary }]} numberOfLines={1}>
          {result.author}
        </Text>
        {subtitle ? (
          <Text style={[styles.views, { color: colors.textTertiary }]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}

        {/* Download progress bar */}
        {isDownloading && (
          <ProgressBar progress={downloadProgress!} />
        )}
        {isDone && (
          <Text style={[styles.doneLabel, { color: colors.accent }]}>In library</Text>
        )}
      </View>

      {/* Action buttons */}
      <View style={styles.actions}>
        {/* Stream/play button — transient playback, no download. Glowing cyan
            arc-reactor control. */}
        {onStream && !isDone && (
          <Pressable
            onPress={handleStreamPress}
            onPressIn={handlePlayPressIn}
            onPressOut={handlePlayPressOut}
            disabled={isStreamLoading}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Animated.View
              style={[
                styles.playButton,
                {
                  borderColor: colors.borderAccent,
                  shadowColor: colors.accent,
                },
                animatedPlayStyle,
              ]}
            >
              <LinearGradient
                colors={colors.brandGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
              {isStreamLoading ? (
                <ActivityIndicator size="small" color="#07090D" />
              ) : (
                <Ionicons name="play" size={16} color="#07090D" style={styles.playIcon} />
              )}
            </Animated.View>
          </Pressable>
        )}

        {/* Download button */}
        <Pressable
          onPress={handleDownloadPress}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          disabled={isDownloading || isDone}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Animated.View
            style={[
              styles.downloadButton,
              {
                backgroundColor: isDone ? colors.accentMuted : colors.bgRaised,
                borderColor: isDone ? colors.borderAccent : colors.border,
              },
              animatedButtonStyle,
            ]}
          >
            {isDone ? (
              <Ionicons name="checkmark" size={18} color={colors.accent} />
            ) : isDownloading ? (
              <Text style={[styles.downloadIcon, styles.downloadingIcon, { color: colors.accent }]}>
                {Math.round(downloadProgress!)}%
              </Text>
            ) : (
              <Ionicons name="arrow-down" size={18} color={colors.textPrimary} />
            )}
          </Animated.View>
        </Pressable>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    gap: 12,
  },
  thumbnailContainer: {
    position: 'relative',
    borderRadius: 12,
    overflow: 'hidden',
    flexShrink: 0,
    borderWidth: StyleSheet.hairlineWidth,
  },
  thumbnail: {
    width: 100,
    height: 70,
    borderRadius: 12,
  },
  durationBadge: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: 'rgba(3,5,8,0.78)',
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  durationBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#EAF6FF',
  },
  meta: {
    flex: 1,
    justifyContent: 'center',
    gap: 2,
  },
  title: {
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  channel: {
    fontSize: 12,
    fontWeight: '400',
    marginTop: 2,
  },
  views: {
    fontSize: 11,
  },
  doneLabel: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 4,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  playButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    // Soft cyan glow on the primary play control.
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius: 8,
    elevation: 4,
  },
  playIcon: {
    // Optical centering — the Ionicons play glyph has empty space on its left.
    marginLeft: 2,
  },
  downloadButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
    borderWidth: StyleSheet.hairlineWidth,
  },
  downloadIcon: {
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 22,
  },
  downloadingIcon: {
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 12,
  },
});
