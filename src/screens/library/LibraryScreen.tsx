import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
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
  Alert,
  ActivityIndicator,
  RefreshControl,
  BackHandler,
} from 'react-native';
import * as Haptics from 'expo-haptics';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useActiveTrack, usePlaybackState, State } from 'react-native-track-player';
import { usePlayCounts } from '@/hooks/useTrackDB';
import { useSafeTracks } from '@/hooks/useSafeTracks';
import { getScreenBottomInset } from '@/utils/layout';
import { EqualizerBars } from '@/components/EqualizerBars';
import { usePlayerQueue } from '@/features/player/useQueue';
import { useUIStore } from '@/stores/uiStore';
import { database, playlistsCollection, tracksCollection } from '@/db';
import type { Playlist } from '@/db/models/Playlist';
import type { Track } from '@/db/models/Track';
import { modelToTrack, modelsToTracks } from '@/utils/trackMapper';
import type { RootStackNavigationProp } from '@/types/navigation';
import { TrackArtwork } from '@/components/track/TrackArtwork';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { PlaylistNameModal } from '@/components/ui/PlaylistNameModal';
import { SwipeableTrackRow } from '@/components/ui/SwipeableTrackRow';
import { ListSkeleton } from '@/components/ui/SkeletonShimmer';
import { BlurView } from 'expo-blur';
import { AlbumGrid, AlbumItem } from './components/AlbumGrid';
import { ArtistRow } from './components/ArtistRow';
import { GenreCard } from './components/GenreCard';
import { importDeviceAudio } from '@/features/localAudio/LocalAudioImporter';
import { bulkDeleteTracks, cleanupVoiceNotesAndClips } from '@/db/cleanup';

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

const SORT_LABELS: Record<SortMode, string> = {
  recently_added: 'Recently Added',
  a_z: 'A – Z',
  most_played: 'Most Played',
};

const SORT_KEYS: SortMode[] = ['recently_added', 'a_z', 'most_played'];

function SortPicker({ mode, onChange }: SortPickerProps) {
  const [sheetOpen, setSheetOpen] = useState(false);

  const handleOpen = useCallback(() => setSheetOpen(true), []);
  const handleClose = useCallback(() => setSheetOpen(false), []);

  const handlePick = useCallback(
    (next: SortMode) => {
      onChange(next);
      setSheetOpen(false);
    },
    [onChange],
  );

  return (
    <>
      <TouchableOpacity onPress={handleOpen} style={sortStyles.button}>
        <Text style={sortStyles.label}>{SORT_LABELS[mode]}</Text>
        <Text style={sortStyles.chevron}>⌄</Text>
      </TouchableOpacity>

      <BottomSheet
        isVisible={sheetOpen}
        onClose={handleClose}
        snapPoint={300}
        backgroundColor="#F5F5F7"
      >
        <View style={sortSheetStyles.header}>
          <Text style={sortSheetStyles.title}>Sort by</Text>
        </View>
        <View style={sortSheetStyles.divider} />
        {SORT_KEYS.map((key, idx) => {
          const selected = key === mode;
          return (
            <React.Fragment key={key}>
              <TouchableOpacity
                onPress={() => handlePick(key)}
                activeOpacity={0.7}
                style={sortSheetStyles.row}
              >
                <Text
                  style={[
                    sortSheetStyles.rowLabel,
                    selected && sortSheetStyles.rowLabelSelected,
                  ]}
                >
                  {SORT_LABELS[key]}
                </Text>
                {selected && (
                  <Ionicons name="checkmark" size={20} color="#FA233B" />
                )}
              </TouchableOpacity>
              {idx < SORT_KEYS.length - 1 && (
                <View style={sortSheetStyles.rowSeparator} />
              )}
            </React.Fragment>
          );
        })}
        <View style={sortSheetStyles.cancelDivider} />
        <TouchableOpacity
          onPress={handleClose}
          activeOpacity={0.7}
          style={sortSheetStyles.row}
        >
          <Text style={sortSheetStyles.cancelLabel}>Cancel</Text>
        </TouchableOpacity>
      </BottomSheet>
    </>
  );
}

const sortSheetStyles = StyleSheet.create({
  header: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 10,
  },
  title: {
    fontSize: 13,
    fontWeight: '700',
    color: '#8E8E93',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(60,60,67,0.16)',
    marginHorizontal: 20,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    height: 54,
  },
  rowLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1D1D1F',
    letterSpacing: -0.2,
  },
  rowLabelSelected: {
    color: '#FA233B',
  },
  rowSeparator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(60,60,67,0.14)',
    marginLeft: 20,
    marginRight: 20,
  },
  cancelDivider: {
    height: 6,
    backgroundColor: 'transparent',
  },
  cancelLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FA233B',
    letterSpacing: -0.2,
  },
});

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
  isActive: boolean;
  isPlaying: boolean;
  selectMode: boolean;
  isSelected: boolean;
  onPress: (track: Track) => void;
  onLongPress: (track: Track) => void;
  onSwipeLike: (track: Track) => void;
  onSwipeQueue: (track: Track) => void;
}

function SongRow({
  track,
  isActive,
  isPlaying,
  selectMode,
  isSelected,
  onPress,
  onLongPress,
  onSwipeLike,
  onSwipeQueue,
}: SongRowProps) {
  const handlePress = useCallback(() => onPress(track), [track, onPress]);
  const handleLongPress = useCallback(() => {
    onLongPress(track);
  }, [track, onLongPress]);
  const handleSwipeLike = useCallback(() => onSwipeLike(track), [track, onSwipeLike]);
  const handleSwipeQueue = useCallback(() => onSwipeQueue(track), [track, onSwipeQueue]);

  return (
    <SwipeableTrackRow
      onSwipeLike={handleSwipeLike}
      onSwipeQueue={handleSwipeQueue}
      disabled={selectMode}
    >
      <TouchableOpacity
        activeOpacity={0.75}
        onPress={handlePress}
        onLongPress={handleLongPress}
        delayLongPress={280}
        style={[
          songRowStyles.container,
          isActive && songRowStyles.containerActive,
          isSelected && songRowStyles.containerSelected,
        ]}
      >
        {selectMode ? (
          <View style={songRowStyles.checkboxWrap}>
            <Ionicons
              name={isSelected ? 'checkmark-circle' : 'radio-button-off-outline'}
              size={26}
              color={isSelected ? '#FA233B' : '#C7C7CC'}
            />
          </View>
        ) : null}
        <TrackArtwork uri={track.artworkPath} blurhash={null} size={50} borderRadius={8} />
        <View style={songRowStyles.meta}>
          <Text
            style={[songRowStyles.title, isActive && songRowStyles.titleActive]}
            numberOfLines={1}
          >
            {track.title}
          </Text>
          <Text style={songRowStyles.artist} numberOfLines={1}>
            {track.artist}
            {track.album ? ` · ${track.album}` : ''}
          </Text>
        </View>
        {selectMode ? null : isActive ? (
          <EqualizerBars
            playing={isPlaying}
            count={3}
            barWidth={3}
            gap={3}
            height={16}
            color="#FA233B"
          />
        ) : (
          <Text style={songRowStyles.duration}>{formatDuration(track.durationMs)}</Text>
        )}
      </TouchableOpacity>
    </SwipeableTrackRow>
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
  containerActive: {
    backgroundColor: 'rgba(250,35,59,0.06)',
  },
  containerSelected: {
    backgroundColor: 'rgba(250,35,59,0.08)',
  },
  checkboxWrap: {
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  meta: { flex: 1 },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1D1D1F',
    letterSpacing: -0.1,
  },
  titleActive: {
    color: '#FA233B',
    fontWeight: '700',
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
  bottomOffset: number;
}

function PlaylistsFAB({ onPress, bottomOffset }: PlaylistsFABProps) {
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
    <Animated.View style={[fabStyles.fab, { bottom: bottomOffset }, fabStyle]}>
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
  const { playTrack, addTrack } = usePlayerQueue();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);

  // ── Layer C — UI render filter ────────────────────────────────────────────
  // Even if a junk row somehow slips past Layer A (import filter) and Layer B
  // (DB cleanup), the user must never see it. `useSafeTracks` is the LAST
  // line of defense — it filters the WatermelonDB observable result BEFORE
  // anything downstream consumes it. Every derivation below (`filteredTracks`,
  // `artists`, `albums`, `genres`, `hasImportedDeviceAudio`, the header
  // count) is built off `safeTracks`. The same hook is now used by every
  // user-visible screen so junk can never leak through Home/Search/Album/etc.
  //
  // Saavn / YouTube downloads are app-managed and known-clean — they bypass
  // the filter inside the hook so a buggy heuristic can never wipe a real
  // download.
  const safeTracks = useSafeTracks();

  // Log only when the safeTracks count changes so the Metro terminal stays
  // readable across re-renders.
  const lastCountsRef = useRef<string>('');
  useEffect(() => {
    const sig = `${safeTracks.length}`;
    if (sig !== lastCountsRef.current) {
      lastCountsRef.current = sig;
      // eslint-disable-next-line no-console
      console.log('[Library] safeTracks count:', safeTracks.length);
    }
  }, [safeTracks.length]);

  // Belt-and-suspenders: run DB cleanup once when the Library screen mounts.
  // Past filter fixes failed because rows imported BEFORE the filter change
  // were never re-evaluated. Running cleanup on screen mount means the next
  // user session self-heals without waiting for them to tap a button.
  useEffect(() => {
    void cleanupVoiceNotesAndClips();
  }, []);

  const playCounts = usePlayCounts();
  const activeRntpTrack = useActiveTrack();
  const activeTrackId = activeRntpTrack?.id ? String(activeRntpTrack.id) : null;
  const playbackState = usePlaybackState();
  const isPlaying = playbackState.state === State.Playing;
  const [activeTab, setActiveTab] = useState<TabKey>('Songs');
  const [query, setQuery] = useState('');
  // Debounce the search input so a 1500-track filter doesn't run on every
  // keystroke. 120 ms feels instant but suppresses transient renders.
  const [debouncedQuery, setDebouncedQuery] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 120);
    return () => clearTimeout(t);
  }, [query]);
  const [sortMode, setSortMode] = useState<SortMode>('recently_added');
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [isImportingAudio, setIsImportingAudio] = useState(false);
  const [playlistModalOpen, setPlaylistModalOpen] = useState(false);

  // ── Multi-select / bulk-delete state ─────────────────────────────────────
  // Ephemeral by design — purely in-component so closing the screen or app
  // cleanly exits the mode. The Set keeps toggle/contains checks O(1) even
  // when 748+ junk rows are selected at once.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  // Once the user has imported any device audio at all, hide the big
  // promo button — it's only there for the first-launch onboarding moment.
  // They can always re-scan from Settings if they add new files later.
  const hasImportedDeviceAudio = useMemo(
    () => safeTracks.some((t) => t.source === 'local'),
    [safeTracks],
  );

  // Recompute the list-bottom inset whenever the active-track state changes,
  // so the giant MiniPlayer reservation collapses to a small tab-bar-only
  // inset when nothing is playing.
  const bottomPadding = getScreenBottomInset(insets.bottom, !!activeRntpTrack);

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
    let result = safeTracks;
    const trimmed = debouncedQuery.trim();
    if (trimmed) {
      const q = trimmed.toLowerCase();
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
        return [...result].sort(
          (a, b) => (playCounts.get(b.id) ?? 0) - (playCounts.get(a.id) ?? 0),
        );
      case 'recently_added':
      default:
        return result;
    }
  }, [safeTracks, debouncedQuery, sortMode, playCounts]);

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
    for (const t of safeTracks) {
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
  }, [safeTracks]);

  // ── Albums tab ──

  const albums = useMemo((): AlbumItem[] => {
    const map = new Map<string, { artist: string; trackCount: number; artworkPath: string | null }>();
    for (const t of safeTracks) {
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
  }, [safeTracks]);

  // ── Genres tab ──

  const genreGroups = useMemo(() => buildGenreGroups(safeTracks), [safeTracks]);

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
      // In selection mode a tap toggles membership; in normal mode it plays.
      if (selectMode) {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setSelectedIds((prev) => {
          const next = new Set(prev);
          if (next.has(track.id)) next.delete(track.id);
          else next.add(track.id);
          return next;
        });
        return;
      }
      void playTrack(modelToTrack(track), modelsToTracks(filteredTracks));
      navigation.navigate('NowPlaying');
    },
    [playTrack, filteredTracks, navigation, selectMode],
  );

  const openSheet = useUIStore((s) => s.openSheet);
  const handleLongPress = useCallback(
    (track: Track) => {
      // Long-press behaviour:
      //  • Not in select mode → enter select mode and seed the set with this
      //    row. Suppress the usual context sheet so the user gets a single
      //    obvious affordance (the toolbar).
      //  • Already in select mode → just toggle this row, same as tap.
      if (!selectMode) {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        setSelectMode(true);
        setSelectedIds(new Set([track.id]));
        return;
      }
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(track.id)) next.delete(track.id);
        else next.add(track.id);
        return next;
      });
      // The full track-context sheet is still reachable from the global
      // sheets infrastructure; we only intercept long-press while the user
      // is curating a selection. The original entry point lives unchanged
      // via `openSheet('track-context', ...)` elsewhere.
      void openSheet;
    },
    [openSheet, selectMode],
  );

  // ── Selection-mode handlers ─────────────────────────────────────────────

  const visibleTrackIds = useMemo(
    () => filteredTracks.map((t) => t.id),
    [filteredTracks],
  );
  const allVisibleSelected = useMemo(() => {
    if (visibleTrackIds.length === 0) return false;
    for (const id of visibleTrackIds) {
      if (!selectedIds.has(id)) return false;
    }
    return true;
  }, [visibleTrackIds, selectedIds]);

  const handleToggleSelectAll = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (allVisibleSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(visibleTrackIds));
    }
  }, [allVisibleSelected, visibleTrackIds]);

  const handleBulkDelete = useCallback(() => {
    if (selectedIds.size === 0 || isDeleting) return;
    const ids = [...selectedIds];
    const count = ids.length;
    Alert.alert(
      `Delete ${count} ${count === 1 ? 'track' : 'tracks'}?`,
      'Delete these tracks from your library? Their files on your device will NOT be deleted.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            setIsDeleting(true);
            void (async () => {
              try {
                const result = await bulkDeleteTracks(ids);
                exitSelectMode();
                Alert.alert(
                  'Library cleaned',
                  `Removed ${result.total} ${result.total === 1 ? 'track' : 'tracks'} from your library.`,
                );
              } catch (err) {
                Alert.alert(
                  'Could not delete tracks',
                  err instanceof Error ? err.message : 'Please try again.',
                );
              } finally {
                setIsDeleting(false);
              }
            })();
          },
        },
      ],
    );
  }, [selectedIds, isDeleting, exitSelectMode]);

  // Android hardware back: while selecting, swallow the back press and just
  // exit select mode instead of navigating away from the Library tab.
  useEffect(() => {
    if (!selectMode) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      exitSelectMode();
      return true;
    });
    return () => sub.remove();
  }, [selectMode, exitSelectMode]);

  // Selection mode is Songs-only — if the user flips to a different tab,
  // bail out cleanly so the selection toolbar never floats above a list it
  // can't act on.
  useEffect(() => {
    if (selectMode && activeTab !== 'Songs') {
      exitSelectMode();
    }
  }, [activeTab, selectMode, exitSelectMode]);

  // Right-swipe on a song row: toggle the DB "liked" flag for that track.
  // Mirrors what the GlobalSheets sheet does so behaviour stays consistent.
  const handleSwipeLike = useCallback(async (track: Track) => {
    try {
      const model = await tracksCollection.find(track.id);
      await database.write(async () => {
        await model.update((rec) => {
          (rec as { liked: boolean }).liked = !(rec as { liked: boolean }).liked;
        });
      });
    } catch {
      // ignore — list will refresh via observers if the toggle succeeded.
    }
  }, []);

  // Left-swipe: drop the track at the end of the upcoming queue without
  // interrupting whatever is currently playing.
  const handleSwipeQueue = useCallback(
    (track: Track) => {
      void addTrack(modelToTrack(track));
    },
    [addTrack],
  );

  // Pull-to-refresh: WatermelonDB observers keep the list live already, so
  // the visible rows can't really be "stale" — but a pull is the user
  // signalling "fix anything that looks off". We use the gesture to
  // re-run the cleanup sweep (catches WhatsApp voice notes / UUID-named
  // clips that may have landed since mount) and only clear the spinner
  // once the sweep settles, so the feedback is honest about doing work.
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await cleanupVoiceNotesAndClips();
    } catch {
      // Non-fatal — sweep failures don't block the UI.
    } finally {
      setRefreshing(false);
    }
  }, []);

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
    setPlaylistModalOpen(true);
  }, []);

  const handleClosePlaylistModal = useCallback(() => {
    setPlaylistModalOpen(false);
  }, []);

  const handleCreatePlaylist = useCallback(async (name: string) => {
    // The modal already trims and validates non-empty; we just persist.
    await database.write(async () => {
      await playlistsCollection.create((record) => {
        (record as any).name = name;
        (record as any).createdAt = Math.floor(Date.now() / 1000);
        (record as any).artworkPath = null;
      });
    });
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

      const lines: string[] = [];
      if (result.imported > 0) {
        lines.push(
          `Added ${result.imported} song${result.imported === 1 ? '' : 's'} from your device.`,
        );
      } else {
        lines.push('No new music files were found.');
      }
      if (result.rejected > 0) {
        lines.push(
          `Filtered out ${result.rejected} voice memo${result.rejected === 1 ? '' : 's'} and short clip${result.rejected === 1 ? '' : 's'}.`,
        );
      }
      Alert.alert('Device music scan complete', lines.join('\n'));
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
          isActive={activeTrackId === item.track.id}
          isPlaying={isPlaying}
          selectMode={selectMode}
          isSelected={selectedIds.has(item.track.id)}
          onPress={handleTrackPress}
          onLongPress={handleLongPress}
          onSwipeLike={handleSwipeLike}
          onSwipeQueue={handleSwipeQueue}
        />
      );
    },
    [
      handleTrackPress,
      handleLongPress,
      handleSwipeLike,
      handleSwipeQueue,
      activeTrackId,
      isPlaying,
      selectMode,
      selectedIds,
    ],
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

      {/* Frosted-glass header — same BlurView treatment as BlurHeader, but
          inlined so the existing layout (and its non-Animated list views)
          don't need to be restructured.

          When `selectMode` is on, the title/count is swapped for the bulk-
          action toolbar (Cancel / N selected / Select All + Delete). The
          underlying blur + insets stay identical so the layout doesn't
          jump as the user enters/exits the mode. */}
      <View
        style={[
          styles.header,
          { paddingTop: Math.max(insets.top + 8, Platform.OS === 'ios' ? 56 : 36) },
        ]}
      >
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <BlurView intensity={50} tint="light" style={StyleSheet.absoluteFill} />
          <View style={styles.headerSurface} />
        </View>
        {selectMode ? (
          <View style={styles.selectionBar}>
            <TouchableOpacity
              onPress={exitSelectMode}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={styles.selectionCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.selectionCount} numberOfLines={1}>
              {selectedIds.size} selected
            </Text>
            <View style={styles.selectionRightCluster}>
              <TouchableOpacity
                onPress={handleToggleSelectAll}
                hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
                disabled={visibleTrackIds.length === 0}
              >
                <Text
                  style={[
                    styles.selectionAction,
                    visibleTrackIds.length === 0 && styles.selectionActionDisabled,
                  ]}
                >
                  {allVisibleSelected ? 'Deselect All' : 'Select All'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleBulkDelete}
                disabled={selectedIds.size === 0 || isDeleting}
                hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
              >
                {isDeleting ? (
                  <ActivityIndicator size="small" color="#FA233B" />
                ) : (
                  <Text
                    style={[
                      styles.selectionDelete,
                      (selectedIds.size === 0) && styles.selectionActionDisabled,
                    ]}
                  >
                    Delete
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <>
            <Text style={styles.headerTitle}>Library</Text>
            <Text style={styles.headerCount}>
              {safeTracks.length} {safeTracks.length === 1 ? 'song' : 'songs'}
            </Text>
          </>
        )}
      </View>

      {!hasImportedDeviceAudio && (
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
      )}

      {/* Tab bar */}
      <TabBar activeTab={activeTab} onTabPress={setActiveTab} />

      {/* ── Songs tab ── */}
      {activeTab === 'Songs' && (
        <>
          <SearchBar value={query} onChange={setQuery} />
          {/* The sort picker lives inside the regular header chrome and is
              meaningless while the user is curating a selection — the
              toolbar already owns that row. */}
          {!selectMode && <SortPicker mode={sortMode} onChange={setSortMode} />}
          {/* Wrap the list so we can shrink its viewport — without this the
              FlashList fills the screen and content scrolls behind the
              floating MiniPlayer. paddingBottom on the wrapper ends the
              list above the chrome stack. */}
          <View style={{ flex: 1, paddingBottom: bottomPadding }}>
            {safeTracks.length === 0 && !hasImportedDeviceAudio ? (
              // First-launch state — no library yet. Show shimmer placeholders
              // so the screen doesn't feel empty while the user thinks about
              // tapping "Add songs".
              <ListSkeleton count={8} />
            ) : (
              <FlashList
                data={songsListData}
                renderItem={renderSongsItem}
                keyExtractor={(item) =>
                  item.type === 'header' ? `hdr-${item.letter}` : item.track.id
                }
                estimatedItemSize={70}
                getItemType={(item) => (item.type === 'header' ? 'header' : 'track')}
                ListEmptyComponent={emptyComponent}
                showsVerticalScrollIndicator={false}
                refreshControl={
                  <RefreshControl
                    refreshing={refreshing}
                    onRefresh={handleRefresh}
                    tintColor="#FA233B"
                    colors={['#FA233B']}
                  />
                }
              />
            )}
          </View>
        </>
      )}

      {/* ── Artists tab ── */}
      {activeTab === 'Artists' && (
        <View style={{ flex: 1, paddingBottom: bottomPadding }}>
          <FlashList
            data={artists}
            renderItem={renderArtistRow}
            keyExtractor={(item) => item.name}
            estimatedItemSize={64}
            ListEmptyComponent={emptyComponent}
            showsVerticalScrollIndicator={false}
          />
        </View>
      )}

      {/* ── Albums tab ── */}
      {activeTab === 'Albums' && (
        <View style={{ flex: 1, paddingBottom: bottomPadding }}>
          <AlbumGrid
            albums={albums}
            onPress={handleAlbumPress}
            contentBottomPadding={0}
          />
        </View>
      )}

      {/* ── Genres tab ── */}
      {activeTab === 'Genres' && (
        <View style={{ flex: 1, paddingBottom: bottomPadding }}>
          <FlashList
            data={genreGroups}
            renderItem={renderGenreCard}
            keyExtractor={(item) => item.genre}
            estimatedItemSize={108}
            ListEmptyComponent={emptyComponent}
            contentContainerStyle={{
              paddingHorizontal: 16,
              paddingTop: 8,
            }}
            showsVerticalScrollIndicator={false}
          />
        </View>
      )}

      {/* ── Playlists tab ── */}
      {activeTab === 'Playlists' && (
        <View style={[styles.playlistsRoot, { paddingBottom: bottomPadding }]}>
          <FlashList
            data={playlistPairs}
            renderItem={renderPlaylistPair}
            keyExtractor={(_, i) => String(i)}
            estimatedItemSize={PLAYLIST_CARD_SIZE + 60}
            ListEmptyComponent={playlistsEmptyComponent}
            contentContainerStyle={{
              paddingHorizontal: 16,
              paddingTop: 12,
            }}
            showsVerticalScrollIndicator={false}
          />
          <PlaylistsFAB onPress={handleNewPlaylist} bottomOffset={bottomPadding + 16} />
        </View>
      )}

      <PlaylistNameModal
        visible={playlistModalOpen}
        onClose={handleClosePlaylistModal}
        onSubmit={handleCreatePlaylist}
        title="New Playlist"
        placeholder="Playlist name"
        submitLabel="Create"
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
  header: {
    paddingBottom: 10,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    backgroundColor: 'transparent',
    overflow: 'hidden',
  },
  headerSurface: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(245,245,247,0.78)',
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
  selectionBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  selectionCancel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1D1D1F',
    letterSpacing: -0.1,
  },
  selectionCount: {
    flex: 1,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '800',
    color: '#FA233B',
    letterSpacing: -0.2,
  },
  selectionRightCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  selectionAction: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1D1D1F',
    letterSpacing: -0.1,
  },
  selectionDelete: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FA233B',
    letterSpacing: -0.1,
  },
  selectionActionDisabled: {
    opacity: 0.35,
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
  playlistsRoot: {
    flex: 1,
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
