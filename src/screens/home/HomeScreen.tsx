import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  RefreshControl,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  StatusBar,
  Platform,
} from 'react-native';
import Animated, {
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useAllTracks, useRecentlyPlayed } from '@/hooks/useTrackDB';
import { usePlayerQueue } from '@/features/player/useQueue';
import { useDownloadStore } from '@/stores/downloadStore';
import type { RootStackNavigationProp } from '@/types/navigation';
import type { Track } from '@/db/models/Track';
import { modelToTrack, modelsToTracks } from '@/utils/trackMapper';
import { TrackArtwork } from '@/components/track/TrackArtwork';
import { HeroCard } from './components/HeroCard';
import { RecentlyPlayedRow } from './components/RecentlyPlayedRow';
import { MostPlayedSection } from './components/MostPlayedSection';
import { FavoritesSection } from '@/screens/library/components/FavoritesSection';

// ─── Constants ────────────────────────────────────────────────────────────────

const SEVEN_DAYS_AGO = () => Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

// ─── Section header ───────────────────────────────────────────────────────────

interface SectionHeaderProps {
  title: string;
  onSeeAll?: () => void;
}

function SectionHeader({ title, onSeeAll }: SectionHeaderProps) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {onSeeAll && (
        <TouchableOpacity onPress={onSeeAll} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.seeAll}>See All</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ─── Track card (horizontal) ──────────────────────────────────────────────────

interface TrackCardProps {
  track: Track;
  onPress: (track: Track) => void;
}

function TrackCard({ track, onPress }: TrackCardProps) {
  const handlePress = useCallback(() => onPress(track), [track, onPress]);
  return (
    <TouchableOpacity
      activeOpacity={0.82}
      onPress={handlePress}
      style={styles.trackCard}
    >
      <TrackArtwork
        uri={track.artworkPath}
        blurhash={null}
        size={160}
        borderRadius={12}
      />
      <Text style={styles.trackCardTitle} numberOfLines={2}>
        {track.title}
      </Text>
      <Text style={styles.trackCardArtist} numberOfLines={1}>
        {track.artist}
      </Text>
    </TouchableOpacity>
  );
}

// ─── Vertical track row (Made For You) ───────────────────────────────────────

interface VerticalTrackRowProps {
  track: Track;
  index: number;
  onPress: (track: Track) => void;
}

function VerticalTrackRow({ track, index, onPress }: VerticalTrackRowProps) {
  const handlePress = useCallback(() => onPress(track), [track, onPress]);
  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={handlePress}
      style={styles.verticalRow}
    >
      <Text style={styles.verticalIndex}>{index + 1}</Text>
      <TrackArtwork uri={track.artworkPath} blurhash={null} size={50} borderRadius={8} />
      <View style={styles.verticalMeta}>
        <Text style={styles.verticalTitle} numberOfLines={1}>
          {track.title}
        </Text>
        <Text style={styles.verticalArtist} numberOfLines={1}>
          {track.artist}
        </Text>
      </View>
      <Text style={styles.verticalDuration}>
        {formatDuration(track.durationMs)}
      </Text>
    </TouchableOpacity>
  );
}

// ─── "Daily Picks" empty state ────────────────────────────────────────────────

function DiscoveringState() {
  return (
    <View style={styles.discoveringContainer}>
      <Ionicons name="sparkles" size={28} color="#FA233B" />
      <Text style={styles.discoveringText}>Discovering music for you…</Text>
      <Text style={styles.discoveringSubtext}>Check back soon</Text>
    </View>
  );
}

// ─── Downloads quick-access button ───────────────────────────────────────────

interface DownloadsButtonProps {
  activeCount: number;
  onPress: () => void;
}

function DownloadsQuickButton({ activeCount, onPress }: DownloadsButtonProps) {
  return (
    <TouchableOpacity
      activeOpacity={0.75}
      onPress={onPress}
      style={styles.downloadsButton}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Ionicons name="arrow-down" size={20} color="#FFFFFF" />
      {activeCount > 0 && (
        <View style={styles.downloadsBadge}>
          <Text style={styles.downloadsBadgeText}>
            {activeCount > 9 ? '9+' : activeCount}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export function HomeScreen() {
  const navigation = useNavigation<RootStackNavigationProp>();
  const { playTrack } = usePlayerQueue();

  const allTracks = useAllTracks();
  const recentlyPlayed = useRecentlyPlayed(15);

  // Active download count for the quick-access badge
  const activeDownloadCount = useDownloadStore((s) =>
    s.queue.filter((d) => d.status !== 'done' && d.status !== 'error').length,
  );

  const [refreshing, setRefreshing] = useState(false);
  const scrollY = useSharedValue(0);

  // Daily picks: tracks downloaded today (added_at in last 24h)
  const dailyPicks = useMemo(() => {
    const oneDayAgo = Math.floor(Date.now() / 1000) - 86400;
    return allTracks.filter((t) => t.addedAt >= oneDayAgo).slice(0, 10);
  }, [allTracks]);

  // Recently added: last 7 days
  const recentlyAdded = useMemo(() => {
    const cutoff = SEVEN_DAYS_AGO();
    return allTracks.filter((t) => t.addedAt >= cutoff).slice(0, 15);
  }, [allTracks]);

  // Recommendations via TanStack Query (uses tracks with audio features)
  const { data: recommendations, isLoading: recLoading } = useQuery({
    queryKey: ['recommendations', allTracks.length],
    queryFn: async () => {
      // Build a scored list from tracks that have features
      const withFeatures = allTracks.filter((t) => t.features !== null);
      if (withFeatures.length === 0) return allTracks.slice(0, 5);

      // Simple energy + valence score weighted by how much we've heard each track
      const playedIds = new Set(recentlyPlayed.map((t) => t.id));
      const scored = withFeatures
        .filter((t) => !playedIds.has(t.id))
        .map((t) => ({
          track: t,
          score: (t.features!.energy + t.features!.valence + t.features!.danceability) / 3,
        }))
        .sort((a, b) => b.score - a.score);

      return scored.slice(0, 5).map((s) => s.track);
    },
    staleTime: 5 * 60 * 1000,
    enabled: allTracks.length > 0,
  });

  // Play a track in context of the full library
  const handleTrackPress = useCallback(
    (track: Track) => {
      void playTrack(modelToTrack(track), modelsToTracks(allTracks));
      navigation.navigate('NowPlaying');
    },
    [playTrack, allTracks, navigation],
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    // WatermelonDB observables refresh automatically; just give a slight delay
    await new Promise<void>((r) => setTimeout(r, 600));
    setRefreshing(false);
  }, []);

  const handleDownloadsPress = useCallback(() => {
    (navigation.navigate as any)('MainTabs', { screen: 'Downloads' });
  }, [navigation]);

  const scrollHandler = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y;
  });

  const headerStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [0, 80], [1, 0.85], Extrapolation.CLAMP),
    transform: [
      {
        translateY: interpolate(scrollY.value, [0, 80], [0, -4], Extrapolation.CLAMP),
      },
    ],
  }));

  const renderHeroItem = useCallback(
    ({ item }: { item: Track }) => (
      <HeroCard track={item} onPress={handleTrackPress} />
    ),
    [handleTrackPress],
  );

  const renderTrackCard = useCallback(
    ({ item }: { item: Track }) => (
      <TrackCard track={item} onPress={handleTrackPress} />
    ),
    [handleTrackPress],
  );

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor="#F5F5F7" />

      {/* ── Sticky header ── */}
      <Animated.View style={[styles.header, headerStyle]}>
        <View>
          <Text style={styles.logoText}>Chakaas</Text>
          <Text style={styles.greeting}>{getGreeting()}</Text>
        </View>

        {/* Downloads quick-access button — always shown; badge when active */}
        <DownloadsQuickButton
          activeCount={activeDownloadCount}
          onPress={handleDownloadsPress}
        />
      </Animated.View>

      <Animated.ScrollView
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor="#FA233B"
            colors={['#FA233B']}
          />
        }
      >
        {/* ─── Daily Picks ──────────────────────────────────────────────── */}
        <View style={styles.section}>
          <SectionHeader title="Daily Picks" />
          {dailyPicks.length === 0 ? (
            <DiscoveringState />
          ) : (
            <FlatList
              data={dailyPicks}
              renderItem={renderHeroItem}
              keyExtractor={(item) => item.id}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalList}
              ItemSeparatorComponent={() => <View style={{ width: 14 }} />}
              scrollEventThrottle={16}
            />
          )}
        </View>

        {/* ─── Recently Played ──────────────────────────────────────────── */}
        {recentlyPlayed.length > 0 && (
          <View style={styles.section}>
            <SectionHeader title="Recently Played" />
            <RecentlyPlayedRow
              tracks={recentlyPlayed}
              onTrackPress={handleTrackPress}
            />
          </View>
        )}

        {/* ─── Most Played ──────────────────────────────────────────────── */}
        <View style={styles.section}>
          <MostPlayedSection limit={5} />
        </View>

        {/* ─── Favorites ────────────────────────────────────────────────── */}
        <View style={styles.section}>
          <FavoritesSection limit={10} />
        </View>

        {/* ─── Made For You ──────────────────────────────────────────────── */}
        <View style={styles.section}>
          <SectionHeader title="Made For You" />
          {recLoading ? (
            <View style={styles.verticalSkeletonContainer}>
              {[0, 1, 2, 4].map((i) => (
                <View key={i} style={styles.verticalSkeletonRow}>
                  <View style={styles.verticalSkeletonArt} />
                  <View style={styles.verticalSkeletonText}>
                    <View style={styles.skeletonLine1} />
                    <View style={styles.skeletonLine2} />
                  </View>
                </View>
              ))}
            </View>
          ) : (
            (recommendations ?? []).map((track, index) => (
              <VerticalTrackRow
                key={track.id}
                track={track}
                index={index}
                onPress={handleTrackPress}
              />
            ))
          )}
        </View>

        {/* ─── Recently Added ───────────────────────────────────────────── */}
        {recentlyAdded.length > 0 && (
          <View style={[styles.section, styles.lastSection]}>
            <SectionHeader title="Recently Added" />
            <FlatList
              data={recentlyAdded}
              renderItem={renderTrackCard}
              keyExtractor={(item) => item.id}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalList}
              ItemSeparatorComponent={() => <View style={{ width: 14 }} />}
              scrollEventThrottle={16}
            />
          </View>
        )}

        {/* Bottom spacer for mini player */}
        <View style={{ height: 90 }} />
      </Animated.ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F5F5F7',
  },
  header: {
    paddingTop: Platform.OS === 'ios' ? 56 : 36,
    paddingBottom: 12,
    paddingHorizontal: 20,
    backgroundColor: '#F5F5F7',
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  logoText: {
    fontSize: 36,
    fontWeight: '800',
    color: '#FA233B',
    letterSpacing: -1.3,
    lineHeight: 40,
  },
  greeting: {
    fontSize: 14,
    fontWeight: '400',
    color: '#6E6E73',
    marginTop: 2,
  },
  // Downloads quick-access button
  downloadsButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(60,60,67,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
    position: 'relative',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 5 },
        shadowOpacity: 0.08,
        shadowRadius: 12,
      },
      android: { elevation: 3 },
    }),
  },
  downloadsButtonIcon: {
    fontSize: 20,
    color: '#1D1D1F',
    fontWeight: '600',
    lineHeight: 24,
  },
  downloadsBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#FA233B',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  downloadsBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#FFFFFF',
    lineHeight: 13,
  },
  scrollContent: {
    paddingTop: 8,
  },
  section: {
    marginBottom: 28,
  },
  lastSection: {
    marginBottom: 0,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1D1D1F',
    letterSpacing: -0.3,
  },
  seeAll: {
    fontSize: 13,
    fontWeight: '500',
    color: '#FA233B',
  },
  horizontalList: {
    paddingHorizontal: 20,
  },
  // Track card
  trackCard: {
    width: 160,
  },
  trackCardTitle: {
    marginTop: 8,
    fontSize: 13,
    fontWeight: '600',
    color: '#1D1D1F',
    letterSpacing: -0.1,
    lineHeight: 18,
  },
  trackCardArtist: {
    fontSize: 11,
    fontWeight: '400',
    color: '#6E6E73',
    marginTop: 2,
  },
  // Vertical list rows
  verticalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 8,
    gap: 12,
  },
  verticalIndex: {
    width: 20,
    fontSize: 13,
    fontWeight: '600',
    color: '#8E8E93',
    textAlign: 'center',
  },
  verticalMeta: {
    flex: 1,
  },
  verticalTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1D1D1F',
    letterSpacing: -0.1,
  },
  verticalArtist: {
    fontSize: 12,
    fontWeight: '400',
    color: '#6E6E73',
    marginTop: 2,
  },
  verticalDuration: {
    fontSize: 12,
    fontWeight: '400',
    color: '#8E8E93',
  },
  // Discovering state
  discoveringContainer: {
    height: 120,
    marginHorizontal: 20,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D2D2D7',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  discoveringIcon: {
    fontSize: 22,
    color: '#FA233B',
  },
  discoveringText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1D1D1F',
  },
  discoveringSubtext: {
    fontSize: 12,
    fontWeight: '400',
    color: '#8E8E93',
  },
  // Vertical skeleton
  verticalSkeletonContainer: {
    paddingHorizontal: 20,
    gap: 12,
  },
  verticalSkeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  verticalSkeletonArt: {
    width: 50,
    height: 50,
    borderRadius: 8,
    backgroundColor: '#F2F2F7',
    opacity: 0.7,
  },
  verticalSkeletonText: {
    flex: 1,
    gap: 6,
  },
  skeletonLine1: {
    height: 12,
    width: '70%',
    borderRadius: 6,
    backgroundColor: '#F2F2F7',
    opacity: 0.7,
  },
  skeletonLine2: {
    height: 10,
    width: '45%',
    borderRadius: 5,
    backgroundColor: '#F2F2F7',
    opacity: 0.5,
  },
});
