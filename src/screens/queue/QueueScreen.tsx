import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { usePlayerQueue } from '@/features/player/useQueue';
import { useActiveTrack } from 'react-native-track-player';
import { DraggableQueueList } from './components/DraggableQueueList';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TrackArtwork } from '@/components/track/TrackArtwork';
import { Ionicons } from '@expo/vector-icons';
import type { RootStackNavigationProp } from '@/types/navigation';

// ─── Component ────────────────────────────────────────────────────────────────

export function QueueScreen() {
  const navigation = useNavigation<RootStackNavigationProp<'Queue'>>();
  const activeTrack = useActiveTrack();
  const { queue } = usePlayerQueue();

  // The queue returned by RNTP includes the currently-playing track at
  // index 0 (when active). We display it separately in the "Now Playing"
  // section and only show the upcoming tracks in the draggable list.
  // If there is no active track, activeIndex is undefined and the whole
  // queue is shown as upcoming.
  const upcomingQueue = activeTrack ? queue.slice(1) : queue;

  const handleClose = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Next Up</Text>
        <TouchableOpacity
          onPress={handleClose}
          style={styles.closeButton}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityLabel="Close queue"
          accessibilityRole="button"
        >
          <Ionicons name="close" size={17} color="#3A3A3C" />
        </TouchableOpacity>
      </View>

      {/* ── Now Playing ────────────────────────────────────────────────── */}
      {activeTrack && (
        <View style={styles.nowPlayingSection}>
          <Text style={styles.sectionLabel}>NOW PLAYING</Text>
          <View style={styles.nowPlayingCard}>
            <TrackArtwork
              uri={activeTrack.artwork ?? null}
              blurhash={null}
              size={52}
              borderRadius={8}
            />
            <View style={styles.nowPlayingInfo}>
              <Text style={styles.nowPlayingTitle} numberOfLines={1}>
                {activeTrack.title ?? 'Unknown Title'}
              </Text>
              <Text style={styles.nowPlayingArtist} numberOfLines={1}>
                {activeTrack.artist ?? 'Unknown Artist'}
              </Text>
            </View>
            <View style={styles.playingIndicator}>
              <View style={[styles.indicatorBar, styles.indicatorBar1]} />
              <View style={[styles.indicatorBar, styles.indicatorBar2]} />
              <View style={[styles.indicatorBar, styles.indicatorBar3]} />
            </View>
          </View>
        </View>
      )}

      {/* ── Divider ────────────────────────────────────────────────────── */}
      <View style={styles.divider} />

      {/* ── Queue Section ──────────────────────────────────────────────── */}
      <View style={styles.queueHeader}>
        <Text style={styles.sectionLabel}>QUEUE</Text>
        <Text style={styles.trackCount}>
          {upcomingQueue.length} {upcomingQueue.length === 1 ? 'track' : 'tracks'}
        </Text>
      </View>

      {upcomingQueue.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="musical-notes" size={40} color="#FA233B" />
          <Text style={styles.emptyTitle}>Queue is empty</Text>
          <Text style={styles.emptySubtitle}>Add tracks to see them here</Text>
        </View>
      ) : (
        <DraggableQueueList queue={upcomingQueue} indexOffset={activeTrack ? 1 : 0} />
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F5F5F7',
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    position: 'relative',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1D1D1F',
    letterSpacing: -0.3,
  },
  closeButton: {
    position: 'absolute',
    right: 20,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#D2D2D7',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Now Playing section
  nowPlayingSection: {
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FA233B',
    letterSpacing: 2,
    marginBottom: 12,
  },
  nowPlayingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#D2D2D7',
    gap: 12,
    ...Platform.select({
      ios: {
        shadowColor: '#FA233B',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 8,
      },
      android: { elevation: 4 },
    }),
  },
  nowPlayingInfo: {
    flex: 1,
    justifyContent: 'center',
    gap: 3,
  },
  nowPlayingTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1D1D1F',
    letterSpacing: -0.2,
  },
  nowPlayingArtist: {
    fontSize: 13,
    fontWeight: '400',
    color: '#6E6E73',
  },
  // Animated bars placeholder (static rendering — animate with Reanimated if needed)
  playingIndicator: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    height: 18,
    paddingRight: 4,
  },
  indicatorBar: {
    width: 3,
    backgroundColor: '#FA233B',
    borderRadius: 2,
  },
  indicatorBar1: { height: 10 },
  indicatorBar2: { height: 18 },
  indicatorBar3: { height: 13 },

  // Divider
  divider: {
    height: 1,
    backgroundColor: '#F2F2F7',
    marginHorizontal: 20,
    marginBottom: 16,
  },

  // Queue header
  queueHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  trackCount: {
    fontSize: 12,
    fontWeight: '500',
    color: '#6E6E73',
  },

  // Empty state
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 60,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#8E8E93',
  },
  emptySubtitle: {
    fontSize: 13,
    fontWeight: '400',
    color: '#C7C7CC',
  },
});
