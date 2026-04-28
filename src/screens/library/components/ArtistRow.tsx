import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
} from 'react-native';
import FastImage from 'react-native-fast-image';

// ─── Props ────────────────────────────────────────────────────────────────────

interface ArtistRowProps {
  artist: string;
  trackCount: number;
  artworkPath: string | null;
  onPress: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns a deterministic background color for the initial-letter placeholder.
 * Uses the same palette hashing approach as TrackArtwork so the app feels
 * visually consistent.
 */
const PLACEHOLDER_COLORS = [
  '#FFF1F3',
  '#EAF2FF',
  '#F7EFFB',
  '#F8F5EC',
  '#EEF8F1',
  '#F2F2F7',
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

export function ArtistRow({
  artist,
  trackCount,
  artworkPath,
  onPress,
}: ArtistRowProps) {
  const handlePress = useCallback(() => onPress(), [onPress]);

  const placeholderColor = getPlaceholderColor(artist);
  const initial = getInitial(artist);

  return (
    <TouchableOpacity
      activeOpacity={0.75}
      onPress={handlePress}
      style={styles.container}
      accessibilityLabel={`${artist}, ${trackCount} ${trackCount === 1 ? 'song' : 'songs'}`}
      accessibilityRole="button"
    >
      {/* Left: circular artist photo or initial placeholder */}
      <View style={styles.avatarWrapper}>
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
            <Text style={styles.avatarInitial}>{initial}</Text>
          </View>
        )}
      </View>

      {/* Center: name + song count */}
      <View style={styles.textContainer}>
        <Text style={styles.artistName} numberOfLines={1}>
          {artist}
        </Text>
        <Text style={styles.songCount}>
          {trackCount} {trackCount === 1 ? 'song' : 'songs'}
        </Text>
      </View>

      {/* Right: chevron */}
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );
}

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
    borderBottomColor: '#F2F2F7',
  },

  // Avatar
  avatarWrapper: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: '#D2D2D7',
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 8,
      },
      android: { elevation: 3 },
    }),
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
    color: '#FA233B',
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
    color: '#1D1D1F',
    letterSpacing: -0.2,
  },
  songCount: {
    fontSize: 12,
    fontWeight: '400',
    color: '#6E6E73',
  },

  // Chevron
  chevron: {
    fontSize: 22,
    color: '#8E8E93',
    fontWeight: '300',
    marginRight: 2,
  },
});
