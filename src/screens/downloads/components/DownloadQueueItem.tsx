import React, { useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import FastImage from 'react-native-fast-image';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { MotiView } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import type { DownloadItem } from '@/stores/downloadStore';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DownloadQueueItemProps {
  item: DownloadItem;
  onCancel: () => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<DownloadItem['status'], string> = {
  queued:      '#6E6E73',
  downloading: '#FA233B',
  converting:  '#3498DB',
  tagging:     '#9B59B6',
  done:        '#27AE60',
  error:       '#E74C3C',
};

const STATUS_LABELS: Record<DownloadItem['status'], string> = {
  queued:      'Queued',
  downloading: 'Downloading',
  converting:  'Converting',
  tagging:     'Tagging',
  done:        'Done',
  error:       'Failed',
};

// ─── Animated progress bar ────────────────────────────────────────────────────

interface ProgressBarProps {
  progress: number; // 0–100
  status: DownloadItem['status'];
}

function AnimatedProgressBar({ progress, status }: ProgressBarProps) {
  const color = STATUS_COLORS[status];
  const isActive = status !== 'done' && status !== 'error' && status !== 'queued';

  return (
    <View style={barStyles.track}>
      <MotiView
        animate={{ width: `${Math.max(0, Math.min(100, progress))}%` as any }}
        transition={{
          type: 'timing',
          duration: 350,
          easing: Easing.out(Easing.ease),
        }}
        style={[barStyles.fill, { backgroundColor: color }]}
      >
        {/* Shimmer overlay for active states */}
        {isActive && (
          <MotiView
            from={{ opacity: 0.3, translateX: -60 }}
            animate={{ opacity: 0.7, translateX: 200 }}
            transition={{
              loop: true,
              type: 'timing',
              duration: 1200,
              repeatReverse: false,
            }}
            style={barStyles.shimmer}
          />
        )}
      </MotiView>
    </View>
  );
}

const barStyles = StyleSheet.create({
  track: {
    height: 3,
    backgroundColor: '#D2D2D7',
    borderRadius: 2,
    overflow: 'hidden',
    marginTop: 6,
  },
  fill: {
    height: 3,
    borderRadius: 2,
    overflow: 'hidden',
  },
  shimmer: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 60,
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.45)',
    borderRadius: 2,
  },
});

// ─── Thumbnail placeholder ────────────────────────────────────────────────────

function ThumbnailPlaceholder() {
  return (
    <View style={styles.thumbnailPlaceholder}>
      <Ionicons name="musical-notes" size={22} color="#FA233B" />
    </View>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DownloadQueueItem({ item, onCancel }: DownloadQueueItemProps) {
  const isDone  = item.status === 'done';
  const isError = item.status === 'error';

  const cancelScale = useSharedValue(1);

  const handleCancelPressIn  = useCallback(() => {
    cancelScale.value = withTiming(0.82, { duration: 80 });
  }, [cancelScale]);

  const handleCancelPressOut = useCallback(() => {
    cancelScale.value = withTiming(1, { duration: 120 });
  }, [cancelScale]);

  const cancelAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: cancelScale.value }],
  }));

  // Build status label string
  let statusLabel = STATUS_LABELS[item.status];
  if (item.status === 'downloading' && item.progress > 0) {
    statusLabel = `Downloading ${Math.round(item.progress)}%`;
  } else if (item.status === 'done') {
    statusLabel = 'Done';
  } else if (item.status === 'error') {
    statusLabel = 'Failed';
  }

  const statusColor = STATUS_COLORS[item.status];

  return (
    <MotiView
      from={{ opacity: 0, translateY: 8 }}
      animate={{ opacity: 1, translateY: 0 }}
      exit={{ opacity: 0, translateY: -8 }}
      transition={{ type: 'timing', duration: 260 }}
      style={styles.container}
    >
      {/* Thumbnail */}
      {item.thumbnail ? (
        <FastImage
          source={{
            uri: item.thumbnail,
            priority: FastImage.priority.normal,
            cache: FastImage.cacheControl.immutable,
          }}
          style={styles.thumbnail}
          resizeMode={FastImage.resizeMode.cover}
        />
      ) : (
        <ThumbnailPlaceholder />
      )}

      {/* Center content */}
      <View style={styles.content}>
        <Text style={styles.title} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={styles.artist} numberOfLines={1}>
          {item.artist}
        </Text>
        <Text style={[styles.statusText, { color: statusColor }]} numberOfLines={1}>
          {statusLabel}
        </Text>

        {/* Progress bar */}
        <AnimatedProgressBar progress={item.progress} status={item.status} />

        {/* Error message */}
        {isError && item.error ? (
          <Text style={styles.errorText} numberOfLines={2}>
            {item.error}
          </Text>
        ) : null}
      </View>

      {/* Right action */}
      {isDone ? (
        <View style={styles.doneIcon}>
          <Ionicons name="checkmark" size={18} color="#FFFFFF" />
        </View>
      ) : (
        <Animated.View style={cancelAnimStyle}>
          <TouchableOpacity
            onPress={onCancel}
            onPressIn={handleCancelPressIn}
            onPressOut={handleCancelPressOut}
            style={styles.cancelButton}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityLabel={`Cancel download of ${item.title}`}
            accessibilityRole="button"
          >
            <Ionicons name="close" size={16} color="#8E8E93" />
          </TouchableOpacity>
        </Animated.View>
      )}
    </MotiView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    minHeight: 80,
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    marginHorizontal: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#F2F2F7',
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.45,
        shadowRadius: 6,
      },
      android: { elevation: 3 },
    }),
  },
  thumbnail: {
    width: 60,
    height: 60,
    borderRadius: 8,
    flexShrink: 0,
    backgroundColor: '#F2F2F7',
  },
  thumbnailPlaceholder: {
    width: 60,
    height: 60,
    borderRadius: 8,
    backgroundColor: '#F2F2F7',
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingTop: 1,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1D1D1F',
    letterSpacing: -0.1,
    lineHeight: 19,
  },
  artist: {
    fontSize: 12,
    fontWeight: '400',
    color: '#6E6E73',
    marginTop: 1,
    lineHeight: 17,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '500',
    marginTop: 3,
    lineHeight: 15,
  },
  errorText: {
    fontSize: 10,
    fontWeight: '400',
    color: '#E74C3C',
    marginTop: 4,
    lineHeight: 14,
  },
  doneIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#34C759',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 15,
    flexShrink: 0,
  },
  cancelButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#D2D2D7',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 15,
    flexShrink: 0,
  },
});
