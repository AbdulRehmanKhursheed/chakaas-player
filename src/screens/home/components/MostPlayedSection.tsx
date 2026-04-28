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
import { usePlayerQueue } from '@/features/player/useQueue';
import { TrackArtwork } from '@/components/track/TrackArtwork';
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
        {/* Play count badge */}
        <View style={cardStyles.badge}>
          <Text style={cardStyles.badgeText}>
            {playCount} {playCount === 1 ? 'play' : 'plays'}
          </Text>
        </View>
      </View>

      {/* Title below artwork */}
      <Text style={cardStyles.title} numberOfLines={2}>
        {track.title}
      </Text>
      <Text style={cardStyles.artist} numberOfLines={1}>
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
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FA233B',
    letterSpacing: 0.2,
  },
  title: {
    marginTop: 8,
    fontSize: 13,
    fontWeight: '600',
    color: '#1D1D1F',
    letterSpacing: -0.1,
    lineHeight: 18,
  },
  artist: {
    fontSize: 11,
    fontWeight: '400',
    color: '#6E6E73',
    marginTop: 2,
  },
});

// ─── Section header ───────────────────────────────────────────────────────────

function MostPlayedHeader() {
  return (
    <View style={headerStyles.container}>
      <Text style={headerStyles.title}>Most Played</Text>
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
    color: '#1D1D1F',
    letterSpacing: -0.3,
  },
});

// ─── Main component ───────────────────────────────────────────────────────────

export function MostPlayedSection({ limit = 5 }: MostPlayedSectionProps) {
  const navigation = useNavigation<RootStackNavigationProp>();
  const { playTrack } = usePlayerQueue();
  const tracks = useMostPlayed(limit);
  const playCounts = usePlayCounts();

  const handleTrackPress = useCallback(
    (track: Track) => {
      void playTrack(modelToTrack(track), modelsToTracks(tracks));
      navigation.navigate('NowPlaying');
    },
    [playTrack, tracks, navigation],
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
