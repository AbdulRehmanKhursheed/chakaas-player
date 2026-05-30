import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import FastImage from 'react-native-fast-image';
import { useTheme } from '@/theme';

// ─── Props ────────────────────────────────────────────────────────────────────

interface ArtistRowProps {
  artist: string;
  trackCount: number;
  artworkPath: string | null;
  /**
   * Receives the artist name so the parent can keep one referentially-stable
   * handler — re-issuing a fresh inline arrow per row defeats `React.memo`.
   */
  onPress: (artist: string) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns a deterministic background tint for the initial-letter placeholder.
 * Uses the same hashing approach as TrackArtwork so the app feels visually
 * consistent — recoloured to subtle cool HUD tints on the dark canvas.
 */
const PLACEHOLDER_COLORS = [
  'rgba(25,227,255,0.14)',
  'rgba(10,132,255,0.14)',
  'rgba(95,240,255,0.12)',
  'rgba(245,182,66,0.12)',
  'rgba(52,211,153,0.12)',
  'rgba(255,255,255,0.06)',
];

function getPlaceholderColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return PLACEHOLDER_COLORS[Math.abs(hash) % PLACEHOLDER_COLORS.length];
}

function getInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?';
}

// ─── Component ────────────────────────────────────────────────────────────────

function ArtistRowImpl({
  artist,
  trackCount,
  artworkPath,
  onPress,
}: ArtistRowProps) {
  const { colors } = useTheme();
  const handlePress = useCallback(() => onPress(artist), [artist, onPress]);

  const placeholderColor = getPlaceholderColor(artist);
  const initial = getInitial(artist);

  return (
    <TouchableOpacity
      activeOpacity={0.75}
      onPress={handlePress}
      style={[styles.container, { borderBottomColor: colors.border }]}
      accessibilityLabel={`${artist}, ${trackCount} ${trackCount === 1 ? 'song' : 'songs'}`}
      accessibilityRole="button"
    >
      {/* Left: circular artist photo or initial placeholder */}
      <View style={[styles.avatarWrapper, { borderColor: colors.borderAccent }]}>
        {artworkPath ? (
          <FastImage
            source={{
              uri: artworkPath,
              priority: FastImage.priority.normal,
              cache: FastImage.cacheControl.immutable,
            }}
            style={styles.avatar}
            resizeMode={FastImage.resizeMode.cover}
          />
        ) : (
          <View style={[styles.avatar, styles.avatarPlaceholder, { backgroundColor: placeholderColor }]}>
            <Text style={[styles.avatarInitial, { color: colors.accent }]}>{initial}</Text>
          </View>
        )}
      </View>

      {/* Center: name + song count */}
      <View style={styles.textContainer}>
        <Text style={[styles.artistName, { color: colors.textPrimary }]} numberOfLines={1}>
          {artist}
        </Text>
        <Text style={[styles.songCount, { color: colors.textSecondary }]}>
          {trackCount} {trackCount === 1 ? 'song' : 'songs'}
        </Text>
      </View>

      {/* Right: chevron */}
      <Text style={[styles.chevron, { color: colors.textTertiary }]}>›</Text>
    </TouchableOpacity>
  );
}

/**
 * Memoised: the artist-list scroll re-rendered every visible row whenever
 * `safeTracks` ticked elsewhere. Equality compares displayed props plus the
 * referentially-stable `onPress` from the parent (kept stable via useCallback;
 * the row passes the artist name back at press time).
 */
export const ArtistRow = React.memo(ArtistRowImpl, (prev, next) => {
  if (prev.artist !== next.artist) return false;
  if (prev.trackCount !== next.trackCount) return false;
  if (prev.artworkPath !== next.artworkPath) return false;
  if (prev.onPress !== next.onPress) return false;
  return true;
});

// ─── Styles ───────────────────────────────────────────────────────────────────

const AVATAR_SIZE = 44;
const ROW_HEIGHT = 64;

const styles = StyleSheet.create({
  container: {
    height: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },

  // Avatar — cyan HUD hairline ring, no heavy shadow.
  avatarWrapper: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    overflow: 'hidden',
    borderWidth: 1,
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
  },
  avatarPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarInitial: {
    fontSize: 18,
    fontWeight: '700',
  },

  // Text
  textContainer: {
    flex: 1,
    justifyContent: 'center',
    gap: 3,
  },
  artistName: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  songCount: {
    fontSize: 12,
    fontWeight: '400',
  },

  // Chevron
  chevron: {
    fontSize: 22,
    fontWeight: '300',
    marginRight: 2,
  },
});
