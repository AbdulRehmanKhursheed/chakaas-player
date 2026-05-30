import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import FastImage from 'react-native-fast-image';
import { Ionicons } from '@expo/vector-icons';
import { normalizeLocalUri } from '@/utils/layout';
import { useTheme } from '@/theme';

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
  const { colors } = useTheme();
  const handlePress = useCallback(() => onPress(album), [album, onPress]);

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={handlePress}
      style={[
        styles.card,
        { backgroundColor: colors.bgElevated, borderColor: colors.border },
      ]}
      accessibilityLabel={`${album.name} by ${album.artist}`}
      accessibilityRole="button"
    >
      {/* Square artwork — edge-to-edge */}
      <View style={[styles.artworkContainer, { backgroundColor: colors.bgRaised }]}>
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
          <View
            style={[
              styles.artwork,
              styles.artworkPlaceholder,
              { backgroundColor: colors.accentMuted },
            ]}
          >
            <Ionicons name="musical-notes" size={34} color={colors.accent} />
          </View>
        )}
      </View>

      {/* Text metadata */}
      <View style={styles.textContainer}>
        <Text style={[styles.albumName, { color: colors.textPrimary }]} numberOfLines={1}>
          {album.name}
        </Text>
        <Text style={[styles.artistName, { color: colors.textSecondary }]} numberOfLines={1}>
          {album.artist}
        </Text>
        <Text style={[styles.trackCount, { color: colors.textTertiary }]}>
          {album.trackCount} {album.trackCount === 1 ? 'song' : 'songs'}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── Grid Component ───────────────────────────────────────────────────────────

export function AlbumGrid({ albums, onPress, contentBottomPadding = 100 }: AlbumGridProps) {
  const { colors } = useTheme();
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
        <Ionicons name="albums" size={40} color={colors.accent} />
        <Text style={[styles.emptyTitle, { color: colors.textPrimary }]}>No albums yet</Text>
        <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
          Add music to see your albums
        </Text>
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
  // Card — soft elevation via hairline + elevated surface (no heavy shadow).
  card: {
    flex: 1,
    margin: GAP / 2,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },

  // Artwork — always square, edge-to-edge
  artworkContainer: {
    width: '100%',
    aspectRatio: 1,
  },
  artwork: {
    width: '100%',
    height: '100%',
  },
  artworkPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
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
    letterSpacing: -0.1,
  },
  artistName: {
    fontSize: 11,
    fontWeight: '400',
  },
  trackCount: {
    fontSize: 10,
    fontWeight: '500',
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
  },
  emptySubtitle: {
    fontSize: 13,
    fontWeight: '400',
  },
});
