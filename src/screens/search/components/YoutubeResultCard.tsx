import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
} from 'react-native';
import FastImage from 'react-native-fast-image';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import type { YouTubeSearchResult } from '@/types/track';

// ─── Types ────────────────────────────────────────────────────────────────────

interface YoutubeResultCardProps {
  result: YouTubeSearchResult;
  onDownload: (id: string, title: string, artist: string, thumbnail: string) => void;
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
  return (
    <View style={progressStyles.track}>
      <View style={[progressStyles.fill, { width: `${progress}%` }]} />
    </View>
  );
}

const progressStyles = StyleSheet.create({
  track: {
    height: 2,
    backgroundColor: '#D2D2D7',
    borderRadius: 1,
    marginTop: 6,
    overflow: 'hidden',
  },
  fill: {
    height: 2,
    backgroundColor: '#FA233B',
    borderRadius: 1,
  },
});

// ─── Component ────────────────────────────────────────────────────────────────

export function YoutubeResultCard({
  result,
  onDownload,
  downloadProgress,
}: YoutubeResultCardProps) {
  const isDownloading =
    downloadProgress !== undefined && downloadProgress < 100;
  const isDone = downloadProgress === 100;

  const scaleAnim = useSharedValue(1);

  const handleDownloadPress = useCallback(() => {
    if (isDownloading || isDone) return;
    const { artist, trackTitle } = parseArtistTitle(result.title);
    onDownload(result.id, trackTitle || result.title, artist || result.author, result.thumbnail);
  }, [result, onDownload, isDownloading, isDone]);

  const animatedButtonStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scaleAnim.value }],
  }));

  const handlePressIn = useCallback(() => {
    scaleAnim.value = withTiming(0.88, { duration: 80 });
  }, [scaleAnim]);

  const handlePressOut = useCallback(() => {
    scaleAnim.value = withTiming(1, { duration: 120 });
  }, [scaleAnim]);

  return (
    <View style={styles.container}>
      {/* Thumbnail */}
      <View style={styles.thumbnailContainer}>
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
        <Text style={styles.title} numberOfLines={2}>
          {result.title}
        </Text>
        <Text style={styles.channel} numberOfLines={1}>
          {result.author}
        </Text>
        {result.view_count ? (
          <Text style={styles.views} numberOfLines={1}>
            {result.view_count}
          </Text>
        ) : null}

        {/* Download progress bar */}
        {isDownloading && (
          <ProgressBar progress={downloadProgress!} />
        )}
        {isDone && (
          <Text style={styles.doneLabel}>In library</Text>
        )}
      </View>

      {/* Download button */}
      <Pressable
        onPress={handleDownloadPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={isDownloading || isDone}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Animated.View style={[styles.downloadButton, animatedButtonStyle]}>
          {isDone ? (
            <Ionicons name="checkmark" size={18} color="#FFFFFF" />
          ) : isDownloading ? (
            <Text style={[styles.downloadIcon, styles.downloadingIcon]}>
              {Math.round(downloadProgress!)}%
            </Text>
          ) : (
            <Ionicons name="arrow-down" size={18} color="#FFFFFF" />
          )}
        </Animated.View>
      </Pressable>
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
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#F2F2F7',
    flexShrink: 0,
  },
  thumbnail: {
    width: 100,
    height: 70,
    borderRadius: 8,
  },
  durationBadge: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.82)',
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  durationBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  meta: {
    flex: 1,
    justifyContent: 'center',
    gap: 2,
  },
  title: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1D1D1F',
    lineHeight: 18,
  },
  channel: {
    fontSize: 12,
    fontWeight: '400',
    color: '#6E6E73',
    marginTop: 2,
  },
  views: {
    fontSize: 11,
    color: '#8E8E93',
  },
  doneLabel: {
    fontSize: 11,
    color: '#FA233B',
    fontWeight: '500',
    marginTop: 4,
  },
  downloadButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FA233B',
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  downloadIcon: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    lineHeight: 22,
  },
  downloadingIcon: {
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 12,
  },
});
