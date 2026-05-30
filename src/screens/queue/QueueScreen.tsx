import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { usePlayerQueue, bumpQueueVersion } from '@/features/player/useQueue';
import TrackPlayer, { useActiveTrack, usePlaybackState, State } from 'react-native-track-player';
import { DraggableQueueList } from './components/DraggableQueueList';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TrackArtwork } from '@/components/track/TrackArtwork';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import type { RootStackNavigationProp } from '@/types/navigation';
import { EqualizerBars } from '@/components/EqualizerBars';
import { useTheme } from '@/theme';

// ─── Component ────────────────────────────────────────────────────────────────

export function QueueScreen() {
  const { colors } = useTheme();
  const navigation = useNavigation<RootStackNavigationProp<'Queue'>>();
  const activeTrack = useActiveTrack();
  const playbackState = usePlaybackState();
  const isPlaying = playbackState.state === State.Playing;
  const { queue, clearQueue } = usePlayerQueue();

  // The queue returned by RNTP includes the currently-playing track at
  // index 0 (when active). We display it separately in the "Now Playing"
  // section and only show the upcoming tracks in the draggable list.
  // If there is no active track, activeIndex is undefined and the whole
  // queue is shown as upcoming.
  const upcomingQueue = activeTrack ? queue.slice(1) : queue;

  const handleClose = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    navigation.goBack();
  }, [navigation]);

  const handleClearAll = useCallback(() => {
    if (upcomingQueue.length === 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      'Clear upcoming?',
      'This removes every track after the one currently playing.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            // No active track → full reset is fine.
            if (!activeTrack) {
              await clearQueue();
              return;
            }
            // Remove upcoming tracks individually so the currently-playing
            // track keeps playing without interruption. Iterate from the
            // tail forward so earlier indices stay valid as we delete.
            try {
              const offset = 1; // active track sits at index 0
              for (let i = upcomingQueue.length - 1; i >= 0; i--) {
                // eslint-disable-next-line no-await-in-loop
                await TrackPlayer.remove(i + offset);
              }
              bumpQueueVersion();
            } catch {
              // Best-effort: fall back to a full reset if individual
              // removal failed (e.g. RNTP not ready).
              await clearQueue();
            }
          },
        },
      ],
      { cancelable: true },
    );
  }, [upcomingQueue.length, activeTrack, clearQueue]);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>Next Up</Text>
        <TouchableOpacity
          onPress={handleClose}
          style={[styles.closeButton, { backgroundColor: colors.bgRaised }]}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityLabel="Close queue"
          accessibilityRole="button"
        >
          <Ionicons name="close" size={17} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* ── Now Playing / Queue divider rendered below ─────────────────── */}

      {/* ── Now Playing ────────────────────────────────────────────────── */}
      {activeTrack && (
        <View style={styles.nowPlayingSection}>
          <Text style={[styles.sectionLabel, { color: colors.accent }]}>NOW PLAYING</Text>
          <View
            style={[
              styles.nowPlayingCard,
              { backgroundColor: colors.bgElevated, borderColor: colors.borderAccent, shadowColor: colors.accent },
            ]}
          >
            <TrackArtwork
              uri={activeTrack.artwork ?? null}
              blurhash={null}
              size={52}
              borderRadius={12}
            />
            <View style={styles.nowPlayingInfo}>
              <Text style={[styles.nowPlayingTitle, { color: colors.textPrimary }]} numberOfLines={1}>
                {activeTrack.title ?? 'Unknown Title'}
              </Text>
              <Text style={[styles.nowPlayingArtist, { color: colors.textSecondary }]} numberOfLines={1}>
                {activeTrack.artist ?? 'Unknown Artist'}
              </Text>
            </View>
            <View style={styles.playingIndicator}>
              <EqualizerBars
                playing={isPlaying}
                count={3}
                barWidth={3}
                gap={3}
                height={18}
              />
            </View>
          </View>
        </View>
      )}

      {/* ── Divider ────────────────────────────────────────────────────── */}
      <View style={[styles.divider, { backgroundColor: colors.border }]} />

      {/* ── Queue Section ──────────────────────────────────────────────── */}
      <View style={styles.queueHeader}>
        <Text style={[styles.sectionLabel, { color: colors.accent }]}>QUEUE</Text>
        <View style={styles.queueHeaderRight}>
          <Text style={[styles.trackCount, { color: colors.textSecondary }]}>
            {upcomingQueue.length} {upcomingQueue.length === 1 ? 'track' : 'tracks'}
          </Text>
          {upcomingQueue.length > 0 ? (
            <TouchableOpacity
              onPress={handleClearAll}
              hitSlop={{ top: 8, bottom: 8, left: 10, right: 6 }}
              accessibilityLabel="Clear upcoming tracks"
              accessibilityRole="button"
            >
              <Text style={[styles.clearAll, { color: colors.danger }]}>Clear</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {upcomingQueue.length === 0 ? (
        <View style={styles.emptyState}>
          <View style={[styles.emptyIconCircle, { backgroundColor: colors.accentMuted, borderColor: colors.borderAccent }]}>
            <Ionicons name="musical-notes-outline" size={32} color={colors.accent} />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.textPrimary }]}>No upcoming tracks</Text>
          <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
            Songs you queue or auto-play next will appear here.
          </Text>
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
    letterSpacing: -0.3,
  },
  closeButton: {
    position: 'absolute',
    right: 20,
    width: 32,
    height: 32,
    borderRadius: 16,
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
    letterSpacing: 2,
    marginBottom: 12,
  },
  nowPlayingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 12,
    // Soft cyan HUD elevation — no heavy black drop shadow.
    ...Platform.select({
      ios: {
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.18,
        shadowRadius: 14,
      },
      android: { elevation: 6 },
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
    letterSpacing: -0.2,
  },
  nowPlayingArtist: {
    fontSize: 13,
    fontWeight: '400',
  },
  // Live animated EQ bars driven by Reanimated worklets.
  playingIndicator: {
    height: 18,
    paddingRight: 4,
    justifyContent: 'flex-end',
  },

  // Divider
  divider: {
    height: StyleSheet.hairlineWidth,
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
  queueHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  trackCount: {
    fontSize: 12,
    fontWeight: '500',
  },
  clearAll: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: -0.1,
  },

  // Empty state
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    paddingBottom: 80,
    paddingHorizontal: 40,
  },
  emptyIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  emptySubtitle: {
    fontSize: 13,
    fontWeight: '400',
    textAlign: 'center',
    maxWidth: 260,
    lineHeight: 18,
  },
});
