import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import FastImage from 'react-native-fast-image';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme';

// ─── Props ────────────────────────────────────────────────────────────────────

interface GenreCardProps {
  genre: string;
  trackCount: number;
  artworks: string[]; // Up to 4 artwork URIs for the 2×2 collage
  /**
   * Receives the genre string so the parent can keep a single referentially-
   * stable handler across every card. Avoids the inline-arrow pitfall that
   * defeats `React.memo` on this component.
   */
  onPress: (genre: string) => void;
}

// ─── Placeholder color helper ─────────────────────────────────────────────────

const GENRE_COLORS = [
  'rgba(25,227,255,0.14)',
  'rgba(10,132,255,0.14)',
  'rgba(95,240,255,0.12)',
  'rgba(245,182,66,0.12)',
  'rgba(52,211,153,0.12)',
  'rgba(255,255,255,0.06)',
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
  const { colors } = useTheme();
  if (artworks.length === 0) {
    return (
      <View style={[collageStyles.container, { backgroundColor: placeholderColor }]}>
        <Ionicons name="musical-notes" size={32} color={colors.accent} />
      </View>
    );
  }

  if (artworks.length === 1) {
    return (
      <View style={[collageStyles.container, { backgroundColor: colors.bgRaised }]}>
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
    <View style={[collageStyles.container, { backgroundColor: colors.bgRaised }]}>
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
              <Ionicons name="musical-note" size={14} color={colors.accent} />
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
    borderRadius: 12,
    overflow: 'hidden',
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

function GenreCardImpl({ genre, trackCount, artworks, onPress }: GenreCardProps) {
  const { colors } = useTheme();
  const handlePress = useCallback(() => onPress(genre), [genre, onPress]);
  const placeholderColor = getGenreColor(genre);

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={handlePress}
      style={[styles.card, { backgroundColor: colors.bgElevated, borderColor: colors.border }]}
      accessibilityLabel={`${genre}, ${trackCount} ${trackCount === 1 ? 'song' : 'songs'}`}
      accessibilityRole="button"
    >
      <View style={[styles.accentBar, { backgroundColor: colors.accent }]} />

      {/* Artwork collage */}
      <View style={styles.artworkWrapper}>
        <ArtworkCollage artworks={artworks} placeholderColor={placeholderColor} />
      </View>

      {/* Text content */}
      <View style={styles.textContainer}>
        <Text style={[styles.genreName, { color: colors.textPrimary }]} numberOfLines={1}>
          {genre}
        </Text>
        <Text style={[styles.songCount, { color: colors.textSecondary }]}>
          {trackCount} {trackCount === 1 ? 'song' : 'songs'}
        </Text>
      </View>

      {/* Chevron */}
      <Text style={[styles.chevron, { color: colors.textTertiary }]}>›</Text>
    </TouchableOpacity>
  );
}

/**
 * Memoised so a Library scroll doesn't re-render every genre tile when only
 * an unrelated piece of state changes upstream. Equality is shallow over the
 * displayed props plus the `onPress` identity, which the parent keeps stable
 * via `useCallback` (the row passes the genre string at press time).
 */
export const GenreCard = React.memo(GenreCardImpl, (prev, next) => {
  if (prev.genre !== next.genre) return false;
  if (prev.trackCount !== next.trackCount) return false;
  if (prev.onPress !== next.onPress) return false;
  if (prev.artworks.length !== next.artworks.length) return false;
  for (let i = 0; i < prev.artworks.length; i++) {
    if (prev.artworks[i] !== next.artworks[i]) return false;
  }
  return true;
});

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Soft elevation: elevated surface + cyan-tintable hairline. No heavy shadow.
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 100,
    marginBottom: 10,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    paddingRight: 16,
    gap: 14,
  },

  // 4px cyan accent left border
  accentBar: {
    width: 4,
    alignSelf: 'stretch',
  },

  artworkWrapper: {},

  textContainer: {
    flex: 1,
    justifyContent: 'center',
    gap: 5,
  },
  genreName: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  songCount: {
    fontSize: 13,
    fontWeight: '400',
  },
  chevron: {
    fontSize: 24,
    fontWeight: '300',
  },
});
