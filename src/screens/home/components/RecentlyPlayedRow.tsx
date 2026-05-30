import React, { useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
} from 'react-native';
import FastImage from 'react-native-fast-image';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme';
import type { Track } from '@/db/models/Track';

// ─── Types ────────────────────────────────────────────────────────────────────

interface RecentlyPlayedRowProps {
  tracks: Track[];
  onTrackPress: (track: Track) => void;
}

interface ItemProps {
  track: Track;
  onPress: (track: Track) => void;
}

// ─── Single item ──────────────────────────────────────────────────────────────

function RecentItem({ track, onPress }: ItemProps) {
  const { colors } = useTheme();
  const handlePress = useCallback(() => onPress(track), [track, onPress]);
  const artworkUri = track.artworkPath ?? undefined;

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={handlePress}
      style={styles.item}
    >
      {/* Circle artwork with cyan HUD hairline */}
      <View
        style={[
          styles.artworkWrapper,
          { backgroundColor: colors.bgRaised, borderColor: colors.borderAccent },
        ]}
      >
        {artworkUri ? (
          <FastImage
            source={{
              uri: artworkUri,
              priority: FastImage.priority.normal,
              cache: FastImage.cacheControl.immutable,
            }}
            style={styles.artwork}
            resizeMode={FastImage.resizeMode.cover}
          />
        ) : (
          <View style={[styles.artwork, styles.artworkPlaceholder, { backgroundColor: colors.bgRaised }]}>
            <Ionicons name="musical-notes" size={28} color={colors.accent} />
          </View>
        )}
      </View>

      {/* Track name */}
      <Text style={[styles.name, { color: colors.textSecondary }]} numberOfLines={2}>
        {track.title}
      </Text>
    </TouchableOpacity>
  );
}

// ─── Row ──────────────────────────────────────────────────────────────────────

export function RecentlyPlayedRow({ tracks, onTrackPress }: RecentlyPlayedRowProps) {
  const renderItem = useCallback(
    ({ item }: { item: Track }) => (
      <RecentItem track={item} onPress={onTrackPress} />
    ),
    [onTrackPress],
  );

  const keyExtractor = useCallback((item: Track) => item.id, []);

  if (tracks.length === 0) return null;

  return (
    <FlatList
      data={tracks}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.list}
      ItemSeparatorComponent={() => <View style={{ width: 16 }} />}
    />
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  list: {
    paddingHorizontal: 20,
  },
  item: {
    width: 80,
    alignItems: 'center',
  },
  artworkWrapper: {
    width: 80,
    height: 80,
    borderRadius: 40,
    overflow: 'hidden',
    borderWidth: 1.5,
  },
  artwork: {
    width: 80,
    height: 80,
    borderRadius: 40,
  },
  artworkPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  name: {
    marginTop: 8,
    fontSize: 11,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 15,
  },
});
