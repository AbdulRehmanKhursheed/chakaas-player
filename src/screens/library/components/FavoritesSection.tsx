import React, { useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  type ListRenderItemInfo,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useLikedTracks } from '@/hooks/useTrackDB';
import { usePlayerQueue } from '@/features/player/useQueue';
import { TrackArtwork } from '@/components/track/TrackArtwork';
import type { Track } from '@/db/models/Track';
import { modelToTrack, modelsToTracks } from '@/utils/trackMapper';
import type { RootStackNavigationProp } from '@/types/navigation';

// ─── Props ────────────────────────────────────────────────────────────────────

interface FavoritesSectionProps {
  /** Maximum number of liked tracks to display. Defaults to 10. */
  limit?: number;
}

// ─── Compact track row ────────────────────────────────────────────────────────

interface CompactTrackRowProps {
  track: Track;
  onPress: (track: Track) => void;
}

function CompactTrackRow({ track, onPress }: CompactTrackRowProps) {
  const handlePress = useCallback(() => onPress(track), [track, onPress]);

  return (
    <TouchableOpacity
      activeOpacity={0.78}
      onPress={handlePress}
      style={rowStyles.container}
    >
      <View style={rowStyles.artworkWrapper}>
        <TrackArtwork
          uri={track.artworkPath}
          blurhash={null}
          size={52}
          borderRadius={8}
        />
        <View style={rowStyles.heartBadge}>
          <Ionicons name="heart" size={10} color="#FA233B" />
        </View>
      </View>

      <View style={rowStyles.meta}>
        <Text style={rowStyles.title} numberOfLines={1}>
          {track.title}
        </Text>
        <Text style={rowStyles.artist} numberOfLines={1}>
          {track.artist}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const rowStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 8,
    gap: 12,
  },
  artworkWrapper: {
    position: 'relative',
  },
  heartBadge: {
    position: 'absolute',
    bottom: -3,
    right: -3,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#F5F5F7',
    justifyContent: 'center',
    alignItems: 'center',
  },
  meta: {
    flex: 1,
    justifyContent: 'center',
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1D1D1F',
    letterSpacing: -0.1,
  },
  artist: {
    fontSize: 12,
    fontWeight: '400',
    color: '#6E6E73',
    marginTop: 2,
  },
});

// ─── Empty state ──────────────────────────────────────────────────────────────

function FavoritesEmptyState() {
  return (
    <View style={emptyStyles.container}>
      <Text style={emptyStyles.text}>
        No favorites yet. Tap the heart on any track.
      </Text>
    </View>
  );
}

const emptyStyles = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    paddingVertical: 20,
    alignItems: 'center',
  },
  text: {
    fontSize: 13,
    fontWeight: '400',
    color: '#8E8E93',
    textAlign: 'center',
    lineHeight: 19,
  },
});

// ─── Section header ───────────────────────────────────────────────────────────

interface SectionHeaderProps {
  onSeeAll: () => void;
}

function FavoritesSectionHeader({ onSeeAll }: SectionHeaderProps) {
  return (
    <View style={headerStyles.container}>
      <View style={headerStyles.left}>
        <Ionicons name="heart" size={18} color="#FA233B" />
        <Text style={headerStyles.title}>Favorites</Text>
      </View>
      <TouchableOpacity
        onPress={onSeeAll}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text style={headerStyles.seeAll}>See All</Text>
      </TouchableOpacity>
    </View>
  );
}

const headerStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
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
});

// ─── Main component ───────────────────────────────────────────────────────────

export function FavoritesSection({ limit = 10 }: FavoritesSectionProps) {
  const navigation = useNavigation<RootStackNavigationProp>();
  const { playTrack } = usePlayerQueue();
  const likedTracks = useLikedTracks();

  const displayTracks = likedTracks.slice(0, limit);

  const handleTrackPress = useCallback(
    (track: Track) => {
      void playTrack(modelToTrack(track), modelsToTracks(likedTracks));
      navigation.navigate('NowPlaying');
    },
    [playTrack, likedTracks, navigation],
  );

  const handleSeeAll = useCallback(() => {
    // Navigate to Library tab; the Library screen manages its own filter state.
    // Using navigate with the MainTabs route so we switch tab correctly.
    (navigation as any).navigate('MainTabs', { screen: 'Library', params: { filter: 'liked' } });
  }, [navigation]);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<Track>) => (
      <CompactTrackRow track={item} onPress={handleTrackPress} />
    ),
    [handleTrackPress],
  );

  const keyExtractor = useCallback((item: Track) => item.id, []);

  const ItemSeparator = useCallback(
    () => (
      <View
        style={{
          height: StyleSheet.hairlineWidth,
          backgroundColor: '#F2F2F7',
          marginLeft: 84,
        }}
      />
    ),
    [],
  );

  return (
    <View style={styles.container}>
      <FavoritesSectionHeader onSeeAll={handleSeeAll} />

      {displayTracks.length === 0 ? (
        <FavoritesEmptyState />
      ) : (
        <FlatList
          data={displayTracks}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          ItemSeparatorComponent={ItemSeparator}
          scrollEnabled={false}
        />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    // Outer wrapper; parent screen controls margin/spacing
  },
});
