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
import { useSafeTracks } from '@/hooks/useSafeTracks';
import { usePlayerQueue } from '@/features/player/useQueue';
import type { LibraryStackParamList } from '@/app/navigation/LibraryStack';
import type { RootStackNavigationProp } from '@/types/navigation';
import type { Track } from '@/db/models/Track';
import { modelToTrack, modelsToTracks } from '@/utils/trackMapper';
import { useTheme } from '@/theme';
import { LinearGradient } from 'expo-linear-gradient';

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
  const { colors } = useTheme();
  const handlePress = useCallback(() => onPress(track), [track, onPress]);
  const handleLongPress = useCallback(() => onLongPress(track), [track, onLongPress]);

  return (
    <TouchableOpacity
      activeOpacity={0.75}
      onPress={handlePress}
      onLongPress={handleLongPress}
      style={[trackRowStyles.container, { borderBottomColor: colors.border }]}
    >
      {/* Track number */}
      <View style={trackRowStyles.indexContainer}>
        <Text style={[trackRowStyles.index, { color: colors.textTertiary }]}>{index + 1}</Text>
      </View>

      <View style={trackRowStyles.meta}>
        <Text style={[trackRowStyles.title, { color: colors.textPrimary }]} numberOfLines={1}>
          {track.title}
        </Text>
        <Text style={[trackRowStyles.artist, { color: colors.textSecondary }]} numberOfLines={1}>
          {track.artist}
        </Text>
      </View>

      <Text style={[trackRowStyles.duration, { color: colors.textTertiary }]}>
        {formatDuration(track.durationMs)}
      </Text>
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
  },
  indexContainer: {
    width: 28,
    alignItems: 'center',
  },
  index: {
    fontSize: 13,
    fontWeight: '500',
  },
  meta: { flex: 1 },
  title: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: -0.1,
  },
  artist: {
    fontSize: 12,
    fontWeight: '400',
    marginTop: 2,
  },
  duration: {
    fontSize: 12,
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
  const { colors } = useTheme();
  return (
    <View style={headerStyles.container}>
      {/* Album artwork — large, soft cyan glow */}
      <View style={[headerStyles.artworkWrapper, { shadowColor: colors.accent }]}>
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
          <View
            style={[
              headerStyles.artwork,
              headerStyles.artworkPlaceholder,
              { backgroundColor: colors.accentMuted },
            ]}
          >
            <Ionicons name="musical-notes" size={56} color={colors.accent} />
          </View>
        )}
      </View>

      {/* Album name */}
      <Text style={[headerStyles.albumName, { color: colors.textPrimary }]} numberOfLines={3}>
        {album}
      </Text>

      {/* Artist */}
      <Text style={[headerStyles.artistName, { color: colors.accent }]} numberOfLines={1}>
        {artist}
      </Text>

      {/* Meta line: year · tracks · duration */}
      <Text style={[headerStyles.meta, { color: colors.textSecondary }]}>
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
          <LinearGradient
            colors={colors.brandGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <Ionicons name="play" size={16} color="#07090D" />
          <Text style={headerStyles.playButtonText}>Play All</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            headerStyles.button,
            headerStyles.shuffleButton,
            { backgroundColor: colors.accentMuted, borderColor: colors.borderAccent },
          ]}
          onPress={onShuffle}
          activeOpacity={0.85}
          disabled={trackCount === 0}
        >
          <Ionicons name="shuffle" size={16} color={colors.accent} />
          <Text style={[headerStyles.shuffleButtonText, { color: colors.accent }]}>Shuffle</Text>
        </TouchableOpacity>
      </View>

      <View style={[headerStyles.separator, { backgroundColor: colors.border }]} />
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
  // Soft cyan glow instead of a heavy black drop shadow.
  artworkWrapper: {
    marginBottom: 20,
    borderRadius: 20,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.3,
        shadowRadius: 28,
      },
      android: { elevation: 12 },
    }),
  },
  artwork: {
    width: ARTWORK_SIZE,
    height: ARTWORK_SIZE,
    borderRadius: 20,
  },
  artworkPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  albumName: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.4,
    textAlign: 'center',
    lineHeight: 28,
  },
  artistName: {
    fontSize: 15,
    fontWeight: '500',
    marginTop: 6,
    textAlign: 'center',
  },
  meta: {
    fontSize: 12,
    fontWeight: '400',
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
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7,
    overflow: 'hidden',
  },
  playButton: {},
  playButtonText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#07090D',
  },
  shuffleButton: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  shuffleButtonText: {
    fontSize: 14,
    fontWeight: '700',
  },
  separator: {
    width: '100%',
    height: StyleSheet.hairlineWidth,
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
  const { colors } = useTheme();

  const safeTracks = useSafeTracks();
  const { playTrack, playNext } = usePlayerQueue();

  // Filter tracks for this album, sorted by title. Use `safeTracks` so an
  // album view never surfaces non-music junk that happened to share the
  // album tag (e.g. a "Recordings" pseudo-album from a voice recorder).
  const albumTracks = useMemo(() => {
    return safeTracks
      .filter((t) => (t.album ?? 'Unknown Album') === album)
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [safeTracks, album]);

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
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <StatusBar barStyle={colors.isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.bg} />

      {/* Nav bar */}
      <View style={styles.navBar}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={[styles.backIcon, { color: colors.accent }]}>‹</Text>
        </TouchableOpacity>
        <Text style={[styles.navTitle, { color: colors.textPrimary }]} numberOfLines={1}>
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
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              No songs in this album
            </Text>
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
    fontWeight: '300',
    lineHeight: 38,
  },
  navTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
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
  },
});
