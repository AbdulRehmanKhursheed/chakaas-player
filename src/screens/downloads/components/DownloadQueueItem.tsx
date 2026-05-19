import React, { useCallback, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import FastImage, { type Source as FastImageSource } from 'react-native-fast-image';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useDownloadStore, type DownloadItem } from '@/stores/downloadStore';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DownloadQueueItemProps {
  /** Stable id — the component subscribes to its own slice of the store. */
  id: string;
  /** Stable cancel callback. Receives the id back so the parent doesn't have
   *  to allocate a per-row arrow. */
  onCancel: (id: string) => void;
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

// ─── Progress bar (Reanimated, UI-thread only) ───────────────────────────────
// Previously this used Moti's animate + an inner looping shimmer worklet.
// The looping shimmer fired ~60 times/sec PER active item — combined with
// progress-tick re-renders that re-mounted the worklet, the UI thread got
// jammed during user scroll and the native bridge crashed. We replace it
// with a single Reanimated SharedValue that runs withTiming on the UI
// thread without any JS-side re-render churn.

interface ProgressBarProps {
  progress: number; // 0–100
  status: DownloadItem['status'];
}

function AnimatedProgressBar({ progress, status }: ProgressBarProps) {
  const color = STATUS_COLORS[status];
  const widthShared = useSharedValue(0);

  // Drive the shared value on the UI thread. `progress` changing triggers
  // a tiny effect — no full re-render of the parent.
  React.useEffect(() => {
    widthShared.value = withTiming(Math.max(0, Math.min(100, progress)), {
      duration: 280,
      easing: Easing.out(Easing.ease),
    });
  }, [progress, widthShared]);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${widthShared.value}%` as `${number}%`,
  }));

  return (
    <View style={barStyles.track}>
      <Animated.View style={[barStyles.fill, { backgroundColor: color }, fillStyle]} />
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

function DownloadQueueItemImpl({ id, onCancel }: DownloadQueueItemProps) {
  // Per-row store subscription. When ANOTHER item in the queue updates,
  // Zustand+Immer keeps this item's reference stable so we don't re-render.
  // When THIS item updates, the reference changes and only we re-render.
  // This is the fix for "every progress tick re-renders every queue row".
  const item = useDownloadStore(
    useCallback((s) => s.queue.find((q) => q.id === id), [id]),
  );

  // Memoize the FastImage source so we don't recreate the object every
  // render — FastImage diffs by reference, and a fresh object every tick
  // forces redundant native cache lookups.
  const fastImageSource: FastImageSource | null = useMemo(() => {
    if (!item?.thumbnail) return null;
    return {
      uri: item.thumbnail,
      priority: FastImage.priority.normal,
      cache: FastImage.cacheControl.immutable,
    };
  }, [item?.thumbnail]);

  const cancelScale = useSharedValue(1);

  const handleCancel = useCallback(() => {
    onCancel(id);
  }, [id, onCancel]);

  const handleCancelPressIn = useCallback(() => {
    cancelScale.value = withTiming(0.82, { duration: 80 });
  }, [cancelScale]);

  const handleCancelPressOut = useCallback(() => {
    cancelScale.value = withTiming(1, { duration: 120 });
  }, [cancelScale]);

  const cancelAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: cancelScale.value }],
  }));

  // If the row was just removed, render nothing — the parent's
  // AnimatePresence will animate it out via the prior render.
  if (!item) return null;

  const isDone  = item.status === 'done';
  const isError = item.status === 'error';

  // Build status label string
  let statusLabel: string = STATUS_LABELS[item.status];
  if (item.status === 'downloading' && item.progress > 0) {
    statusLabel = `Downloading ${Math.round(item.progress)}%`;
  } else if (item.status === 'done') {
    statusLabel = 'Done';
  } else if (item.status === 'error') {
    statusLabel = 'Failed';
  }

  const statusColor = STATUS_COLORS[item.status];

  return (
    <View style={styles.container}>
      {/* Thumbnail */}
      {fastImageSource ? (
        <FastImage
          source={fastImageSource}
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
            onPress={handleCancel}
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
    </View>
  );
}

// Memo guard: re-render only if our subscription returns a different
// reference (i.e. THIS item changed) — the parent's queue.map will pass
// stable id + stable onCancel, so prop diff is trivial.
export const DownloadQueueItem = React.memo(
  DownloadQueueItemImpl,
  (prev, next) => prev.id === next.id && prev.onCancel === next.onCancel,
);

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
