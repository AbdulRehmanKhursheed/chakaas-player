import React, { useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ScrollView, TouchableOpacity } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { usePlayerQueue } from '@/features/player/useQueue';
import TrackPlayer, { type Track } from 'react-native-track-player';
import { logger } from '@/utils/logger';
import { TrackArtwork } from '@/components/track/TrackArtwork';
import { useTheme } from '@/theme';

// ─── Constants ────────────────────────────────────────────────────────────────

const ITEM_HEIGHT = 64;

// ─── Props ────────────────────────────────────────────────────────────────────

interface DraggableQueueListProps {
  /** RNTP track objects to display (the upcoming portion of the queue). */
  queue: Track[];
  /**
   * Offset to add to local list indices when calling TrackPlayer.remove() /
   * TrackPlayer.move(). Typically 1 because the currently-playing track is
   * omitted from this list but still occupies index 0 in RNTP's queue.
   */
  indexOffset?: number;
}

// ─── Queue Item ──────────────────────────────────────────────────────────────

interface QueueItemProps {
  track: Track;
  index: number;
  globalIndex: number;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onRemove: (globalIndex: number) => void;
  onMoveUp: (localIndex: number) => void;
  onMoveDown: (localIndex: number) => void;
  onJump: (globalIndex: number) => void;
}

function QueueItem({
  track,
  index,
  globalIndex,
  canMoveUp,
  canMoveDown,
  onRemove,
  onMoveUp,
  onMoveDown,
  onJump,
}: QueueItemProps) {
  const { colors } = useTheme();
  const handleRemove = useCallback(() => {
    onRemove(globalIndex);
  }, [globalIndex, onRemove]);

  const handleMoveUp = useCallback(() => {
    try {
      void Haptics.selectionAsync();
    } catch {
      // ignore
    }
    onMoveUp(index);
  }, [index, onMoveUp]);

  const handleMoveDown = useCallback(() => {
    try {
      void Haptics.selectionAsync();
    } catch {
      // ignore
    }
    onMoveDown(index);
  }, [index, onMoveDown]);

  const handleJump = useCallback(() => {
    onJump(globalIndex);
  }, [globalIndex, onJump]);

  return (
    <View style={[styles.itemContainer, { backgroundColor: colors.bgElevated, borderColor: colors.border }]}>
      {/* Reorder controls — a true draggable list isn't bundled in this
          app, but tap-to-move arrows give the user a reliable way to
          reorder the queue and persist the change through `moveInQueue`.
          The arrows disable themselves at the list edges. */}
      <View style={styles.reorderCluster}>
        <TouchableOpacity
          onPress={handleMoveUp}
          disabled={!canMoveUp}
          style={styles.reorderBtn}
          hitSlop={{ top: 8, bottom: 4, left: 6, right: 6 }}
          accessibilityLabel="Move up in queue"
          accessibilityRole="button"
        >
          <Ionicons
            name="chevron-up"
            size={18}
            color={canMoveUp ? colors.accent : colors.textTertiary}
          />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleMoveDown}
          disabled={!canMoveDown}
          style={styles.reorderBtn}
          hitSlop={{ top: 4, bottom: 8, left: 6, right: 6 }}
          accessibilityLabel="Move down in queue"
          accessibilityRole="button"
        >
          <Ionicons
            name="chevron-down"
            size={18}
            color={canMoveDown ? colors.accent : colors.textTertiary}
          />
        </TouchableOpacity>
      </View>

      {/* Tap the body to skip to this track. Wrapping just the artwork +
          title (not the close / reorder buttons) so the row controls don't
          fire jump on every accidental press. */}
      <TouchableOpacity
        onPress={handleJump}
        activeOpacity={0.6}
        style={styles.bodyPress}
        accessibilityRole="button"
        accessibilityLabel={`Play ${track.title ?? 'track'}`}
      >
        <TrackArtwork
          uri={track.artwork ? String(track.artwork) : null}
          blurhash={null}
          size={40}
          borderRadius={10}
        />
        {/* Track info */}
        <View style={styles.trackInfo}>
          <Text style={[styles.trackTitle, { color: colors.textPrimary }]} numberOfLines={1}>
            {track.title ?? 'Unknown Title'}
          </Text>
          <Text style={[styles.trackArtist, { color: colors.textSecondary }]} numberOfLines={1}>
            {track.artist ?? 'Unknown Artist'}
          </Text>
        </View>
      </TouchableOpacity>

      {/* Remove button */}
      <TouchableOpacity
        onPress={handleRemove}
        style={styles.removeButton}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        accessibilityLabel={`Remove ${track.title ?? 'track'} from queue`}
        accessibilityRole="button"
      >
        <Ionicons name="close" size={15} color={colors.textSecondary} />
      </TouchableOpacity>
    </View>
  );
}

// ─── Main List Component ──────────────────────────────────────────────────────

export function DraggableQueueList({
  queue,
  indexOffset = 0,
}: DraggableQueueListProps) {
  const { removeFromQueue, moveInQueue } = usePlayerQueue();

  // Local mutable order so the UI reflects reorders instantly before RNTP confirms
  const [localOrder, setLocalOrder] = useState<Track[]>(queue);

  // Sync local order when external queue prop changes (e.g. track ended)
  const prevQueueRef = useRef<Track[]>(queue);
  if (prevQueueRef.current !== queue) {
    prevQueueRef.current = queue;
    setLocalOrder(queue);
  }

  const handleRemove = useCallback(
    (globalIndex: number) => {
      // Optimistically remove from local state
      setLocalOrder((prev) => {
        const next = [...prev];
        const localIdx = globalIndex - indexOffset;
        if (localIdx >= 0 && localIdx < next.length) {
          next.splice(localIdx, 1);
        }
        return next;
      });
      removeFromQueue(globalIndex);
    },
    [removeFromQueue, indexOffset],
  );

  // Reorder one slot at a time. We update the local snapshot immediately
  // so the rows jump into place without waiting for the RNTP queue
  // observable to round-trip, then persist via `moveInQueue` which calls
  // `TrackPlayer.move()` under the hood.
  const handleMoveUp = useCallback(
    (localIndex: number) => {
      if (localIndex <= 0) return;
      setLocalOrder((prev) => {
        if (localIndex >= prev.length) return prev;
        const next = [...prev];
        const [moved] = next.splice(localIndex, 1);
        next.splice(localIndex - 1, 0, moved);
        return next;
      });
      const fromGlobal = localIndex + indexOffset;
      const toGlobal = localIndex - 1 + indexOffset;
      moveInQueue(fromGlobal, toGlobal);
    },
    [moveInQueue, indexOffset],
  );

  const handleMoveDown = useCallback(
    (localIndex: number) => {
      setLocalOrder((prev) => {
        if (localIndex < 0 || localIndex >= prev.length - 1) return prev;
        const next = [...prev];
        const [moved] = next.splice(localIndex, 1);
        next.splice(localIndex + 1, 0, moved);
        return next;
      });
      const fromGlobal = localIndex + indexOffset;
      const toGlobal = localIndex + 1 + indexOffset;
      moveInQueue(fromGlobal, toGlobal);
    },
    [moveInQueue, indexOffset],
  );

  // Skip-to-queued-track: tapping a row jumps RNTP to that index and
  // resumes playback so the user gets immediate audio feedback.
  const handleJump = useCallback(async (globalIndex: number) => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await TrackPlayer.skip(globalIndex);
      await TrackPlayer.play();
    } catch (err) {
      logger.warn('[QueueList] skip-to-index failed:', err);
    }
  }, []);

  if (localOrder.length === 0) {
    return null;
  }

  return (
    <ScrollView
      style={styles.scrollView}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {localOrder.map((track, localIndex) => {
        const globalIndex = localIndex + indexOffset;
        return (
          <QueueItem
            key={track.id ?? `queue-item-${globalIndex}`}
            track={track}
            index={localIndex}
            globalIndex={globalIndex}
            canMoveUp={localIndex > 0}
            canMoveDown={localIndex < localOrder.length - 1}
            onRemove={handleRemove}
            onMoveUp={handleMoveUp}
            onMoveDown={handleMoveDown}
            onJump={handleJump}
          />
        );
      })}
      {/* Bottom padding so the last item isn't cut off by the mini player */}
      <View style={styles.bottomSpacer} />
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: 16,
  },

  // Queue item row
  itemContainer: {
    height: ITEM_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    marginBottom: 6,
    paddingHorizontal: 4,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },

  // Reorder cluster (stacked up/down arrows)
  reorderCluster: {
    width: 32,
    height: ITEM_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
  },
  reorderBtn: {
    width: 32,
    height: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Tappable row body (artwork + title/artist)
  bodyPress: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingRight: 4,
    height: ITEM_HEIGHT,
  },
  // Track info
  trackInfo: {
    flex: 1,
    justifyContent: 'center',
    gap: 3,
    paddingRight: 4,
  },
  trackTitle: {
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: -0.1,
  },
  trackArtist: {
    fontSize: 12,
    fontWeight: '400',
  },

  // Remove button
  removeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 4,
  },

  // Bottom spacing
  bottomSpacer: {
    height: 32,
  },
});
