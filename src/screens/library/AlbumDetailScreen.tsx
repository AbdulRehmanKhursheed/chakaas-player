import React, { useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  StatusBar,
  ActionSheetIOS,
  Alert,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import FastImage from 'react-native-fast-image';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAllTracks } from '@/hooks/useTrackDB';
import { usePlayerQueue } from '@/features/player/useQueue';
import type { LibraryStackParamList } from '@/app/navigation/LibraryStack';
import type { RootStackNavigationProp } from '@/types/navigation';
import type { Track } from '@/db/models/Track';
import { modelToTrack, modelsToTracks } from '@/utils/trackMapper';

// ─── Route ────────────────────────────────────────────────────────────────────

type AlbumDetailRoute = RouteProp<LibraryStackParamList, 'AlbumDetail'>;

// ─── Constants ────────────────────────────────────────────────────────────────

const ARTWORK_SIZE = 200;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

function formatTotalDuration(totalMs: number): string {
  const totalMin = Math.floor(totalMs / 60000);
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h} hr ${m} min`;
}

function extractYear(_tracks: Track[]): string | null {
  // Try to extract year from file metadata if exposed
  // For now we don't have a year field, so return null
  return null;
}

// ─── Track row ────────────────────────────────────────────────────────────────

interface TrackRowProps {
  track: Track;
  index: number;
  onPress: (track: Track) => void;
  onLongPress: (track: Track) => void;
}

function AlbumTrackRow({ track, index, onPress, onLongPress }: TrackRowProps) {
  const handlePress = useCallback(() => onPress(track), [track, onPress]);
  const handleLongPress = useCallback(() => onLongPress(track), [track, onLongPress]);

  return (
    <TouchableOpacity
      activeOpacity={0.75}
      onPress={handlePress}
      onLongPress={handleLongPress}
      style={trackRowStyles.container}
    >
      {/* Track number */}
      <View style={trackRowStyles.indexContainer}>
        <Text style={trackRowStyles.index}>{index + 1}</Text>
      </View>

      <View style={trackRowStyles.meta}>
        <Text style={trackRowStyles.title} numberOfLines={1}>
          {track.title}
        </Text>
        <Text style={trackRowStyles.artist} numberOfLines={1}>
          {track.artist}
        </Text>
      </View>

      <Text style={trackRowStyles.duration}>{formatDuration(track.durationMs)}</Text>
    </TouchableOpacity>
  );
}

const trackRowStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 11,
    gap: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F2F2F7',
  },
  indexContainer: {
    width: 28,
    alignItems: 'center',
  },
  index: {
    fontSize: 13,
    fontWeight: '500',
    color: '#8E8E93',
  },
  meta: { flex: 1 },
  title: {
    fontSize: 15,
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
  duration: {
    fontSize: 12,
    color: '#8E8E93',
  },
});

// ─── Album header ─────────────────────────────────────────────────────────────

interface AlbumHeaderProps {
  album: string;
  artist: string;
  artworkPath: string | null;
  trackCount: number;
  totalDurationMs: number;
  year: string | null;
  onPlayAll: () => void;
  onShuffle: () => void;
}

function AlbumHeader({
  album,
  artist,
  artworkPath,
  trackCount,
  totalDurationMs,
  year,
  onPlayAll,
  onShuffle,
}: AlbumHeaderProps) {
  return (
    <View style={headerStyles.container}>
      {/* Album artwork */}
      <View style={headerStyles.artworkWrapper}>
        {artworkPath ? (
          <FastImage
            source={{
              uri: artworkPath,
              priority: FastImage.priority.high,
              cache: FastImage.cacheControl.immutable,
            }}
            style={headerStyles.artwork}
            resizeMode={FastImage.resizeMode.cover}
          />
        ) : (
          <View style={[headerStyles.artwork, headerStyles.artworkPlaceholder]}>
            <Ionicons name="musical-notes" size={56} color="#FA233B" />
          </View>
        )}
      </View>

      {/* Album name */}
      <Text style={headerStyles.albumName} numberOfLines={3}>
        {album}
      </Text>

      {/* Artist */}
      <Text style={headerStyles.artistName} numberOfLines={1}>
        {artist}
      </Text>

      {/* Meta line: year · tracks · duration */}
      <Text style={headerStyles.meta}>
        {[
          year,
          `${trackCount} ${trackCount === 1 ? 'song' : 'songs'}`,
          totalDurationMs > 0 ? formatTotalDuration(totalDurationMs) : null,
        ]
          .filter(Boolean)
          .join('  ·  ')}
      </Text>

      {/* Action buttons */}
      <View style={headerStyles.buttonRow}>
        <TouchableOpacity
          style={[headerStyles.button, headerStyles.playButton]}
          onPress={onPlayAll}
          activeOpacity={0.85}
          disabled={trackCount === 0}
        >
          <Ionicons name="play" size={16} color="#FFFFFF" />
          <Text style={headerStyles.playButtonText}>Play All</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[headerStyles.button, headerStyles.shuffleButton]}
          onPress={onShuffle}
          activeOpacity={0.85}
          disabled={trackCount === 0}
        >
          <Ionicons name="shuffle" size={16} color="#FA233B" />
          <Text style={headerStyles.shuffleButtonText}>Shuffle</Text>
        </TouchableOpacity>
      </View>

      <View style={headerStyles.separator} />
    </View>
  );
}

const headerStyles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 4,
  },
  artworkWrapper: {
    marginBottom: 20,
    borderRadius: 16,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 16 },
        shadowOpacity: 0.7,
        shadowRadius: 24,
      },
      android: { elevation: 20 },
    }),
  },
  artwork: {
    width: ARTWORK_SIZE,
    height: ARTWORK_SIZE,
    borderRadius: 16,
  },
  artworkPlaceholder: {
    backgroundColor: '#FFF1F3',
    justifyContent: 'center',
    alignItems: 'center',
  },
  albumName: {
    fontSize: 22,
    fontWeight: '800',
    color: '#1D1D1F',
    letterSpacing: -0.4,
    textAlign: 'center',
    lineHeight: 28,
  },
  artistName: {
    fontSize: 15,
    fontWeight: '500',
    color: '#FA233B',
    marginTop: 6,
    textAlign: 'center',
  },
  meta: {
    fontSize: 12,
    fontWeight: '400',
    color: '#8E8E93',
    marginTop: 8,
    textAlign: 'center',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
    width: '100%',
  },
  button: {
    flex: 1,
    height: 46,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7,
  },
  playButton: {
    backgroundColor: '#FA233B',
  },
  playButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  shuffleButton: {
    backgroundColor: '#F2F2F7',
    borderWidth: 1,
    borderColor: '#D2D2D7',
  },
  shuffleButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1D1D1F',
  },
  separator: {
    width: '100%',
    height: 1,
    backgroundColor: '#F2F2F7',
    marginTop: 20,
  },
});

// ─── List item type ────────────────────────────────────────────────────────────

type ListItem =
  | { type: 'header' }
  | { type: 'track'; track: Track; index: number };

// ─── Main screen ──────────────────────────────────────────────────────────────

export function AlbumDetailScreen() {
  const navigation = useNavigation<RootStackNavigationProp>();
  const route = useRoute<AlbumDetailRoute>();
  const { album } = route.params;

  const allTracks = useAllTracks();
  const { playTrack, playNext } = usePlayerQueue();

  // Filter tracks for this album, sorted by title
  const albumTracks = useMemo(() => {
    return allTracks
      .filter((t) => (t.album ?? 'Unknown Album') === album)
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [allTracks, album]);

  // Derive album metadata
  const albumArtwork = useMemo(
    () => albumTracks.find((t) => t.artworkPath)?.artworkPath ?? null,
    [albumTracks],
  );

  const primaryArtist = useMemo(() => {
    if (albumTracks.length === 0) return '';
    // Use most frequent artist
    const counts = new Map<string, number>();
    for (const t of albumTracks) {
      counts.set(t.artist, (counts.get(t.artist) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }, [albumTracks]);

  const totalDurationMs = useMemo(
    () => albumTracks.reduce((acc, t) => acc + t.durationMs, 0),
    [albumTracks],
  );

  const year = extractYear(albumTracks);

  // Build flat list data
  const listData = useMemo((): ListItem[] => {
    const result: ListItem[] = [{ type: 'header' }];
    albumTracks.forEach((track, index) => {
      result.push({ type: 'track', track, index });
    });
    return result;
  }, [albumTracks]);

  // ── Handlers ──

  const handlePlayAll = useCallback(() => {
    if (albumTracks.length === 0) return;
    void playTrack(modelToTrack(albumTracks[0]), modelsToTracks(albumTracks));
    navigation.navigate('NowPlaying');
  }, [albumTracks, playTrack, navigation]);

  const handleShuffle = useCallback(() => {
    if (albumTracks.length === 0) return;
    const shuffled = [...albumTracks].sort(() => Math.random() - 0.5);
    void playTrack(modelToTrack(shuffled[0]), modelsToTracks(shuffled));
    navigation.navigate('NowPlaying');
  }, [albumTracks, playTrack, navigation]);

  const handleTrackPress = useCallback(
    (track: Track) => {
      void playTrack(modelToTrack(track), modelsToTracks(albumTracks));
      navigation.navigate('NowPlaying');
    },
    [albumTracks, playTrack, navigation],
  );

  const handleLongPress = useCallback(
    (track: Track) => {
      const options = ['Play Next', 'Go to Artist', 'Cancel'];
      if (Platform.OS === 'ios') {
        ActionSheetIOS.showActionSheetWithOptions(
          { options, cancelButtonIndex: 2, title: track.title },
          (index) => {
            if (index === 0) void playNext(modelToTrack(track));
            if (index === 1) {
              navigation.navigate('ArtistDetail', { artist: track.artist });
            }
          },
        );
      } else {
        Alert.alert(track.title, undefined, [
          { text: 'Play Next', onPress: () => void playNext(modelToTrack(track)) },
          {
            text: 'Go to Artist',
            onPress: () =>
              navigation.navigate('ArtistDetail', { artist: track.artist }),
          },
          { text: 'Cancel', style: 'cancel' },
        ]);
      }
    },
    [playNext, navigation],
  );

  // ── Render item ──

  const renderItem = useCallback(
    ({ item }: { item: ListItem }) => {
      if (item.type === 'header') {
        return (
          <AlbumHeader
            album={album}
            artist={primaryArtist}
            artworkPath={albumArtwork}
            trackCount={albumTracks.length}
            totalDurationMs={totalDurationMs}
            year={year}
            onPlayAll={handlePlayAll}
            onShuffle={handleShuffle}
          />
        );
      }
      return (
        <AlbumTrackRow
          track={item.track}
          index={item.index}
          onPress={handleTrackPress}
          onLongPress={handleLongPress}
        />
      );
    },
    [
      album,
      primaryArtist,
      albumArtwork,
      albumTracks.length,
      totalDurationMs,
      year,
      handlePlayAll,
      handleShuffle,
      handleTrackPress,
      handleLongPress,
    ],
  );

  const getItemType = useCallback(
    (item: ListItem) => item.type,
    [],
  );

  const keyExtractor = useCallback(
    (item: ListItem): string => {
      if (item.type === 'header') return 'header';
      return item.track.id;
    },
    [],
  );

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor="#F5F5F7" />

      {/* Nav bar */}
      <View style={styles.navBar}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={styles.backIcon}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.navTitle} numberOfLines={1}>
          Album
        </Text>
        <View style={styles.navSpacer} />
      </View>

      <FlashList
        data={listData}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        getItemType={getItemType}
        estimatedItemSize={68}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No songs in this album</Text>
          </View>
        }
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F5F5F7',
  },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 52 : 24,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  backIcon: {
    fontSize: 34,
    color: '#FA233B',
    fontWeight: '300',
    lineHeight: 38,
  },
  navTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: '#1D1D1F',
    textAlign: 'center',
  },
  navSpacer: {
    width: 40,
  },
  listContent: {
    paddingBottom: 100,
  },
  empty: {
    paddingTop: 60,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#8E8E93',
  },
});
