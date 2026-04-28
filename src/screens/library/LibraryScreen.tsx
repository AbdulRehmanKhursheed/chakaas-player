import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Dimensions,
  StatusBar,
  ActionSheetIOS,
  Alert,
  ActivityIndicator,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
} from 'react-native-reanimated';
import { FlashList } from '@shopify/flash-list';
import { useNavigation } from '@react-navigation/native';
import { Q } from '@nozbe/watermelondb';
import { Ionicons } from '@expo/vector-icons';
import { useAllTracks } from '@/hooks/useTrackDB';
import { usePlayerQueue } from '@/features/player/useQueue';
import { database, playlistsCollection } from '@/db';
import type { Playlist } from '@/db/models/Playlist';
import type { Track } from '@/db/models/Track';
import { modelToTrack, modelsToTracks } from '@/utils/trackMapper';
import type { RootStackNavigationProp } from '@/types/navigation';
import { TrackArtwork } from '@/components/track/TrackArtwork';
import { AlbumGrid, AlbumItem } from './components/AlbumGrid';
import { ArtistRow } from './components/ArtistRow';
import { GenreCard } from './components/GenreCard';
import { importDeviceAudio } from '@/features/localAudio/LocalAudioImporter';

// ─── Constants ────────────────────────────────────────────────────────────────

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const TABS = ['Songs', 'Artists', 'Albums', 'Genres', 'Playlists'] as const;
type TabKey = (typeof TABS)[number];

type SortMode = 'recently_added' | 'a_z' | 'most_played';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

function getAlphaKey(title: string): string {
  const ch = title.trim().charAt(0).toUpperCase();
  return /[A-Z]/.test(ch) ? ch : '#';
}

// ─── Search bar ───────────────────────────────────────────────────────────────

interface SearchBarProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}

function SearchBar({ value, onChange, placeholder = 'Search songs…' }: SearchBarProps) {
  return (
    <View style={searchStyles.container}>
      <Ionicons name="search" size={18} color="#8E8E93" />
      <TextInput
        style={searchStyles.input}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor="#8E8E93"
        returnKeyType="search"
        clearButtonMode="while-editing"
        autoCorrect={false}
        autoCapitalize="none"
      />
      {value.length > 0 && (
        <TouchableOpacity
          onPress={() => onChange('')}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="close-circle" size={18} color="#8E8E93" />
        </TouchableOpacity>
      )}
    </View>
  );
}

const searchStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F2F2F7',
    borderRadius: 12,
    marginHorizontal: 20,
    marginBottom: 12,
    paddingHorizontal: 14,
    height: 44,
    gap: 8,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: '#1D1D1F',
    fontWeight: '400',
  },
});

// ─── Sort picker ──────────────────────────────────────────────────────────────

interface SortPickerProps {
  mode: SortMode;
  onChange: (m: SortMode) => void;
}

function SortPicker({ mode, onChange }: SortPickerProps) {
  const labels: Record<SortMode, string> = {
    recently_added: 'Recently Added',
    a_z: 'A – Z',
    most_played: 'Most Played',
  };

  const handlePress = () => {
    const options = Object.entries(labels).map(([, label]) => label);
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: [...options, 'Cancel'], cancelButtonIndex: options.length },
        (index) => {
          if (index < options.length) {
            onChange(Object.keys(labels)[index] as SortMode);
          }
        },
      );
    } else {
      Alert.alert(
        'Sort by',
        undefined,
        Object.entries(labels).map(([key, label]) => ({
          text: label,
          onPress: () => onChange(key as SortMode),
        })),
      );
    }
  };

  return (
    <TouchableOpacity onPress={handlePress} style={sortStyles.button}>
      <Text style={sortStyles.label}>{labels[mode]}</Text>
      <Text style={sortStyles.chevron}>⌄</Text>
    </TouchableOpacity>
  );
}

const sortStyles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginBottom: 8,
    gap: 4,
  },
  label: {
    fontSize: 12,
    fontWeight: '500',
    color: '#FA233B',
  },
  chevron: {
    fontSize: 12,
    color: '#FA233B',
    marginTop: 1,
  },
});

// ─── Alphabetical section header ──────────────────────────────────────────────

function SectionHeader({ letter }: { letter: string }) {
  return (
    <View style={sectionHeaderStyles.container}>
      <Text style={sectionHeaderStyles.letter}>{letter}</Text>
    </View>
  );
}

const sectionHeaderStyles = StyleSheet.create({
  container: {
    backgroundColor: '#F5F5F7',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1E1E1E',
  },
  letter: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FA233B',
    letterSpacing: 0.5,
  },
});

// ─── Song row (local list item) ───────────────────────────────────────────────

type SongsListItem =
  | { type: 'header'; letter: string }
  | { type: 'track'; track: Track };

interface SongRowProps {
  track: Track;
  onPress: (track: Track) => void;
  onLongPress: (track: Track) => void;
}

function SongRow({ track, onPress, onLongPress }: SongRowProps) {
  const handlePress = useCallback(() => onPress(track), [track, onPress]);
  const handleLongPress = useCallback(() => onLongPress(track), [track, onLongPress]);

  return (
    <TouchableOpacity
      activeOpacity={0.75}
      onPress={handlePress}
      onLongPress={handleLongPress}
      style={songRowStyles.container}
    >
      <TrackArtwork uri={track.artworkPath} blurhash={null} size={50} borderRadius={8} />
      <View style={songRowStyles.meta}>
        <Text style={songRowStyles.title} numberOfLines={1}>
          {track.title}
        </Text>
        <Text style={songRowStyles.artist} numberOfLines={1}>
          {track.artist}
          {track.album ? ` · ${track.album}` : ''}
        </Text>
      </View>
      <Text style={songRowStyles.duration}>{formatDuration(track.durationMs)}</Text>
    </TouchableOpacity>
  );
}

const songRowStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    gap: 12,
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
    fontWeight: '400',
    color: '#8E8E93',
  },
});

// ─── Playlist card ────────────────────────────────────────────────────────────

const PLAYLIST_CARD_SIZE = (SCREEN_WIDTH - 52) / 2;

interface PlaylistCardProps {
  playlist: Playlist;
  onPress: (id: string) => void;
}

function PlaylistCard({ playlist, onPress }: PlaylistCardProps) {
  const handlePress = useCallback(() => onPress(playlist.id), [playlist, onPress]);
  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={handlePress}
      style={playlistCardStyles.card}
    >
      <View style={playlistCardStyles.artContainer}>
        <TrackArtwork
          uri={playlist.artworkPath}
          blurhash={null}
          size={PLAYLIST_CARD_SIZE}
          borderRadius={12}
        />
      </View>
      <Text style={playlistCardStyles.name} numberOfLines={2}>
        {playlist.name}
      </Text>
    </TouchableOpacity>
  );
}

const playlistCardStyles = StyleSheet.create({
  card: {
    width: PLAYLIST_CARD_SIZE,
  },
  artContainer: {
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#D2D2D7',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.5,
        shadowRadius: 12,
      },
      android: { elevation: 8 },
    }),
  },
  name: {
    marginTop: 8,
    fontSize: 13,
    fontWeight: '600',
    color: '#1D1D1F',
    lineHeight: 18,
  },
});

// ─── Animated Tab Bar ─────────────────────────────────────────────────────────

interface TabBarProps {
  activeTab: TabKey;
  onTabPress: (tab: TabKey) => void;
}

function TabBar({ activeTab, onTabPress }: TabBarProps) {
  const indicatorLeft = useSharedValue(0);
  const indicatorWidth = useSharedValue(0);

  const TAB_WIDTH = SCREEN_WIDTH / TABS.length;

  useEffect(() => {
    const idx = TABS.indexOf(activeTab);
    indicatorLeft.value = withTiming(idx * TAB_WIDTH + TAB_WIDTH * 0.15, {
      duration: 220,
    });
    indicatorWidth.value = withTiming(TAB_WIDTH * 0.7, { duration: 220 });
  }, [activeTab]);

  const indicatorStyle = useAnimatedStyle(() => ({
    left: indicatorLeft.value,
    width: indicatorWidth.value,
  }));

  return (
    <View style={tabStyles.container}>
      {TABS.map((tab) => {
        const isActive = tab === activeTab;
        return (
          <TouchableOpacity
            key={tab}
            onPress={() => onTabPress(tab)}
            style={tabStyles.tab}
            activeOpacity={0.7}
          >
            <Text style={[tabStyles.label, isActive && tabStyles.activeLabel]}>
              {tab}
            </Text>
          </TouchableOpacity>
        );
      })}
      <Animated.View style={[tabStyles.indicator, indicatorStyle]} />
    </View>
  );
}

const tabStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#F2F2F7',
    marginBottom: 4,
    position: 'relative',
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 13,
  },
  label: {
    fontSize: 12,
    fontWeight: '500',
    color: '#8E8E93',
    letterSpacing: 0.1,
  },
  activeLabel: {
    color: '#1D1D1F',
    fontWeight: '700',
  },
  indicator: {
    position: 'absolute',
    bottom: 0,
    height: 2.5,
    backgroundColor: '#FA233B',
    borderRadius: 2,
  },
});

// ─── Playlists FAB ────────────────────────────────────────────────────────────

interface PlaylistsFABProps {
  onPress: () => void;
}

function PlaylistsFAB({ onPress }: PlaylistsFABProps) {
  const scale = useSharedValue(1);
  const fabStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback(() => {
    scale.value = withSpring(0.93, { damping: 20, stiffness: 300 });
  }, []);
  const handlePressOut = useCallback(() => {
    scale.value = withSpring(1, { damping: 20, stiffness: 300 });
  }, []);

  return (
    <Animated.View style={[fabStyles.fab, fabStyle]}>
      <TouchableOpacity
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={1}
        style={fabStyles.inner}
      >
        <Ionicons name="add" size={20} color="#FFFFFF" />
        <Text style={fabStyles.label}>New Playlist</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const fabStyles = StyleSheet.create({
  fab: {
    position: 'absolute',
    bottom: 104,
    right: 20,
    borderRadius: 28,
    backgroundColor: '#FA233B',
    ...Platform.select({
      ios: {
        shadowColor: '#FA233B',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.45,
        shadowRadius: 12,
      },
      android: { elevation: 10 },
    }),
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 14,
    gap: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});

// ─── Genre data helper ────────────────────────────────────────────────────────

interface GenreGroup {
  genre: string;
  trackCount: number;
  artworks: string[];
  tracks: Track[];
}

function buildGenreGroups(tracks: Track[]): GenreGroup[] {
  const map = new Map<string, { tracks: Track[] }>();
  for (const t of tracks) {
    const key = t.genre?.trim() || 'Unknown';
    const existing = map.get(key);
    if (existing) {
      existing.tracks.push(t);
    } else {
      map.set(key, { tracks: [t] });
    }
  }
  return [...map.entries()]
    .map(([genre, { tracks: gTracks }]) => {
      // Collect up to 4 unique artworks
      const seen = new Set<string>();
      const artworks: string[] = [];
      for (const t of gTracks) {
        if (t.artworkPath && !seen.has(t.artworkPath)) {
          seen.add(t.artworkPath);
          artworks.push(t.artworkPath);
          if (artworks.length === 4) break;
        }
      }
      return { genre, trackCount: gTracks.length, artworks, tracks: gTracks };
    })
    .sort((a, b) => {
      if (a.genre === 'Unknown') return 1;
      if (b.genre === 'Unknown') return -1;
      return a.genre.localeCompare(b.genre);
    });
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export function LibraryScreen() {
  const navigation = useNavigation<RootStackNavigationProp>();
  const { playTrack } = usePlayerQueue();

  const allTracks = useAllTracks();
  const [activeTab, setActiveTab] = useState<TabKey>('Songs');
  const [query, setQuery] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('recently_added');
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [isImportingAudio, setIsImportingAudio] = useState(false);

  // Load playlists reactively
  useEffect(() => {
    const sub = playlistsCollection
      .query(Q.sortBy('created_at', Q.desc))
      .observe()
      .subscribe({
        next: (rows) => setPlaylists(rows as Playlist[]),
        error: () => {},
      });
    return () => sub.unsubscribe();
  }, []);

  // ── Songs tab: filtered + sorted + sectioned ──

  const filteredTracks = useMemo(() => {
    let result = allTracks;
    if (query.trim()) {
      const q = query.toLowerCase();
      result = result.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.artist.toLowerCase().includes(q) ||
          (t.album ?? '').toLowerCase().includes(q),
      );
    }
    switch (sortMode) {
      case 'a_z':
        return [...result].sort((a, b) => a.title.localeCompare(b.title));
      case 'most_played':
        return result;
      case 'recently_added':
      default:
        return result;
    }
  }, [allTracks, query, sortMode]);

  // Build section-aware flat list for Songs tab
  const songsListData = useMemo((): SongsListItem[] => {
    if (sortMode !== 'a_z') {
      // No section headers for non-alphabetical sort
      return filteredTracks.map((t) => ({ type: 'track', track: t }));
    }
    const result: SongsListItem[] = [];
    let lastLetter = '';
    for (const track of filteredTracks) {
      const letter = getAlphaKey(track.title);
      if (letter !== lastLetter) {
        result.push({ type: 'header', letter });
        lastLetter = letter;
      }
      result.push({ type: 'track', track });
    }
    return result;
  }, [filteredTracks, sortMode]);

  // ── Artists tab ──

  const artists = useMemo(() => {
    const map = new Map<string, { count: number; artworkPath: string | null }>();
    for (const t of allTracks) {
      const key = t.artist || 'Unknown Artist';
      const existing = map.get(key);
      if (existing) {
        existing.count += 1;
        if (!existing.artworkPath && t.artworkPath) {
          existing.artworkPath = t.artworkPath;
        }
      } else {
        map.set(key, { count: 1, artworkPath: t.artworkPath ?? null });
      }
    }
    return [...map.entries()]
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allTracks]);

  // ── Albums tab ──

  const albums = useMemo((): AlbumItem[] => {
    const map = new Map<string, { artist: string; trackCount: number; artworkPath: string | null }>();
    for (const t of allTracks) {
      const key = t.album || 'Unknown Album';
      const existing = map.get(key);
      if (existing) {
        existing.trackCount += 1;
        if (!existing.artworkPath && t.artworkPath) {
          existing.artworkPath = t.artworkPath;
        }
      } else {
        map.set(key, {
          artist: t.artist,
          trackCount: 1,
          artworkPath: t.artworkPath ?? null,
        });
      }
    }
    return [...map.entries()]
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allTracks]);

  // ── Genres tab ──

  const genreGroups = useMemo(() => buildGenreGroups(allTracks), [allTracks]);

  // ── Playlists tab: grid pairs ──

  const playlistPairs = useMemo(() => {
    const pairs: Playlist[][] = [];
    for (let i = 0; i < playlists.length; i += 2) {
      pairs.push(playlists.slice(i, i + 2));
    }
    return pairs;
  }, [playlists]);

  // ── Track handlers ──

  const handleTrackPress = useCallback(
    (track: Track) => {
      void playTrack(modelToTrack(track), modelsToTracks(filteredTracks));
      navigation.navigate('NowPlaying');
    },
    [playTrack, filteredTracks, navigation],
  );

  const handleLongPress = useCallback(
    (track: Track) => {
      const options = ['Play Next', 'Add to Playlist', 'Cancel'];
      if (Platform.OS === 'ios') {
        ActionSheetIOS.showActionSheetWithOptions(
          { options, cancelButtonIndex: 2, title: track.title },
          (index) => {
            if (index === 0) void playTrack(modelToTrack(track));
          },
        );
      } else {
        Alert.alert(track.title, undefined, [
          { text: 'Play Next', onPress: () => void playTrack(modelToTrack(track)) },
          { text: 'Cancel', style: 'cancel' },
        ]);
      }
    },
    [playTrack],
  );

  const handleArtistPress = useCallback(
    (artist: string) => navigation.navigate('ArtistDetail', { artist }),
    [navigation],
  );

  const handleAlbumPress = useCallback(
    (album: AlbumItem) => navigation.navigate('AlbumDetail', { album: album.name }),
    [navigation],
  );

  const handlePlaylistPress = useCallback(
    (id: string) => navigation.navigate('PlaylistDetail', { playlistId: id }),
    [navigation],
  );

  const handleGenrePress = useCallback(
    (_genre: string, genreTracks: Track[]) => {
      // Play all tracks from this genre
      if (genreTracks.length === 0) return;
      void playTrack(modelToTrack(genreTracks[0]), modelsToTracks(genreTracks));
      navigation.navigate('NowPlaying');
    },
    [playTrack, navigation],
  );

  const handleNewPlaylist = useCallback(() => {
    Alert.prompt(
      'New Playlist',
      'Enter a name for your playlist',
      async (name) => {
        if (!name?.trim()) return;
        await database.write(async () => {
          await playlistsCollection.create((record) => {
            (record as any).name = name.trim();
            (record as any).createdAt = Math.floor(Date.now() / 1000);
            (record as any).artworkPath = null;
          });
        });
      },
      'plain-text',
    );
  }, []);

  const handleImportDeviceAudio = useCallback(async () => {
    if (isImportingAudio) return;

    setIsImportingAudio(true);
    try {
      const result = await importDeviceAudio();
      if (result.permissionDenied) {
        Alert.alert(
          'Permission needed',
          'Allow audio/media access so Chakaas can add songs already on this device.',
        );
        return;
      }

      Alert.alert(
        'Device music scan complete',
        result.imported > 0
          ? `Added ${result.imported} song${result.imported === 1 ? '' : 's'} from your device.`
          : 'No new audio files were found. Songs already in your library are skipped.',
      );
    } catch (err) {
      Alert.alert(
        'Could not import device songs',
        err instanceof Error ? err.message : 'Please try again.',
      );
    } finally {
      setIsImportingAudio(false);
    }
  }, [isImportingAudio]);

  // ── Render helpers ──

  const renderSongsItem = useCallback(
    ({ item }: { item: SongsListItem }) => {
      if (item.type === 'header') {
        return <SectionHeader letter={item.letter} />;
      }
      return (
        <SongRow
          track={item.track}
          onPress={handleTrackPress}
          onLongPress={handleLongPress}
        />
      );
    },
    [handleTrackPress, handleLongPress],
  );

  const renderArtistRow = useCallback(
    ({ item }: { item: (typeof artists)[0] }) => (
      <ArtistRow
        artist={item.name}
        trackCount={item.count}
        artworkPath={item.artworkPath}
        onPress={() => handleArtistPress(item.name)}
      />
    ),
    [handleArtistPress],
  );

  const renderGenreCard = useCallback(
    ({ item }: { item: GenreGroup }) => (
      <GenreCard
        genre={item.genre}
        trackCount={item.trackCount}
        artworks={item.artworks}
        onPress={() => handleGenrePress(item.genre, item.tracks)}
      />
    ),
    [handleGenrePress],
  );

  const renderPlaylistPair = useCallback(
    ({ item }: { item: Playlist[] }) => (
      <View style={styles.playlistPairRow}>
        {item.map((pl) => (
          <PlaylistCard key={pl.id} playlist={pl} onPress={handlePlaylistPress} />
        ))}
        {item.length === 1 && <View style={{ width: PLAYLIST_CARD_SIZE }} />}
      </View>
    ),
    [handlePlaylistPress],
  );

  const emptyComponent = (
    <View style={styles.empty}>
      <Ionicons name="musical-notes" size={40} color="#FA233B" />
      <Text style={styles.emptyText}>Nothing here yet</Text>
      <Text style={styles.emptySubtext}>Import songs already on this device to start listening.</Text>
      <TouchableOpacity
        onPress={handleImportDeviceAudio}
        disabled={isImportingAudio}
        activeOpacity={0.82}
        style={styles.emptyAction}
      >
        {isImportingAudio ? (
          <ActivityIndicator size="small" color="#FFFFFF" />
        ) : (
          <Text style={styles.emptyActionText}>Add Device Songs</Text>
        )}
      </TouchableOpacity>
    </View>
  );

  const playlistsEmptyComponent = (
    <View style={styles.empty}>
      <Ionicons name="albums" size={40} color="#FA233B" />
      <Text style={styles.emptyText}>No playlists yet</Text>
      <Text style={styles.emptySubtext}>Tap the button below to get started</Text>
    </View>
  );

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor="#F5F5F7" />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Library</Text>
        <Text style={styles.headerCount}>
          {allTracks.length} {allTracks.length === 1 ? 'song' : 'songs'}
        </Text>
      </View>

      <TouchableOpacity
        style={styles.importButton}
        onPress={handleImportDeviceAudio}
        disabled={isImportingAudio}
        activeOpacity={0.8}
      >
        {isImportingAudio ? (
          <ActivityIndicator size="small" color="#FFFFFF" />
        ) : (
          <Text style={styles.importButtonText}>Add songs from this device</Text>
        )}
      </TouchableOpacity>

      {/* Tab bar */}
      <TabBar activeTab={activeTab} onTabPress={setActiveTab} />

      {/* ── Songs tab ── */}
      {activeTab === 'Songs' && (
        <>
          <SearchBar value={query} onChange={setQuery} />
          <SortPicker mode={sortMode} onChange={setSortMode} />
          <FlashList
            data={songsListData}
            renderItem={renderSongsItem}
            keyExtractor={(item) =>
              item.type === 'header' ? `hdr-${item.letter}` : item.track.id
            }
            estimatedItemSize={70}
            getItemType={(item) => (item.type === 'header' ? 'header' : 'track')}
            ListEmptyComponent={emptyComponent}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          />
        </>
      )}

      {/* ── Artists tab ── */}
      {activeTab === 'Artists' && (
        <FlashList
          data={artists}
          renderItem={renderArtistRow}
          keyExtractor={(item) => item.name}
          estimatedItemSize={64}
          ListEmptyComponent={emptyComponent}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* ── Albums tab ── */}
      {activeTab === 'Albums' && (
        <AlbumGrid albums={albums} onPress={handleAlbumPress} />
      )}

      {/* ── Genres tab ── */}
      {activeTab === 'Genres' && (
        <FlashList
          data={genreGroups}
          renderItem={renderGenreCard}
          keyExtractor={(item) => item.genre}
          estimatedItemSize={108}
          ListEmptyComponent={emptyComponent}
          contentContainerStyle={styles.genreListContent}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* ── Playlists tab ── */}
      {activeTab === 'Playlists' && (
        <View style={styles.playlistsRoot}>
          <FlashList
            data={playlistPairs}
            renderItem={renderPlaylistPair}
            keyExtractor={(_, i) => String(i)}
            estimatedItemSize={PLAYLIST_CARD_SIZE + 60}
            ListEmptyComponent={playlistsEmptyComponent}
            contentContainerStyle={styles.playlistGridContent}
            showsVerticalScrollIndicator={false}
          />
          <PlaylistsFAB onPress={handleNewPlaylist} />
        </View>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F5F5F7',
  },
  header: {
    paddingTop: Platform.OS === 'ios' ? 56 : 36,
    paddingBottom: 10,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    backgroundColor: '#F5F5F7',
  },
  headerTitle: {
    fontSize: 34,
    fontWeight: '800',
    color: '#1D1D1F',
    letterSpacing: -1.1,
  },
  headerCount: {
    fontSize: 12,
    fontWeight: '500',
    color: '#8E8E93',
  },
  importButton: {
    marginHorizontal: 20,
    marginBottom: 14,
    height: 48,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FA233B',
    ...Platform.select({
      ios: {
        shadowColor: '#FA233B',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.22,
        shadowRadius: 16,
      },
      android: { elevation: 4 },
    }),
  },
  importButtonText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.1,
  },
  listContent: {
    paddingBottom: 100,
  },
  genreListContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 100,
  },
  playlistsRoot: {
    flex: 1,
  },
  playlistGridContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 180,
  },
  playlistPairRow: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 20,
    paddingHorizontal: 4,
  },
  empty: {
    paddingTop: 80,
    alignItems: 'center',
    gap: 10,
  },
  emptyIcon: {
    fontSize: 40,
    color: '#D2D2D7',
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#8E8E93',
  },
  emptySubtext: {
    fontSize: 13,
    color: '#C7C7CC',
    textAlign: 'center',
    paddingHorizontal: 36,
    lineHeight: 19,
  },
  emptyAction: {
    marginTop: 8,
    minHeight: 42,
    paddingHorizontal: 18,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FA233B',
  },
  emptyActionText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
  },
});
