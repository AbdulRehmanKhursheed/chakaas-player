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
import { TrackArtwork } from '@/components/track/TrackArtwork';
import type { LibraryStackParamList } from '@/app/navigation/LibraryStack';
import type { RootStackNavigationProp } from '@/types/navigation';
import type { Track } from '@/db/models/Track';
import { modelToTrack, modelsToTracks } from '@/utils/trackMapper';

// ─── Route ────────────────────────────────────────────────────────────────────

type ArtistDetailRoute = RouteProp<LibraryStackParamList, 'ArtistDetail'>;

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

// ─── Track row ────────────────────────────────────────────────────────────────

interface TrackRowProps {
  track: Track;
  index: number;
  onPress: (track: Track) => void;
  onLongPress: (track: Track) => void;
}

function ArtistTrackRow({ track, index, onPress, onLongPress }: TrackRowProps) {
  const handlePress = useCallback(() => onPress(track), [track, onPress]);
  const handleLongPress = useCallback(() => onLongPress(track), [track, onLongPress]);

  return (
    <TouchableOpacity
      activeOpacity={0.75}
      onPress={handlePress}
      onLongPress={handleLongPress}
      style={trackRowStyles.container}
    >
      <Text style={trackRowStyles.index}>{index + 1}</Text>
      <TrackArtwork uri={track.artworkPath} blurhash={null} size={50} borderRadius={8} />
      <View style={trackRowStyles.meta}>
        <Text style={trackRowStyles.title} numberOfLines={1}>
          {track.title}
        </Text>
        <Text style={trackRowStyles.album} numberOfLines={1}>
          {track.album || 'Unknown Album'}
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
    paddingVertical: 10,
    gap: 12,
  },
  index: {
    width: 22,
    fontSize: 13,
    fontWeight: '500',
    color: '#8E8E93',
    textAlign: 'center',
  },
  meta: { flex: 1 },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1D1D1F',
    letterSpacing: -0.1,
  },
  album: {
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

// ─── Hero header (artwork + name + stats + action buttons) ────────────────────

interface HeroHeaderProps {
  artist: string;
  artworkPath: string | null;
  trackCount: number;
  albumCount: number;
  totalDurationMs: number;
  onPlayAll: () => void;
  onShuffle: () => void;
}

function HeroHeader({
  artist,
  artworkPath,
  trackCount,
  albumCount,
  totalDurationMs,
  onPlayAll,
  onShuffle,
}: HeroHeaderProps) {
  return (
    <View style={heroStyles.container}>
      {/* Large circular avatar */}
      <View style={heroStyles.avatarContainer}>
        {artworkPath ? (
          <FastImage
            source={{
              uri: artworkPath,
              priority: FastImage.priority.high,
              cache: FastImage.cacheControl.immutable,
            }}
            style={heroStyles.avatar}
            resizeMode={FastImage.resizeMode.cover}
          />
        ) : (
          <View style={[heroStyles.avatar, heroStyles.avatarPlaceholder]}>
            <Text style={heroStyles.avatarInitial}>
              {artist.trim().charAt(0).toUpperCase() || '?'}
            </Text>
          </View>
        )}
        <View style={heroStyles.avatarRing} />
      </View>

      {/* Artist name */}
      <Text style={heroStyles.artistName} numberOfLines={2}>
        {artist}
      </Text>

      {/* Stats */}
      <Text style={heroStyles.stats}>
        {trackCount} {trackCount === 1 ? 'song' : 'songs'}
        {albumCount > 0 ? `  ·  ${albumCount} ${albumCount === 1 ? 'album' : 'albums'}` : ''}
        {totalDurationMs > 0 ? `  ·  ${formatTotalDuration(totalDurationMs)}` : ''}
      </Text>

      {/* Action buttons */}
      <View style={heroStyles.buttonRow}>
        <TouchableOpacity
          style={[heroStyles.button, heroStyles.playButton]}
          onPress={onPlayAll}
          activeOpacity={0.85}
          disabled={trackCount === 0}
        >
          <Ionicons name="play" size={16} color="#FFFFFF" />
          <Text style={heroStyles.playButtonText}>Play All</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[heroStyles.button, heroStyles.shuffleButton]}
          onPress={onShuffle}
          activeOpacity={0.85}
          disabled={trackCount === 0}
        >
          <Ionicons name="shuffle" size={16} color="#FA233B" />
          <Text style={heroStyles.shuffleButtonText}>Shuffle</Text>
        </TouchableOpacity>
      </View>

      <View style={heroStyles.separator} />
    </View>
  );
}

const AVATAR_SIZE = 140;

const heroStyles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 8,
  },
  avatarContainer: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    marginBottom: 18,
    position: 'relative',
    ...Platform.select({
      ios: {
        shadowColor: '#FA233B',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.25,
        shadowRadius: 20,
      },
      android: { elevation: 12 },
    }),
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
  },
  avatarPlaceholder: {
    backgroundColor: '#FFF1F3',
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7,
  },
  avatarInitial: {
    fontSize: 52,
    fontWeight: '800',
    color: '#FA233B',
  },
  avatarRing: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: AVATAR_SIZE / 2,
    borderWidth: 2,
    borderColor: 'rgba(255, 215, 0, 0.25)',
  },
  artistName: {
    fontSize: 26,
    fontWeight: '800',
    color: '#1D1D1F',
    letterSpacing: -0.5,
    textAlign: 'center',
    lineHeight: 32,
  },
  stats: {
    fontSize: 13,
    fontWeight: '400',
    color: '#6E6E73',
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

// ─── Section header (album group) ─────────────────────────────────────────────

function AlbumSectionHeader({ album }: { album: string }) {
  return (
    <View style={albumSectionStyles.container}>
      <Text style={albumSectionStyles.text} numberOfLines={1}>
        {album}
      </Text>
    </View>
  );
}

const albumSectionStyles = StyleSheet.create({
  container: {
    backgroundColor: '#F5F5F7',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1E1E1E',
  },
  text: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FA233B',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
});

// ─── List item type ────────────────────────────────────────────────────────────

type ListItem =
  | { type: 'hero' }
  | { type: 'albumHeader'; album: string }
  | { type: 'track'; track: Track; indexInList: number };

// ─── Main screen ──────────────────────────────────────────────────────────────

export function ArtistDetailScreen() {
  const navigation = useNavigation<RootStackNavigationProp>();
  const route = useRoute<ArtistDetailRoute>();
  const { artist } = route.params;

  const allTracks = useAllTracks();
  const { playTrack, playNext } = usePlayerQueue();

  // Filter tracks by artist and sort by album then title
  const artistTracks = useMemo(() => {
    return allTracks
      .filter((t) => t.artist === artist)
      .sort((a, b) => {
        const albumA = a.album ?? '';
        const albumB = b.album ?? '';
        const albumCmp = albumA.localeCompare(albumB);
        if (albumCmp !== 0) return albumCmp;
        return a.title.localeCompare(b.title);
      });
  }, [allTracks, artist]);

  // Derive representative artwork (from first track that has one)
  const artistArtwork = useMemo(
    () => artistTracks.find((t) => t.artworkPath)?.artworkPath ?? null,
    [artistTracks],
  );

  // Count unique albums
  const albumCount = useMemo(() => {
    const albums = new Set(artistTracks.map((t) => t.album ?? '').filter(Boolean));
    return albums.size;
  }, [artistTracks]);

  // Total duration
  const totalDurationMs = useMemo(
    () => artistTracks.reduce((acc, t) => acc + t.durationMs, 0),
    [artistTracks],
  );

  // Build flat list data with album section headers
  const listData = useMemo((): ListItem[] => {
    const result: ListItem[] = [{ type: 'hero' }];
    let lastAlbum: string | null = null;
    let trackIndex = 0;
    for (const track of artistTracks) {
      const albumKey = track.album ?? 'Unknown Album';
      if (albumKey !== lastAlbum) {
        result.push({ type: 'albumHeader', album: albumKey });
        lastAlbum = albumKey;
      }
      result.push({ type: 'track', track, indexInList: trackIndex });
      trackIndex++;
    }
    return result;
  }, [artistTracks]);

  // ── Handlers ──

  const handlePlayAll = useCallback(() => {
    if (artistTracks.length === 0) return;
    void playTrack(modelToTrack(artistTracks[0]), modelsToTracks(artistTracks));
    navigation.navigate('NowPlaying');
  }, [artistTracks, playTrack, navigation]);

  const handleShuffle = useCallback(() => {
    if (artistTracks.length === 0) return;
    const shuffled = [...artistTracks].sort(() => Math.random() - 0.5);
    void playTrack(modelToTrack(shuffled[0]), modelsToTracks(shuffled));
    navigation.navigate('NowPlaying');
  }, [artistTracks, playTrack, navigation]);

  const handleTrackPress = useCallback(
    (track: Track) => {
      void playTrack(modelToTrack(track), modelsToTracks(artistTracks));
      navigation.navigate('NowPlaying');
    },
    [artistTracks, playTrack, navigation],
  );

  const handleLongPress = useCallback(
    (track: Track) => {
      const options = ['Play Next', 'Go to Album', 'Cancel'];
      if (Platform.OS === 'ios') {
        ActionSheetIOS.showActionSheetWithOptions(
          { options, cancelButtonIndex: 2, title: track.title },
          (index) => {
            if (index === 0) void playNext(modelToTrack(track));
            if (index === 1 && track.album) {
              navigation.navigate('AlbumDetail', { album: track.album });
            }
          },
        );
      } else {
        Alert.alert(track.title, undefined, [
          { text: 'Play Next', onPress: () => void playNext(modelToTrack(track)) },
          {
            text: 'Go to Album',
            onPress: () =>
              track.album && navigation.navigate('AlbumDetail', { album: track.album }),
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
      if (item.type === 'hero') {
        return (
          <HeroHeader
            artist={artist}
            artworkPath={artistArtwork}
            trackCount={artistTracks.length}
            albumCount={albumCount}
            totalDurationMs={totalDurationMs}
            onPlayAll={handlePlayAll}
            onShuffle={handleShuffle}
          />
        );
      }
      if (item.type === 'albumHeader') {
        return <AlbumSectionHeader album={item.album} />;
      }
      return (
        <ArtistTrackRow
          track={item.track}
          index={item.indexInList}
          onPress={handleTrackPress}
          onLongPress={handleLongPress}
        />
      );
    },
    [
      artist,
      artistArtwork,
      artistTracks.length,
      albumCount,
      totalDurationMs,
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
    (item: ListItem) => {
      if (item.type === 'hero') return 'hero';
      if (item.type === 'albumHeader') return `album-${item.album}`;
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
          {artist}
        </Text>
        <View style={styles.navSpacer} />
      </View>

      <FlashList
        data={listData}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        getItemType={getItemType}
        estimatedItemSize={70}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No songs by this artist</Text>
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
