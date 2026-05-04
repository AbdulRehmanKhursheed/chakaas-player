import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  Platform,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import FastImage from 'react-native-fast-image';
import { Ionicons } from '@expo/vector-icons';
import { normalizeLocalUri } from '@/utils/layout';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AlbumItem {
  name: string;
  artist: string;
  artworkPath: string | null;
  trackCount: number;
}

interface AlbumGridProps {
  albums: AlbumItem[];
  onPress: (album: AlbumItem) => void;
  /** Bottom padding so the last row clears the floating tab bar + MiniPlayer. */
  contentBottomPadding?: number;
}

// ─── Layout constants ─────────────────────────────────────────────────────────

const SCREEN_WIDTH = Dimensions.get('window').width;
const COLUMN_COUNT = 2;
const HORIZONTAL_PADDING = 16;
const GAP = 8;

// Card width: split screen minus outer padding on both sides minus the single
// gap between the two columns.
const CARD_WIDTH =
  (SCREEN_WIDTH - HORIZONTAL_PADDING * 2 - GAP) / COLUMN_COUNT;

// ─── Album Card ───────────────────────────────────────────────────────────────

interface AlbumCardProps {
  album: AlbumItem;
  onPress: (album: AlbumItem) => void;
}

function AlbumCard({ album, onPress }: AlbumCardProps) {
  const handlePress = useCallback(() => onPress(album), [album, onPress]);

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={handlePress}
      style={styles.card}
      accessibilityLabel={`${album.name} by ${album.artist}`}
      accessibilityRole="button"
    >
      {/* Square artwork */}
      <View style={styles.artworkContainer}>
        {album.artworkPath ? (
          <FastImage
            source={{
              uri: normalizeLocalUri(album.artworkPath) ?? album.artworkPath,
              priority: FastImage.priority.normal,
              cache: FastImage.cacheControl.immutable,
            }}
            style={styles.artwork}
            resizeMode={FastImage.resizeMode.cover}
          />
        ) : (
          <View style={[styles.artwork, styles.artworkPlaceholder]}>
            <Ionicons name="musical-notes" size={34} color="#FA233B" />
          </View>
        )}
      </View>

      {/* Text metadata */}
      <View style={styles.textContainer}>
        <Text style={styles.albumName} numberOfLines={1}>
          {album.name}
        </Text>
        <Text style={styles.artistName} numberOfLines={1}>
          {album.artist}
        </Text>
        <Text style={styles.trackCount}>
          {album.trackCount} {album.trackCount === 1 ? 'song' : 'songs'}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── Grid Component ───────────────────────────────────────────────────────────

export function AlbumGrid({ albums, onPress, contentBottomPadding = 100 }: AlbumGridProps) {
  const renderItem = useCallback(
    ({ item }: { item: AlbumItem }) => (
      <AlbumCard album={item} onPress={onPress} />
    ),
    [onPress],
  );

  const keyExtractor = useCallback(
    (item: AlbumItem, index: number) => `${item.name}-${item.artist}-${index}`,
    [],
  );

  if (albums.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Ionicons name="albums" size={40} color="#FA233B" />
        <Text style={styles.emptyTitle}>No albums yet</Text>
        <Text style={styles.emptySubtitle}>Add music to see your albums</Text>
      </View>
    );
  }

  return (
    <FlashList
      data={albums}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      numColumns={COLUMN_COUNT}
      estimatedItemSize={CARD_WIDTH + 64}
      contentContainerStyle={{
        padding: HORIZONTAL_PADDING,
        paddingBottom: contentBottomPadding,
      }}
      showsVerticalScrollIndicator={false}
    />
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Card
  card: {
    flex: 1,
    margin: GAP / 2,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#F2F2F7',
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.5,
        shadowRadius: 8,
      },
      android: { elevation: 4 },
    }),
  },

  // Artwork — always square
  artworkContainer: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: '#F2F2F7',
  },
  artwork: {
    width: '100%',
    height: '100%',
  },
  artworkPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFF1F3',
  },

  // Text area below artwork
  textContainer: {
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 10,
    gap: 2,
  },
  albumName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1D1D1F',
    letterSpacing: -0.1,
  },
  artistName: {
    fontSize: 11,
    fontWeight: '400',
    color: '#6E6E73',
  },
  trackCount: {
    fontSize: 10,
    fontWeight: '500',
    color: '#8E8E93',
    marginTop: 2,
  },

  // Empty state
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 80,
    gap: 8,
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
