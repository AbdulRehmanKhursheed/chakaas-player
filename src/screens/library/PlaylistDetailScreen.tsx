import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Alert,
  TextInput,
  StatusBar,
  ActionSheetIOS,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import type { RootStackParamList, RootStackNavigationProp } from '@/types/navigation';
import { usePlaylistTracks } from '@/hooks/useTrackDB';
import { usePlayerQueue } from '@/features/player/useQueue';
import { database, playlistsCollection, playlistTracksCollection } from '@/db';
import type { Track } from '@/db/models/Track';
import type { Playlist } from '@/db/models/Playlist';
import { modelToTrack, modelsToTracks } from '@/utils/trackMapper';
import { TrackArtwork } from '@/components/track/TrackArtwork';
import { Q } from '@nozbe/watermelondb';

// ─── Route ────────────────────────────────────────────────────────────────────

type PlaylistDetailRoute = RouteProp<RootStackParamList, 'PlaylistDetail'>;

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

function TrackRow({ track, index, onPress, onLongPress }: TrackRowProps) {
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
  meta: {
    flex: 1,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1D1D1F',
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

// ─── Edit name sheet ──────────────────────────────────────────────────────────

interface EditNameSheetProps {
  visible: boolean;
  currentName: string;
  onSave: (name: string) => void;
  onCancel: () => void;
}

function EditNameSheet({ visible, currentName, onSave, onCancel }: EditNameSheetProps) {
  const [value, setValue] = useState(currentName);

  if (!visible) return null;

  return (
    <View style={editStyles.overlay}>
      <View style={editStyles.sheet}>
        <Text style={editStyles.title}>Rename Playlist</Text>
        <TextInput
          style={editStyles.input}
          value={value}
          onChangeText={setValue}
          placeholder="Playlist name"
          placeholderTextColor="#8E8E93"
          autoFocus
          selectTextOnFocus
          returnKeyType="done"
          onSubmitEditing={() => value.trim() && onSave(value.trim())}
        />
        <View style={editStyles.buttons}>
          <TouchableOpacity onPress={onCancel} style={editStyles.cancelBtn}>
            <Text style={editStyles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => value.trim() && onSave(value.trim())}
            style={editStyles.saveBtn}
          >
            <Text style={editStyles.saveText}>Save</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const editStyles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
    paddingHorizontal: 24,
  },
  sheet: {
    width: '100%',
    backgroundColor: '#F2F2F7',
    borderRadius: 16,
    padding: 24,
    gap: 16,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1D1D1F',
    textAlign: 'center',
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#D2D2D7',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#1D1D1F',
  },
  buttons: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 10,
    backgroundColor: '#D2D2D7',
    alignItems: 'center',
  },
  cancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#3A3A3C',
  },
  saveBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 10,
    backgroundColor: '#FA233B',
    alignItems: 'center',
  },
  saveText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});

// ─── Main screen ──────────────────────────────────────────────────────────────

export function PlaylistDetailScreen() {
  const navigation = useNavigation<RootStackNavigationProp>();
  const route = useRoute<PlaylistDetailRoute>();
  const { playlistId } = route.params;

  const tracks = usePlaylistTracks(playlistId);
  const { playTrack, playNext } = usePlayerQueue();

  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [editingName, setEditingName] = useState(false);

  // Load playlist metadata
  useEffect(() => {
    const sub = playlistsCollection
      .findAndObserve(playlistId)
      .subscribe({
        next: (p: Playlist) => setPlaylist(p),
        error: () => {},
      });
    return () => sub.unsubscribe();
  }, [playlistId]);

  const totalDuration = useMemo(
    () => tracks.reduce((acc, t) => acc + t.durationMs, 0),
    [tracks],
  );

  // Play all (in order)
  const handlePlayAll = useCallback(() => {
    if (tracks.length === 0) return;
    void playTrack(modelToTrack(tracks[0]), modelsToTracks(tracks));
    navigation.navigate('NowPlaying');
  }, [tracks, playTrack, navigation]);

  // Shuffle all
  const handleShuffleAll = useCallback(() => {
    if (tracks.length === 0) return;
    const shuffled = [...tracks].sort(() => Math.random() - 0.5);
    void playTrack(modelToTrack(shuffled[0]), modelsToTracks(shuffled));
    navigation.navigate('NowPlaying');
  }, [tracks, playTrack, navigation]);

  // Individual track press
  const handleTrackPress = useCallback(
    (track: Track) => {
      void playTrack(modelToTrack(track), modelsToTracks(tracks));
      navigation.navigate('NowPlaying');
    },
    [tracks, playTrack, navigation],
  );

  // Long press context menu
  const handleLongPress = useCallback(
    (track: Track) => {
      const options = ['Play Next', 'Remove from Playlist', 'Cancel'];
      const cancelIndex = 2;
      if (Platform.OS === 'ios') {
        ActionSheetIOS.showActionSheetWithOptions(
          { options, cancelButtonIndex: cancelIndex, destructiveButtonIndex: 1, title: track.title },
          async (index) => {
            if (index === 0) void playNext(modelToTrack(track));
            if (index === 1) {
              // Remove track from playlist
              await database.write(async () => {
                const rows = await playlistTracksCollection
                  .query(
                    Q.where('playlist_id', playlistId),
                    Q.where('track_id', track.id),
                  )
                  .fetch();
                for (const row of rows) await row.destroyPermanently();
              });
            }
          },
        );
      } else {
        Alert.alert(track.title, undefined, [
          { text: 'Play Next', onPress: () => void playNext(modelToTrack(track)) },
          {
            text: 'Remove from Playlist',
            style: 'destructive',
            onPress: async () => {
              await database.write(async () => {
                const rows = await playlistTracksCollection
                  .query(
                    Q.where('playlist_id', playlistId),
                    Q.where('track_id', track.id),
                  )
                  .fetch();
                for (const row of rows) await row.destroyPermanently();
              });
            },
          },
          { text: 'Cancel', style: 'cancel' },
        ]);
      }
    },
    [playlistId, playNext],
  );

  // Rename playlist
  const handleSaveName = useCallback(
    async (newName: string) => {
      if (!playlist) return;
      await database.write(async () => {
        await playlist.update((p: any) => {
          p.name = newName;
        });
      });
      setEditingName(false);
    },
    [playlist],
  );

  // More options
  const handleMorePress = useCallback(() => {
    const options = ['Rename Playlist', 'Cancel'];
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex: 1 },
        (index) => {
          if (index === 0) setEditingName(true);
        },
      );
    } else {
      Alert.alert('Options', undefined, [
        { text: 'Rename Playlist', onPress: () => setEditingName(true) },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  }, []);

  const renderTrackRow = useCallback(
    ({ item, index }: { item: Track; index: number }) => (
      <TrackRow
        track={item}
        index={index}
        onPress={handleTrackPress}
        onLongPress={handleLongPress}
      />
    ),
    [handleTrackPress, handleLongPress],
  );

  // Artwork mosaic from first 4 tracks
  const mosaicUris = useMemo(
    () => tracks.slice(0, 4).map((t) => t.artworkPath ?? null),
    [tracks],
  );

  const headerArtworkUri = playlist?.artworkPath ?? mosaicUris[0] ?? null;

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor="#F5F5F7" />

      {/* Back + more */}
      <View style={styles.topBar}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={styles.backIcon}>‹</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleMorePress}
          style={styles.moreButton}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={styles.moreIcon}>•••</Text>
        </TouchableOpacity>
      </View>

      <FlashList
        data={tracks}
        renderItem={renderTrackRow}
        keyExtractor={(item) => item.id}
        estimatedItemSize={70}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View style={styles.listHeader}>
            {/* Playlist artwork */}
            <View style={styles.artworkContainer}>
              <TrackArtwork
                uri={headerArtworkUri}
                blurhash={null}
                size={160}
                borderRadius={16}
              />
            </View>

            {/* Name + meta */}
            <Text style={styles.playlistName}>
              {playlist?.name ?? '…'}
            </Text>
            <Text style={styles.playlistMeta}>
              {tracks.length} {tracks.length === 1 ? 'song' : 'songs'}
              {totalDuration > 0 ? ` · ${formatTotalDuration(totalDuration)}` : ''}
            </Text>

            {/* Action buttons */}
            <View style={styles.actionRow}>
              <TouchableOpacity
                onPress={handlePlayAll}
                style={[styles.actionButton, styles.playAllButton]}
                disabled={tracks.length === 0}
                activeOpacity={0.85}
              >
                <Ionicons name="play" size={16} color="#FFFFFF" />
                <Text style={styles.playAllText}>Play All</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleShuffleAll}
                style={[styles.actionButton, styles.shuffleButton]}
                disabled={tracks.length === 0}
                activeOpacity={0.85}
              >
                <Ionicons name="shuffle" size={16} color="#FA233B" />
                <Text style={styles.shuffleText}>Shuffle</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.separator} />
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No songs in this playlist</Text>
            <Text style={styles.emptySubtext}>Go to Library and add some tracks</Text>
          </View>
        }
      />

      {/* Rename sheet overlay */}
      <EditNameSheet
        visible={editingName}
        currentName={playlist?.name ?? ''}
        onSave={handleSaveName}
        onCancel={() => setEditingName(false)}
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
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 52 : 24,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
  },
  backIcon: {
    fontSize: 34,
    color: '#FA233B',
    fontWeight: '300',
    marginTop: -4,
  },
  moreButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  moreIcon: {
    fontSize: 13,
    color: '#3A3A3C',
    letterSpacing: 1,
  },
  listContent: {
    paddingBottom: 100,
  },
  listHeader: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  artworkContainer: {
    marginBottom: 20,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.6,
        shadowRadius: 20,
      },
      android: { elevation: 16 },
    }),
  },
  playlistName: {
    fontSize: 22,
    fontWeight: '800',
    color: '#1D1D1F',
    letterSpacing: -0.4,
    textAlign: 'center',
  },
  playlistMeta: {
    fontSize: 13,
    fontWeight: '400',
    color: '#6E6E73',
    marginTop: 6,
    textAlign: 'center',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
    width: '100%',
  },
  actionButton: {
    flex: 1,
    height: 46,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7,
  },
  playAllButton: {
    backgroundColor: '#FA233B',
  },
  playAllText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  shuffleButton: {
    backgroundColor: '#F2F2F7',
    borderWidth: 1,
    borderColor: '#D2D2D7',
  },
  shuffleText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1D1D1F',
  },
  separator: {
    width: '100%',
    height: 1,
    backgroundColor: '#F2F2F7',
    marginTop: 20,
  },
  empty: {
    paddingTop: 40,
    alignItems: 'center',
    gap: 8,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#8E8E93',
  },
  emptySubtext: {
    fontSize: 13,
    color: '#C7C7CC',
  },
});
