import React, { useCallback, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import FastImage, { type Source as FastImageSource } from 'react-native-fast-image';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useDownloadStore, type DownloadItem } from '@/stores/downloadStore';
import { useTheme } from '@/theme';
import type { Colors } from '@/theme';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DownloadQueueItemProps {
  /** Stable id — the component subscribes to its own slice of the store. */
  id: string;
  /** Stable cancel callback. Receives the id back so the parent doesn't have
   *  to allocate a per-row arrow. */
  onCancel: (id: string) => void;
}

// ─── Status → semantic token mapping ──────────────────────────────────────────
// Maps each download phase to an Arc Reactor token. Cyan accent drives the
// active "downloading" phase (the HUD's interactive state); gold for the
// post-download processing phases; success/danger for terminal states.

function statusColor(status: DownloadItem['status'], colors: Colors): string {
  switch (status) {
    case 'queued':
      return colors.textSecondary;
    case 'downloading':
      return colors.accent;
    case 'converting':
      return colors.accentGlow;
    case 'tagging':
      return colors.gold;
    case 'done':
      return '#34D399';
    case 'error':
      return colors.danger;
    default:
      return colors.textSecondary;
  }
}

const STATUS_LABELS: Record<DownloadItem['status'], string> = {
  queued:      'Queued',
  downloading: 'Downloading',
  converting:  'Converting',
  tagging:     'Tagging',
  done:        'Done',
  error:       'Failed',
};

// ─── Progress bar (plain View, no worklet) ───────────────────────────────────
// Earlier iterations of this component used Moti's animate prop AND a looping
// shimmer worklet — that pair was the source of the native bridge crash on
// scroll-while-downloading. The intermediate fix used Reanimated's
// useAnimatedStyle with `width: ${n}%` returned from a worklet, but
// Reanimated 3 has known instability with percent-unit width values
// returned from worklets on Android (can crash at module load on the
// JS bridge). We landed on the simplest stable thing: a plain View whose
// width is driven by React renders. The parent is wrapped in React.memo
// so this only re-renders for the ONE active row each progress tick,
// which is cheap.

interface ProgressBarProps {
  progress: number; // 0–100
  status: DownloadItem['status'];
}

function AnimatedProgressBar({ progress, status }: ProgressBarProps) {
  const { colors } = useTheme();
  const color = statusColor(status, colors);
  const clamped = Math.max(0, Math.min(100, progress));
  return (
    <View style={[barStyles.track, { backgroundColor: colors.bgRaised }]}>
      <View
        style={[barStyles.fill, { backgroundColor: color, width: `${clamped}%` }]}
      />
    </View>
  );
}

const barStyles = StyleSheet.create({
  track: {
    height: 3,
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
  const { colors } = useTheme();
  return (
    <View style={[styles.thumbnailPlaceholder, { backgroundColor: colors.bgRaised }]}>
      <Ionicons name="musical-notes" size={22} color={colors.accent} />
    </View>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

function DownloadQueueItemImpl({ id, onCancel }: DownloadQueueItemProps) {
  const { colors } = useTheme();

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

  const statusTone = statusColor(item.status, colors);

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.bgElevated, borderColor: colors.border },
      ]}
    >
      {/* Thumbnail */}
      {fastImageSource ? (
        <FastImage
          source={fastImageSource}
          style={[styles.thumbnail, { backgroundColor: colors.bgRaised }]}
          resizeMode={FastImage.resizeMode.cover}
        />
      ) : (
        <ThumbnailPlaceholder />
      )}

      {/* Center content */}
      <View style={styles.content}>
        <Text style={[styles.title, { color: colors.textPrimary }]} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={[styles.artist, { color: colors.textSecondary }]} numberOfLines={1}>
          {item.artist}
        </Text>
        <Text style={[styles.statusText, { color: statusTone }]} numberOfLines={1}>
          {statusLabel}
        </Text>

        {/* Progress bar */}
        <AnimatedProgressBar progress={item.progress} status={item.status} />

        {/* Error message */}
        {isError && item.error ? (
          <Text style={[styles.errorText, { color: colors.danger }]} numberOfLines={2}>
            {item.error}
          </Text>
        ) : null}
      </View>

      {/* Right action */}
      {isDone ? (
        <View style={[styles.doneIcon, { backgroundColor: '#34D399' }]}>
          <Ionicons name="checkmark" size={18} color={colors.bg} />
        </View>
      ) : (
        <Animated.View style={cancelAnimStyle}>
          <TouchableOpacity
            onPress={handleCancel}
            onPressIn={handleCancelPressIn}
            onPressOut={handleCancelPressOut}
            style={[styles.cancelButton, { backgroundColor: colors.bgRaised }]}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityLabel={`Cancel download of ${item.title}`}
            accessibilityRole="button"
          >
            <Ionicons name="close" size={16} color={colors.textSecondary} />
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
// Layout/geometry only — every colour is themed inline via useTheme(). Soft
// elevation: no heavy black drop shadow (the dark canvas carries depth via the
// cyan HUD hairline + elevated surface).

const styles = StyleSheet.create({
  container: {
    minHeight: 80,
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    borderRadius: 16,
    marginHorizontal: 16,
    marginBottom: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  thumbnail: {
    width: 60,
    height: 60,
    borderRadius: 12,
    flexShrink: 0,
  },
  thumbnailPlaceholder: {
    width: 60,
    height: 60,
    borderRadius: 12,
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
    letterSpacing: -0.1,
    lineHeight: 19,
  },
  artist: {
    fontSize: 12,
    fontWeight: '400',
    marginTop: 1,
    lineHeight: 17,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 3,
    lineHeight: 15,
  },
  errorText: {
    fontSize: 10,
    fontWeight: '400',
    marginTop: 4,
    lineHeight: 14,
  },
  doneIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 15,
    flexShrink: 0,
  },
  cancelButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 15,
    flexShrink: 0,
  },
});
