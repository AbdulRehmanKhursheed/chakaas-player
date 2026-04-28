import React, { useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ScrollView, TouchableOpacity } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { usePlayerQueue } from '@/features/player/useQueue';
import type { Track } from 'react-native-track-player';

// ─── Constants ────────────────────────────────────────────────────────────────

const ITEM_HEIGHT = 64;
const SPRING_CONFIG = { damping: 20, stiffness: 200, mass: 0.7 };

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

// ─── Animated Queue Item ──────────────────────────────────────────────────────

interface QueueItemProps {
  track: Track;
  index: number;
  globalIndex: number;
  isDragging: boolean;
  dragIndex: number | null;
  onRemove: (globalIndex: number) => void;
  onDragStart: (index: number) => void;
  onDragEnd: (fromIndex: number, toIndex: number) => void;
}

function QueueItem({
  track,
  index,
  globalIndex,
  isDragging,
  dragIndex,
  onRemove,
  onDragStart,
}: QueueItemProps) {
  const scale = useSharedValue(1);
  const translateY = useSharedValue(0);

  // When this item is the one being dragged, scale it up
  const isThisItemDragging = isDragging && dragIndex === index;

  const animStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: scale.value },
      { translateY: translateY.value },
    ],
    zIndex: isThisItemDragging ? 100 : 1,
    opacity: isThisItemDragging ? 0.95 : 1,
  }));

  // Shift items that are above/below the dragging item to indicate drop target
  const shiftStyle = useAnimatedStyle(() => {
    if (!isDragging || dragIndex === null || dragIndex === index) {
      return { transform: [{ translateY: withSpring(0, SPRING_CONFIG) }] };
    }
    return { transform: [{ translateY: withSpring(0, SPRING_CONFIG) }] };
  });

  const handleLongPress = useCallback(() => {
    scale.value = withSpring(1.03, SPRING_CONFIG);
    onDragStart(index);
  }, [index, onDragStart, scale]);

  const handlePressOut = useCallback(() => {
    scale.value = withSpring(1, SPRING_CONFIG);
  }, [scale]);

  const handleRemove = useCallback(() => {
    onRemove(globalIndex);
  }, [globalIndex, onRemove]);

  return (
    <Animated.View style={[styles.itemContainer, animStyle, shiftStyle]}>
      {/* Drag handle */}
      <TouchableOpacity
        onLongPress={handleLongPress}
        onPressOut={handlePressOut}
        style={styles.dragHandle}
        accessibilityLabel="Drag to reorder"
        accessibilityRole="adjustable"
      >
        <Ionicons name="reorder-two" size={23} color="#8E8E93" />
      </TouchableOpacity>

      {/* Track info */}
      <View style={styles.trackInfo}>
        <Text style={styles.trackTitle} numberOfLines={1}>
          {track.title ?? 'Unknown Title'}
        </Text>
        <Text style={styles.trackArtist} numberOfLines={1}>
          {track.artist ?? 'Unknown Artist'}
        </Text>
      </View>

      {/* Remove button */}
      <TouchableOpacity
        onPress={handleRemove}
        style={styles.removeButton}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        accessibilityLabel={`Remove ${track.title ?? 'track'} from queue`}
        accessibilityRole="button"
      >
        <Ionicons name="close" size={15} color="#8E8E93" />
      </TouchableOpacity>
    </Animated.View>
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

  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Track drag gesture manually via scroll position deltas
  const dragCurrentIndex = useRef<number | null>(null);

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

  const handleDragStart = useCallback((localIndex: number) => {
    setDraggingIndex(localIndex);
    setIsDragging(true);
    dragCurrentIndex.current = localIndex;
  }, []);

  const handleDragEnd = useCallback(
    (fromLocalIndex: number, toLocalIndex: number) => {
      setIsDragging(false);
      setDraggingIndex(null);
      dragCurrentIndex.current = null;

      if (fromLocalIndex === toLocalIndex) return;

      // Update local order optimistically
      setLocalOrder((prev) => {
        const next = [...prev];
        const [moved] = next.splice(fromLocalIndex, 1);
        next.splice(toLocalIndex, 0, moved);
        return next;
      });

      // Tell RNTP about the move (convert to global indices)
      const fromGlobal = fromLocalIndex + indexOffset;
      const toGlobal = toLocalIndex + indexOffset;
      moveInQueue(fromGlobal, toGlobal);
    },
    [moveInQueue, indexOffset],
  );

  const renderItem = useCallback(
    (track: Track, localIndex: number) => {
      const globalIndex = localIndex + indexOffset;
      return (
        <QueueItem
          key={track.id ?? `queue-item-${globalIndex}`}
          track={track}
          index={localIndex}
          globalIndex={globalIndex}
          isDragging={isDragging}
          dragIndex={draggingIndex}
          onRemove={handleRemove}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        />
      );
    },
    [
      isDragging,
      draggingIndex,
      indexOffset,
      handleRemove,
      handleDragStart,
      handleDragEnd,
    ],
  );

  if (localOrder.length === 0) {
    return null;
  }

  return (
    <ScrollView
      style={styles.scrollView}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}
      scrollEnabled={!isDragging}
      keyboardShouldPersistTaps="handled"
    >
      {localOrder.map((track, index) => renderItem(track, index))}
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
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    marginBottom: 6,
    paddingHorizontal: 4,
    borderWidth: 1,
    borderColor: '#F2F2F7',
    gap: 4,
  },

  // Drag handle
  dragHandle: {
    width: 40,
    height: ITEM_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
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
    color: '#1D1D1F',
    letterSpacing: -0.1,
  },
  trackArtist: {
    fontSize: 12,
    fontWeight: '400',
    color: '#6E6E73',
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
