import React, { useCallback, useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  type ListRenderItemInfo,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { playsCollection } from '@/db';
import type { Play } from '@/db/models/Play';
import { useMostPlayed } from '@/hooks/useTrackDB';
import { usePlayer } from '@/features/player/usePlayer';
import { TrackArtwork } from '@/components/track/TrackArtwork';
import { useTheme } from '@/theme';
import type { Track } from '@/db/models/Track';
import { modelToTrack, modelsToTracks } from '@/utils/trackMapper';
import type { RootStackNavigationProp } from '@/types/navigation';

// ─── Props ────────────────────────────────────────────────────────────────────

interface MostPlayedSectionProps {
  /** Maximum number of tracks to display. Defaults to 5. */
  limit?: number;
}

// ─── Play count hook ──────────────────────────────────────────────────────────

/**
 * Returns a map of trackId → play count, updated reactively.
 */
function usePlayCounts(): Map<string, number> {
  const [counts, setCounts] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    const subscription = playsCollection
      .query()
      .observe()
      .subscribe({
        next: (plays: Play[]) => {
          const map = new Map<string, number>();
          for (const play of plays) {
            map.set(play.trackId, (map.get(play.trackId) ?? 0) + 1);
          }
          setCounts(map);
        },
        error: () => {},
      });

    return () => subscription.unsubscribe();
  }, []);

  return counts;
}

// ─── Track card ───────────────────────────────────────────────────────────────

interface MostPlayedCardProps {
  track: Track;
  playCount: number;
  onPress: (track: Track) => void;
}

function MostPlayedCard({ track, playCount, onPress }: MostPlayedCardProps) {
  const { colors } = useTheme();
  const handlePress = useCallback(() => onPress(track), [track, onPress]);

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={handlePress}
      style={cardStyles.container}
    >
      {/* Album art */}
      <View style={cardStyles.artworkWrapper}>
        <TrackArtwork
          uri={track.artworkPath}
          blurhash={null}
          size={140}
          borderRadius={12}
        />
        {/* Play count badge — cyan HUD chip */}
        <View style={[cardStyles.badge, { backgroundColor: colors.overlay, borderColor: colors.borderAccent }]}>
          <Text style={[cardStyles.badgeText, { color: colors.accent }]}>
            {playCount} {playCount === 1 ? 'play' : 'plays'}
          </Text>
        </View>
      </View>

      {/* Title below artwork */}
      <Text style={[cardStyles.title, { color: colors.textPrimary }]} numberOfLines={2}>
        {track.title}
      </Text>
      <Text style={[cardStyles.artist, { color: colors.textSecondary }]} numberOfLines={1}>
        {track.artist}
      </Text>
    </TouchableOpacity>
  );
}

const cardStyles = StyleSheet.create({
  container: {
    width: 140,
  },
  artworkWrapper: {
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderWidth: StyleSheet.hairlineWidth,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  title: {
    marginTop: 8,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: -0.1,
    lineHeight: 18,
  },
  artist: {
    fontSize: 11,
    fontWeight: '400',
    marginTop: 2,
  },
});

// ─── Section header ───────────────────────────────────────────────────────────

function MostPlayedHeader() {
  const { colors } = useTheme();
  return (
    <View style={headerStyles.container}>
      <Text style={[headerStyles.title, { color: colors.textPrimary }]}>Most Played</Text>
    </View>
  );
}

const headerStyles = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    marginBottom: 14,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
});

// ─── Main component ───────────────────────────────────────────────────────────

export function MostPlayedSection({ limit = 5 }: MostPlayedSectionProps) {
  const navigation = useNavigation<RootStackNavigationProp>();
  // `playOrStream` plays downloaded rows locally and streams online rows —
  // most-played rows are downloaded, but routing through the same entry point
  // keeps tap-to-play behaviour consistent across the app.
  const { playOrStream } = usePlayer();
  const tracks = useMostPlayed(limit);
  const playCounts = usePlayCounts();

  const handleTrackPress = useCallback(
    (track: Track) => {
      void playOrStream(modelToTrack(track), modelsToTracks(tracks));
      navigation.navigate('NowPlaying');
    },
    [playOrStream, tracks, navigation],
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<Track>) => (
      <MostPlayedCard
        track={item}
        playCount={playCounts.get(item.id) ?? 0}
        onPress={handleTrackPress}
      />
    ),
    [handleTrackPress, playCounts],
  );

  const keyExtractor = useCallback((item: Track) => item.id, []);

  if (tracks.length === 0) return null;

  return (
    <View style={styles.container}>
      <MostPlayedHeader />
      <FlatList
        data={tracks}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={{ width: 14 }} />}
        scrollEventThrottle={16}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    // Outer wrapper; parent screen controls margin/spacing
  },
  listContent: {
    paddingHorizontal: 20,
  },
});
