import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
} from 'react-native';
import FastImage from 'react-native-fast-image';
import { Ionicons } from '@expo/vector-icons';

// ─── Props ────────────────────────────────────────────────────────────────────

interface GenreCardProps {
  genre: string;
  trackCount: number;
  artworks: string[]; // Up to 4 artwork URIs for the 2×2 collage
  onPress: () => void;
}

// ─── Placeholder color helper ─────────────────────────────────────────────────

const GENRE_COLORS = [
  '#FFF1F3',
  '#EAF2FF',
  '#F7EFFB',
  '#F8F5EC',
  '#EEF8F1',
  '#F2F2F7',
];

function getGenreColor(genre: string): string {
  let hash = 0;
  for (let i = 0; i < genre.length; i++) {
    hash = genre.charCodeAt(i) + ((hash << 5) - hash);
  }
  return GENRE_COLORS[Math.abs(hash) % GENRE_COLORS.length];
}

// ─── 2×2 artwork collage ──────────────────────────────────────────────────────

const COLLAGE_SIZE = 80;
const THUMB_SIZE = COLLAGE_SIZE / 2 - 1; // 1px gap between images

interface CollageProps {
  artworks: string[];
  placeholderColor: string;
}

function ArtworkCollage({ artworks, placeholderColor }: CollageProps) {
  if (artworks.length === 0) {
    return (
      <View style={[collageStyles.container, { backgroundColor: placeholderColor }]}>
        <Ionicons name="musical-notes" size={32} color="#FA233B" />
      </View>
    );
  }

  if (artworks.length === 1) {
    return (
      <View style={collageStyles.container}>
        <FastImage
          source={{
            uri: artworks[0],
            priority: FastImage.priority.normal,
            cache: FastImage.cacheControl.immutable,
          }}
          style={collageStyles.singleArtwork}
          resizeMode={FastImage.resizeMode.cover}
        />
      </View>
    );
  }

  // 2×2 or partial grid
  const slots = [artworks[0], artworks[1] ?? null, artworks[2] ?? null, artworks[3] ?? null];

  return (
    <View style={collageStyles.container}>
      <View style={collageStyles.grid}>
        {slots.map((uri, idx) => (
          <View
            key={idx}
            style={[
              collageStyles.thumb,
              { backgroundColor: placeholderColor },
            ]}
          >
            {uri ? (
              <FastImage
                source={{
                  uri,
                  priority: FastImage.priority.low,
                  cache: FastImage.cacheControl.immutable,
                }}
                style={StyleSheet.absoluteFill}
                resizeMode={FastImage.resizeMode.cover}
              />
            ) : (
              <Ionicons name="musical-note" size={14} color="#FA233B" />
            )}
          </View>
        ))}
      </View>
    </View>
  );
}

const collageStyles = StyleSheet.create({
  container: {
    width: COLLAGE_SIZE,
    height: COLLAGE_SIZE,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#F2F2F7',
    justifyContent: 'center',
    alignItems: 'center',
  },
  singleArtwork: {
    width: COLLAGE_SIZE,
    height: COLLAGE_SIZE,
  },
  grid: {
    width: COLLAGE_SIZE,
    height: COLLAGE_SIZE,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 2,
    // The gap creates a 2×2 layout with exactly 2px between images
    // Each thumb fills half the container minus the gap
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
});

// ─── Genre Card ───────────────────────────────────────────────────────────────

export function GenreCard({ genre, trackCount, artworks, onPress }: GenreCardProps) {
  const handlePress = useCallback(() => onPress(), [onPress]);
  const placeholderColor = getGenreColor(genre);

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={handlePress}
      style={styles.card}
      accessibilityLabel={`${genre}, ${trackCount} ${trackCount === 1 ? 'song' : 'songs'}`}
      accessibilityRole="button"
    >
      <View style={styles.accentBar} />

      {/* Artwork collage */}
      <View style={styles.artworkWrapper}>
        <ArtworkCollage artworks={artworks} placeholderColor={placeholderColor} />
      </View>

      {/* Text content */}
      <View style={styles.textContainer}>
        <Text style={styles.genreName} numberOfLines={1}>
          {genre}
        </Text>
        <Text style={styles.songCount}>
          {trackCount} {trackCount === 1 ? 'song' : 'songs'}
        </Text>
      </View>

      {/* Chevron */}
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 100,
    marginBottom: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(60,60,67,0.10)',
    paddingRight: 16,
    gap: 14,
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.08,
        shadowRadius: 12,
      },
      android: { elevation: 4 },
    }),
  },

  // 4px accent left border
  accentBar: {
    width: 4,
    alignSelf: 'stretch',
    backgroundColor: '#FA233B',
  },

  artworkWrapper: {
    // slight shadow for artwork
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.4,
        shadowRadius: 6,
      },
      android: { elevation: 3 },
    }),
  },

  textContainer: {
    flex: 1,
    justifyContent: 'center',
    gap: 5,
  },
  genreName: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1D1D1F',
    letterSpacing: -0.2,
  },
  songCount: {
    fontSize: 13,
    fontWeight: '400',
    color: '#6E6E73',
  },
  chevron: {
    fontSize: 24,
    color: '#3A3A3A',
    fontWeight: '300',
  },
});
