import React, { useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import FastImage, { type Source as FastImageSource } from 'react-native-fast-image';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { MotiView } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import type { YouTubeSearchResult } from '@/types/track';
import { useDownloadStore } from '@/stores/downloadStore';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SongDiscoveryCardProps {
  result: YouTubeSearchResult;
  onDownload: (id: string, title: string, author: string, thumbnail: string, durationMs: number) => void;
  /**
   * Skip handler — receives the videoId so the parent can hand in a
   * referentially-stable callback (useCallback) instead of allocating
   * a per-row arrow on every render. The card calls onSkip(result.id)
   * internally.
   */
  onSkip: (videoId: string) => void;
  /**
   * Optional one-liner explaining why this song was suggested
   * (e.g. "Because you've been playing Arijit Singh"). When provided, a small
   * caption row is rendered beneath the artist name.
   */
  rationale?: string;
  /**
   * Optional pre-formatted size string (e.g. "9 MB") shown alongside the
   * rationale when provided. Both props are independently optional.
   */
  estimatedSizeReadable?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (!ms || ms <= 0) return '';
  const totalSec = Math.floor(ms / 1000);
  const min     = Math.floor(totalSec / 60);
  const sec     = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

// ─── Circular progress indicator ─────────────────────────────────────────────

interface CircularProgressProps {
  progress: number; // 0–100
}

function CircularProgress({ progress }: CircularProgressProps) {
  const clamped = Math.max(0, Math.min(100, progress));
  const radius  = 14;
  const stroke  = 2.5;
  void (radius - stroke); // normalizedRadius unused — kept for future SVG ring

  return (
    <View style={circleStyles.wrapper}>
      {/* Background track */}
      <View style={circleStyles.track} />
      {/* SVG-less approximation using a rotated border arc */}
      <View style={[circleStyles.arc, { borderTopColor: '#FA233B' }]} />
      <Text style={circleStyles.label}>{Math.round(clamped)}%</Text>
    </View>
  );
}

const circleStyles = StyleSheet.create({
  wrapper: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  track: {
    position: 'absolute',
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2.5,
    borderColor: '#D2D2D7',
  },
  arc: {
    position: 'absolute',
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2.5,
    borderColor: 'transparent',
    borderTopColor: '#FA233B',
    transform: [{ rotate: '45deg' }],
  },
  label: {
    fontSize: 8,
    fontWeight: '700',
    color: '#FA233B',
    lineHeight: 10,
    textAlign: 'center',
  },
});

// ─── Animated download button ─────────────────────────────────────────────────

interface DownloadButtonProps {
  onPress: () => void;
}

function DownloadButton({ onPress }: DownloadButtonProps) {
  const scale = useSharedValue(1);

  const handlePressIn  = useCallback(() => {
    scale.value = withTiming(0.88, { duration: 80 });
  }, [scale]);

  const handlePressOut = useCallback(() => {
    scale.value = withTiming(1, { duration: 120 });
  }, [scale]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <TouchableOpacity
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      activeOpacity={1}
      hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
      accessibilityLabel="Download at 320k"
      accessibilityRole="button"
    >
      <Animated.View style={[btnStyles.downloadBtn, animStyle]}>
        <Ionicons name="arrow-down" size={14} color="#FFFFFF" />
        <Text style={btnStyles.downloadLabel}>320k</Text>
      </Animated.View>
    </TouchableOpacity>
  );
}

const btnStyles = StyleSheet.create({
  downloadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#FA233B',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    ...Platform.select({
      ios: {
        shadowColor: '#FA233B',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.35,
        shadowRadius: 8,
      },
      android: { elevation: 4 },
    }),
  },
  downloadLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.3,
    lineHeight: 16,
  },
});

// ─── Component ────────────────────────────────────────────────────────────────

function SongDiscoveryCardImpl({
  result,
  onDownload,
  onSkip,
  rationale,
  estimatedSizeReadable,
}: SongDiscoveryCardProps) {
  // Self-subscribe to this card's own download status (if any). When the
  // parent renders 12 cards, each card only re-renders when its OWN row
  // in the download queue changes — progress on card A no longer
  // re-renders cards B-L. Previously the parent recomputed a
  // `queueByYtId` Map 4×/sec and passed `downloadStatus`/`downloadProgress`
  // props in, which forced every card to re-render every tick during a
  // download, which on heavy scroll was enough to crash the JS↔native
  // bridge.
  const videoId = result.id;
  const queueRow = useDownloadStore(
    useCallback((s) => s.queue.find((q) => q.youtubeId === videoId), [videoId]),
  );
  const downloadStatus: 'idle' | 'downloading' | 'done' =
    queueRow?.status === 'done'
      ? 'done'
      : queueRow
        ? 'downloading'
        : 'idle';
  const downloadProgress = queueRow?.progress ?? 0;

  const isIdle        = downloadStatus === 'idle';
  const isDownloading = downloadStatus === 'downloading';
  const isDone        = downloadStatus === 'done';

  const handleDownload = useCallback(() => {
    if (!isIdle) return;
    onDownload(result.id, result.title, result.author, result.thumbnail, result.duration_ms);
  }, [isIdle, result, onDownload]);

  // Bind the videoId locally so the TouchableOpacity gets a stable
  // function reference that doesn't change across re-renders.
  const handleSkip = useCallback(() => {
    onSkip(result.id);
  }, [result.id, onSkip]);

  // Memoize the FastImage source — without this, the source object is a
  // new reference every render and FastImage re-walks its native cache.
  const fastImageSource: FastImageSource | null = useMemo(() => {
    if (!result.thumbnail) return null;
    return {
      uri: result.thumbnail,
      priority: FastImage.priority.normal,
      cache: FastImage.cacheControl.immutable,
    };
  }, [result.thumbnail]);

  const durationStr = formatDuration(result.duration_ms);

  return (
    <MotiView
      from={{ opacity: 0, translateY: 12 }}
      animate={{ opacity: 1, translateY: 0 }}
      exit={{ opacity: 0, scale: 0.94 }}
      transition={{ type: 'timing', duration: 280 }}
      style={styles.card}
    >
      {/* Thumbnail */}
      <View style={styles.thumbnailWrapper}>
        {fastImageSource ? (
          <FastImage
            source={fastImageSource}
            style={styles.thumbnail}
            resizeMode={FastImage.resizeMode.cover}
          />
        ) : (
          <View style={[styles.thumbnail, styles.thumbnailFallback]}>
            <Ionicons name="musical-notes" size={24} color="#FA233B" />
          </View>
        )}

        {/* Duration badge */}
        {durationStr ? (
          <View style={styles.durationBadge}>
            <Text style={styles.durationText}>{durationStr}</Text>
          </View>
        ) : null}
      </View>

      {/* Metadata */}
      <View style={styles.meta}>
        <Text style={styles.title} numberOfLines={2}>
          {result.title}
        </Text>
        <Text style={styles.author} numberOfLines={1}>
          {result.author}
        </Text>

        {/* Optional rationale + size caption row (rendered when supplied) */}
        {(rationale || estimatedSizeReadable) ? (
          <View style={styles.captionRow}>
            {rationale ? (
              <Text style={styles.rationale} numberOfLines={1}>
                {rationale}
              </Text>
            ) : null}
            {rationale && estimatedSizeReadable ? (
              <Text style={styles.captionDot}>·</Text>
            ) : null}
            {estimatedSizeReadable ? (
              <Text style={styles.sizeText} numberOfLines={1}>
                ≈ {estimatedSizeReadable}
              </Text>
            ) : null}
          </View>
        ) : null}

        {result.view_count ? (
          <Text style={styles.views} numberOfLines={1}>
            {result.view_count}
          </Text>
        ) : null}

        {/* Inline downloading progress bar */}
        {isDownloading && (
          <View style={styles.inlineProgressTrack}>
            <MotiView
              animate={{ width: `${downloadProgress}%` as any }}
              transition={{ type: 'timing', duration: 350 }}
              style={styles.inlineProgressFill}
            />
          </View>
        )}

        {isDone && (
          <Text style={styles.doneText}>In library</Text>
        )}
      </View>

      {/* Right action column */}
      <View style={styles.actions}>
        {isIdle && (
          <>
            <DownloadButton onPress={handleDownload} />
            <TouchableOpacity
              onPress={handleSkip}
              style={styles.skipButton}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel="Skip this song"
              accessibilityRole="button"
            >
              <Text style={styles.skipText}>Skip</Text>
            </TouchableOpacity>
          </>
        )}

        {isDownloading && (
          <CircularProgress progress={downloadProgress} />
        )}

        {isDone && (
          <View style={styles.doneCircle}>
            <Ionicons name="checkmark" size={18} color="#34C759" />
          </View>
        )}
      </View>
    </MotiView>
  );
}

// React.memo so the card skips re-renders when ONLY-other rows in the
// download queue update. Equality compares the things the parent passes
// in (result.id is the stable identity; the others are referentially
// stable thanks to useCallback in the parent + the dropped status props).
export const SongDiscoveryCard = React.memo(
  SongDiscoveryCardImpl,
  (prev, next) =>
    prev.result.id === next.result.id &&
    prev.onDownload === next.onDownload &&
    prev.onSkip === next.onSkip &&
    prev.rationale === next.rationale &&
    prev.estimatedSizeReadable === next.estimatedSizeReadable,
);

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#F2F2F7',
    borderRadius: 12,
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 12,
    gap: 12,
    borderWidth: 1,
    borderColor: '#D2D2D7',
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.5,
        shadowRadius: 10,
      },
      android: { elevation: 4 },
    }),
  },

  // Thumbnail
  thumbnailWrapper: {
    position: 'relative',
    flexShrink: 0,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
  },
  thumbnail: {
    width: 80,
    height: 60,
    borderRadius: 8,
  },
  thumbnailFallback: {
    backgroundColor: '#D2D2D7',
    justifyContent: 'center',
    alignItems: 'center',
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
  durationText: {
    fontSize: 9,
    fontWeight: '600',
    color: '#1D1D1F',
    lineHeight: 12,
  },

  // Metadata
  meta: {
    flex: 1,
    justifyContent: 'flex-start',
    gap: 2,
    paddingTop: 1,
  },
  title: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1D1D1F',
    lineHeight: 18,
    letterSpacing: -0.1,
  },
  author: {
    fontSize: 11,
    fontWeight: '400',
    color: '#6E6E73',
    marginTop: 1,
  },
  views: {
    fontSize: 10,
    fontWeight: '400',
    color: '#8E8E93',
  },
  captionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 3,
    flexWrap: 'wrap',
  },
  rationale: {
    fontSize: 10,
    fontWeight: '600',
    color: '#FA233B',
    letterSpacing: 0.1,
    flexShrink: 1,
  },
  captionDot: {
    fontSize: 10,
    color: '#8E8E93',
    fontWeight: '600',
  },
  sizeText: {
    fontSize: 10,
    fontWeight: '500',
    color: '#6E6E73',
    letterSpacing: 0.1,
  },
  inlineProgressTrack: {
    height: 2,
    backgroundColor: '#D2D2D7',
    borderRadius: 1,
    marginTop: 6,
    overflow: 'hidden',
  },
  inlineProgressFill: {
    height: 2,
    backgroundColor: '#FA233B',
    borderRadius: 1,
  },
  doneText: {
    fontSize: 11,
    fontWeight: '500',
    color: '#27AE60',
    marginTop: 5,
  },

  // Actions
  actions: {
    alignItems: 'center',
    gap: 8,
    justifyContent: 'flex-start',
    paddingTop: 2,
    flexShrink: 0,
  },
  skipButton: {
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  skipText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#8E8E93',
  },
  doneCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(39,174,96,0.18)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
