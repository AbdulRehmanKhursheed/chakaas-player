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
  ActivityIndicator,
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
import { useRecentlyPlayed } from '@/hooks/useTrackDB';
import { useSafeTracks } from '@/hooks/useSafeTracks';
import { usePlayer } from '@/features/player/usePlayer';
import { useDownloadStore } from '@/stores/downloadStore';
import { useTheme } from '@/theme';
import type { RootStackNavigationProp } from '@/types/navigation';
import type { Track } from '@/db/models/Track';
import { modelToTrack, modelsToTracks } from '@/utils/trackMapper';
import { BlurView } from 'expo-blur';
import { TrackArtwork } from '@/components/track/TrackArtwork';
import { HeroCard } from './components/HeroCard';
import { RecentlyPlayedRow } from './components/RecentlyPlayedRow';
import { MostPlayedSection } from './components/MostPlayedSection';
import { FavoritesSection } from '@/screens/library/components/FavoritesSection';
import { getDiscoverFeed, type DiscoverItem } from '@/features/recommendations/discoverEngine';
import { addToSkipMemory } from '@/features/recommendations/skipMemory';
import { DownloadManager } from '@/features/download/DownloadManager';
import { TrackRowSkeleton } from '@/components/ui/SkeletonShimmer';
import { MarqueeText } from '@/components/ui/MarqueeText';
import { HapticPressable } from '@/components/ui/HapticPressable';
import * as Haptics from 'expo-haptics';

// ─── Constants ────────────────────────────────────────────────────────────────

const SEVEN_DAYS_AGO = () => Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;

// Done/success green for the "added to downloads" checkmark.
const SUCCESS_GREEN = '#34D399';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getGreeting(): string {
  const hour = new Date().getHours();
  // Treat the small-hours window as night — "Good morning" at 2 AM is a lie.
  if (hour < 5) return 'Good night';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  if (hour < 22) return 'Good evening';
  return 'Good night';
}

// ─── Section header ───────────────────────────────────────────────────────────

interface SectionHeaderProps {
  title: string;
  onSeeAll?: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
}

function SectionHeader({ title, onSeeAll, onRefresh, refreshing }: SectionHeaderProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.sectionHeader}>
      <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>{title}</Text>
      <View style={styles.sectionHeaderRight}>
        {onRefresh && (
          <TouchableOpacity
            onPress={onRefresh}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            disabled={refreshing}
            style={[styles.refreshBtn, { backgroundColor: colors.accentMuted }]}
          >
            {refreshing ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : (
              <Ionicons name="refresh" size={18} color={colors.accent} />
            )}
          </TouchableOpacity>
        )}
        {onSeeAll && (
          <TouchableOpacity onPress={onSeeAll} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={[styles.seeAll, { color: colors.accent }]}>See All</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

// ─── Track card (horizontal) ──────────────────────────────────────────────────

interface TrackCardProps {
  track: Track;
  onPress: (track: Track) => void;
}

function TrackCard({ track, onPress }: TrackCardProps) {
  const { colors } = useTheme();
  const handlePress = useCallback(() => onPress(track), [track, onPress]);
  return (
    <HapticPressable
      hapticStyle="light"
      onPress={handlePress}
      style={({ pressed }) => [
        styles.trackCard,
        pressed ? styles.trackCardPressed : null,
      ]}
    >
      <TrackArtwork
        uri={track.artworkPath}
        blurhash={null}
        size={160}
        borderRadius={12}
      />
      {/* Marquee for the title — long Bollywood / OST names overflow the
          160-px card width frequently, and the auto-scroll matches Apple
          Music's "Made For You" tile behaviour. */}
      <View style={styles.trackCardTitleWrap}>
        <MarqueeText style={[styles.trackCardTitle, { color: colors.textPrimary }]}>{track.title}</MarqueeText>
      </View>
      <Text style={[styles.trackCardArtist, { color: colors.textSecondary }]} numberOfLines={1}>
        {track.artist}
      </Text>
    </HapticPressable>
  );
}

// ─── Discover row (Saavn suggestion the user can add to downloads) ──────────

interface DiscoverRowProps {
  item: DiscoverItem;
  index: number;
  onDismiss?: (item: DiscoverItem) => void;
}

function DiscoverRow({ item, index, onDismiss }: DiscoverRowProps) {
  const { colors } = useTheme();
  const [enqueuing, setEnqueuing] = useState(false);
  const [enqueued, setEnqueued] = useState(false);

  const handleAdd = useCallback(async () => {
    if (enqueuing || enqueued) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setEnqueuing(true);
    try {
      const result = await DownloadManager.enqueue({
        youtubeId: item.id,
        title: item.title,
        artist: item.author,
        thumbnail: item.thumbnail,
        durationMs: item.duration_ms,
        provider: 'saavn',
        album: item.saavnAlbum,
        saavnEncryptedUrl: item.saavnEncryptedUrl,
        saavnHas320kbps: item.saavnHas320kbps,
      });
      setEnqueued(result.success);
    } catch {
      // enqueue failed silently — button resets to allow retry
    } finally {
      setEnqueuing(false);
    }
  }, [item, enqueuing, enqueued]);

  const handleDismiss = useCallback(() => {
    onDismiss?.(item);
  }, [item, onDismiss]);

  return (
    <View style={styles.verticalRow}>
      <Text style={[styles.verticalIndex, { color: colors.textTertiary }]}>{index + 1}</Text>
      <TrackArtwork uri={item.thumbnail} blurhash={null} size={50} borderRadius={8} />
      <View style={styles.verticalMeta}>
        <Text style={[styles.verticalTitle, { color: colors.textPrimary }]} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={[styles.verticalArtist, { color: colors.textSecondary }]} numberOfLines={1}>
          {item.author} · {item.reason}
        </Text>
      </View>
      {/* Dismiss × — tells the engine "never recommend this again". The
          button is intentionally subtle so it doesn't compete with the
          primary "+" action. */}
      <HapticPressable
        hapticStyle="light"
        onPress={handleDismiss}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        style={styles.discoverDismissBtn}
      >
        <Ionicons name="close" size={18} color={colors.textTertiary} />
      </HapticPressable>
      <HapticPressable
        hapticStyle="medium"
        onPress={handleAdd}
        disabled={enqueuing || enqueued}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        style={styles.discoverActionBtn}
      >
        <Ionicons
          name={enqueued ? 'checkmark-circle' : 'arrow-down-circle'}
          size={26}
          color={enqueued ? SUCCESS_GREEN : colors.accent}
        />
      </HapticPressable>
    </View>
  );
}

// ─── "Daily Picks" empty state ────────────────────────────────────────────────

function DiscoveringState() {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.discoveringContainer,
        { backgroundColor: colors.bgElevated, borderColor: colors.borderAccent },
      ]}
    >
      <Ionicons name="sparkles" size={28} color={colors.accent} />
      <Text style={[styles.discoveringText, { color: colors.textPrimary }]}>Discovering music for you…</Text>
      <Text style={[styles.discoveringSubtext, { color: colors.textTertiary }]}>Check back soon</Text>
    </View>
  );
}

// ─── Downloads quick-access button ───────────────────────────────────────────

interface DownloadsButtonProps {
  activeCount: number;
  onPress: () => void;
}

function DownloadsQuickButton({ activeCount, onPress }: DownloadsButtonProps) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity
      activeOpacity={0.75}
      onPress={onPress}
      style={[
        styles.downloadsButton,
        { backgroundColor: colors.bgRaised, borderColor: colors.borderAccent },
      ]}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Ionicons name="arrow-down" size={20} color={colors.accent} />
      {activeCount > 0 && (
        <View style={[styles.downloadsBadge, { backgroundColor: colors.accent, borderColor: colors.bg }]}>
          <Text style={[styles.downloadsBadgeText, { color: '#07090D' }]}>
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
  const { colors, isDark } = useTheme();
  // `playOrStream` plays downloaded rows locally and streams not-yet-downloaded
  // rows instantly — the same entry point used across browse/catalog screens.
  const { playOrStream } = usePlayer();

  // `safeTracks` strips non-music junk (WhatsApp voices, UUID-named files,
  // ringtones) before any downstream section sees the library. Every memo
  // below — dailyPicks, recentlyAdded, downloadedFromChakaas, the
  // play-context for the row tap handler — reads from this filtered list.
  const safeTracks = useSafeTracks();
  const recentlyPlayed = useRecentlyPlayed(15);

  // Active download count for the quick-access badge
  const activeDownloadCount = useDownloadStore((s) =>
    s.queue.filter((d) => d.status !== 'done' && d.status !== 'error').length,
  );

  // Bumped each time the user taps "refresh" on the Made For You section
  // OR pulls down to refresh the whole screen. Threaded into the query key
  // so TanStack refetches with `shuffle=true` and surfaces a different
  // sample from the top-of-rank pool.
  const [discoverNonce, setDiscoverNonce] = useState(0);
  const scrollY = useSharedValue(0);

  // Daily picks: tracks downloaded today (added_at in last 24h)
  const dailyPicks = useMemo(() => {
    const oneDayAgo = Math.floor(Date.now() / 1000) - 86400;
    return safeTracks.filter((t) => t.addedAt >= oneDayAgo).slice(0, 10);
  }, [safeTracks]);

  // Recently added: last 7 days
  const recentlyAdded = useMemo(() => {
    const cutoff = SEVEN_DAYS_AGO();
    return safeTracks.filter((t) => t.addedAt >= cutoff).slice(0, 15);
  }, [safeTracks]);

  // Discover — Saavn-backed suggestions ranked by artist affinity (learned +
  // seeded from the user's stated taste). We deliberately do NOT key on
  // `allTracks.length`: a 50-song batch download would otherwise refetch
  // 50 times. Instead we rely on a 5-minute staleTime and let the user
  // bump `discoverNonce` via the section refresh button when they want a
  // fresh sample.
  const { data: discoverItems, isLoading: discoverLoading, isFetching: discoverFetching } = useQuery({
    queryKey: ['discover-feed', discoverNonce],
    queryFn: () => getDiscoverFeed(20, discoverNonce),
    staleTime: 5 * 60 * 1000,
  });

  // Dismiss × on a Discover row — records the song into persistent skip
  // memory and immediately bumps the nonce so a fresh sample appears.
  const handleDismissDiscover = useCallback((item: DiscoverItem) => {
    addToSkipMemory({
      id: item.id ?? null,
      source: 'saavn', // Discover is currently Saavn-backed
      title: item.title,
      artist: item.author,
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setDiscoverNonce((n) => n + 1);
  }, []);

  // "Downloaded from Chakaas" — every track sourced through the in-app
  // download flow, sorted newest first. Source 'local' (device imports) is
  // excluded so this section reflects what Chakaas itself has fetched.
  const downloadedFromChakaas = useMemo(() => {
    return safeTracks
      .filter((t) => t.source === 'saavn' || t.source === 'youtube')
      .slice() // copy before sort
      .sort((a, b) => b.addedAt - a.addedAt);
  }, [safeTracks]);

  // Play a track in context of the full library. `playOrStream` handles both
  // downloaded (local file) and online (stream-on-tap) rows transparently.
  const handleTrackPress = useCallback(
    (track: Track) => {
      void playOrStream(modelToTrack(track), modelsToTracks(safeTracks));
      navigation.navigate('NowPlaying');
    },
    [playOrStream, safeTracks, navigation],
  );

  // Pull-to-refresh actually does something now: bump the discover nonce so
  // "Made For You" re-samples. WatermelonDB observables already keep
  // dailyPicks / recentlyPlayed live, so the rest of the screen is
  // self-refreshing — we just need the spinner to clear when the discover
  // fetch settles, which `isFetching` tracks for us below.
  const handleRefresh = useCallback(() => {
    setDiscoverNonce((n) => n + 1);
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

  // BlurHeader-style backdrop: the frosted tint fades in as the user scrolls
  // so the header lifts away from the content beneath it. Same trick the
  // shared BlurHeader uses; we keep the branded layout here.
  const headerSurfaceStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [0, 60], [0, 1], Extrapolation.CLAMP),
  }));
  const headerHairlineStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [50, 60], [0, 1], Extrapolation.CLAMP),
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
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor={colors.bg}
      />

      {/* ── Sticky frosted header ── */}
      <Animated.View style={[styles.header, headerStyle]}>
        {/* Frosted backdrop fades in on scroll */}
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <BlurView
            intensity={60}
            tint={isDark ? 'dark' : 'light'}
            style={StyleSheet.absoluteFill}
          />
          <Animated.View
            style={[styles.headerSurface, { backgroundColor: colors.overlay }, headerSurfaceStyle]}
            pointerEvents="none"
          />
        </View>

        <View>
          <Text style={[styles.logoText, { color: colors.accent }]}>Chakaas</Text>
          <Text style={[styles.greeting, { color: colors.textSecondary }]}>{getGreeting()}</Text>
        </View>

        {/* Downloads quick-access button — always shown; badge when active */}
        <DownloadsQuickButton
          activeCount={activeDownloadCount}
          onPress={handleDownloadsPress}
        />
        <Animated.View
          style={[styles.headerHairline, { backgroundColor: colors.borderAccent }, headerHairlineStyle]}
        />
      </Animated.View>

      <Animated.ScrollView
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={discoverFetching}
            onRefresh={handleRefresh}
            tintColor={colors.accent}
            colors={[colors.accent]}
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

        {/* ─── Discover (Saavn-backed) ───────────────────────────────────── */}
        <View style={styles.section}>
          <SectionHeader
            title="Made For You"
            onRefresh={() => setDiscoverNonce((n) => n + 1)}
            refreshing={discoverFetching}
          />
          {discoverLoading && (discoverItems ?? []).length === 0 ? (
            // Polished shimmer rows — same dimensions as the real list so the
            // transition to loaded content doesn't reflow.
            <View>
              {[0, 1, 2, 3].map((i) => (
                <TrackRowSkeleton key={i} />
              ))}
            </View>
          ) : (discoverItems ?? []).length === 0 ? (
            <DiscoveringState />
          ) : (
            // While a refetch is running we dim the existing rows so it's
            // visible that fresh picks are on the way without yanking the
            // list out from under the user.
            <View style={discoverFetching ? styles.discoverDimmed : undefined}>
              {(discoverItems ?? [])
                .slice(0, 8)
                .map((item, index) => (
                  <DiscoverRow
                    key={item.id}
                    item={item}
                    index={index}
                    onDismiss={handleDismissDiscover}
                  />
                ))}
              {discoverFetching && (
                <View style={styles.discoverInlineLoader}>
                  <ActivityIndicator size="small" color={colors.accent} />
                  <Text style={[styles.discoverInlineLoaderText, { color: colors.textSecondary }]}>
                    Finding fresh picks…
                  </Text>
                </View>
              )}
            </View>
          )}
        </View>

        {/* ─── Downloaded from Chakaas (always visible) ──────────────────── */}
        {downloadedFromChakaas.length > 0 && (
          <View style={styles.section}>
            <SectionHeader title="Downloaded from Chakaas" />
            <FlatList
              data={downloadedFromChakaas}
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
  },
  header: {
    paddingTop: Platform.OS === 'ios' ? 56 : 36,
    paddingBottom: 12,
    paddingHorizontal: 20,
    backgroundColor: 'transparent',
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  headerSurface: {
    ...StyleSheet.absoluteFillObject,
  },
  headerHairline: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: StyleSheet.hairlineWidth,
  },
  logoText: {
    fontSize: 36,
    fontWeight: '800',
    letterSpacing: -1.3,
    lineHeight: 40,
  },
  greeting: {
    fontSize: 14,
    fontWeight: '400',
    marginTop: 2,
  },
  // Downloads quick-access button
  downloadsButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
    position: 'relative',
  },
  downloadsButtonIcon: {
    fontSize: 20,
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
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
    borderWidth: 1.5,
  },
  downloadsBadgeText: {
    fontSize: 10,
    fontWeight: '800',
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
  sectionHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  refreshBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
  },
  discoverDimmed: {
    opacity: 0.4,
  },
  discoverInlineLoader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingTop: 12,
    paddingBottom: 4,
  },
  discoverInlineLoaderText: {
    fontSize: 12,
    fontWeight: '500',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  seeAll: {
    fontSize: 13,
    fontWeight: '500',
  },
  horizontalList: {
    paddingHorizontal: 20,
  },
  // Track card
  trackCard: {
    width: 160,
  },
  trackCardPressed: {
    opacity: 0.82,
  },
  trackCardTitleWrap: {
    marginTop: 8,
    width: 160,
  },
  trackCardTitle: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: -0.1,
    lineHeight: 18,
  },
  trackCardArtist: {
    fontSize: 11,
    fontWeight: '400',
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
    textAlign: 'center',
  },
  verticalMeta: {
    flex: 1,
  },
  verticalTitle: {
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: -0.1,
  },
  verticalArtist: {
    fontSize: 12,
    fontWeight: '400',
    marginTop: 2,
  },
  verticalDuration: {
    fontSize: 12,
    fontWeight: '400',
  },
  discoverActionBtn: {
    width: 38,
    height: 38,
    justifyContent: 'center',
    alignItems: 'center',
  },
  discoverDismissBtn: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
    opacity: 0.7,
  },
  // Discovering state
  discoveringContainer: {
    height: 120,
    marginHorizontal: 20,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  discoveringIcon: {
    fontSize: 22,
  },
  discoveringText: {
    fontSize: 15,
    fontWeight: '600',
  },
  discoveringSubtext: {
    fontSize: 12,
    fontWeight: '400',
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
    opacity: 0.7,
  },
  skeletonLine2: {
    height: 10,
    width: '45%',
    borderRadius: 5,
    opacity: 0.5,
  },
});
