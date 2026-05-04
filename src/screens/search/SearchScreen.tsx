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
  StatusBar,
  SectionList,
  KeyboardAvoidingView,
  Dimensions,
  Modal,
  Alert,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import Fuse from 'fuse.js';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useActiveTrack } from 'react-native-track-player';
import { useAllTracks } from '@/hooks/useTrackDB';
import { useDebounce } from '@/hooks/useDebounce';
import { usePlayerQueue } from '@/features/player/useQueue';
import { useDownloadStore } from '@/stores/downloadStore';
import { DownloadManager } from '@/features/download/DownloadManager';
import { searchMusic } from '@/features/download/searchMusic';
import { getScreenBottomInset } from '@/utils/layout';
import { settingsStorage } from '@/stores/settingsStore';
import { TrackArtwork } from '@/components/track/TrackArtwork';
import { YoutubeResultCard } from './components/YoutubeResultCard';
import type { Track } from '@/db/models/Track';
import { modelToTrack, modelsToTracks } from '@/utils/trackMapper';
import type { YouTubeSearchResult } from '@/types/track';
import type { RootStackNavigationProp } from '@/types/navigation';

// ─── Constants ────────────────────────────────────────────────────────────────

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const RECENT_SEARCHES_KEY = 'recent_searches';
const MAX_RECENT = 8;

type SearchGenreIcon = React.ComponentProps<typeof Ionicons>['name'];

const BOLLYWOOD_GENRES: Array<{ label: string; icon: SearchGenreIcon; query: string }> = [
  { label: 'Romantic', icon: 'heart', query: 'Bollywood Romantic songs' },
  { label: 'Party', icon: 'sparkles', query: 'Bollywood party hits' },
  { label: 'Devotional', icon: 'flower', query: 'Bollywood devotional songs' },
  { label: 'Classic', icon: 'disc', query: 'Classic Bollywood songs' },
  { label: 'Rap', icon: 'mic', query: 'Hindi rap songs' },
  { label: 'Sad', icon: 'rainy', query: 'Bollywood sad songs' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

function loadRecentSearches(): string[] {
  try {
    const raw = settingsStorage.getString(RECENT_SEARCHES_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function saveRecentSearch(query: string) {
  try {
    const existing = loadRecentSearches();
    const updated = [query, ...existing.filter((s) => s !== query)].slice(0, MAX_RECENT);
    settingsStorage.set(RECENT_SEARCHES_KEY, JSON.stringify(updated));
  } catch {}
}

function removeRecentSearch(query: string) {
  try {
    const updated = loadRecentSearches().filter((s) => s !== query);
    settingsStorage.set(RECENT_SEARCHES_KEY, JSON.stringify(updated));
  } catch {}
}

// ─── Quality download sheet ───────────────────────────────────────────────────

type Quality = '128k' | '192k' | '256k' | '320k';

interface QualitySheetProps {
  visible: boolean;
  onSelect: (quality: Quality) => void;
  onDismiss: () => void;
}

function QualitySheet({ visible, onSelect, onDismiss }: QualitySheetProps) {
  const translateY = useSharedValue(300);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      opacity.value = withTiming(1, { duration: 200 });
      translateY.value = withTiming(0, { duration: 260 });
    } else {
      opacity.value = withTiming(0, { duration: 180 });
      translateY.value = withTiming(300, { duration: 220 });
    }
  }, [visible]);

  const overlayStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const QUALITIES: Quality[] = ['320k'];
  const labels: Record<Quality, string> = {
    '128k': 'Source quality — Small file',
    '192k': 'Source quality — Balanced',
    '256k': 'Source quality — High quality',
    '320k': 'Best available source audio',
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onDismiss}
    >
      <View style={qualityStyles.modalRoot}>
        <Animated.View style={[qualityStyles.overlay, overlayStyle]}>
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onDismiss} />
        </Animated.View>
        <Animated.View style={[qualityStyles.sheet, sheetStyle]}>
          <View style={qualityStyles.handle} />
          <Text style={qualityStyles.title}>Download Song</Text>
          {QUALITIES.map((q) => (
            <TouchableOpacity
              key={q}
              style={qualityStyles.option}
              onPress={() => onSelect(q)}
              activeOpacity={0.75}
            >
              <Text style={qualityStyles.optionBitrate}>Best</Text>
              <Text style={qualityStyles.optionLabel}>{labels[q]}</Text>
            </TouchableOpacity>
          ))}
        </Animated.View>
      </View>
    </Modal>
  );
}

const qualityStyles = StyleSheet.create({
  modalRoot: {
    flex: 1,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingBottom: Platform.OS === 'ios' ? 36 : 28,
    paddingHorizontal: 20,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#C7C7CC',
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 16,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1D1D1F',
    marginBottom: 12,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F2F2F7',
  },
  optionBitrate: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FA233B',
    width: 44,
  },
  optionLabel: {
    fontSize: 14,
    fontWeight: '400',
    color: '#3A3A3C',
  },
});

// ─── YouTube skeleton ──────────────────────────────────────────────────────────

function YouTubeSkeleton() {
  return (
    <View style={skeletonStyles.container}>
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={skeletonStyles.row}>
          <View style={skeletonStyles.thumb} />
          <View style={skeletonStyles.meta}>
            <View style={skeletonStyles.line1} />
            <View style={skeletonStyles.line2} />
            <View style={skeletonStyles.line3} />
          </View>
          <View style={skeletonStyles.button} />
        </View>
      ))}
    </View>
  );
}

const skeletonStyles = StyleSheet.create({
  container: { paddingHorizontal: 20, gap: 16, paddingTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  thumb: {
    width: 100,
    height: 70,
    borderRadius: 8,
    backgroundColor: '#1C1C1C',
  },
  meta: { flex: 1, gap: 6 },
  line1: { height: 12, width: '80%', borderRadius: 6, backgroundColor: '#1C1C1C' },
  line2: { height: 10, width: '55%', borderRadius: 5, backgroundColor: '#EFEFF4' },
  line3: { height: 9, width: '35%', borderRadius: 5, backgroundColor: '#161616' },
  button: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#1C1C1C' },
});

// ─── Local track row ──────────────────────────────────────────────────────────

interface LocalTrackRowProps {
  track: Track;
  onPress: (track: Track) => void;
}

function LocalTrackRow({ track, onPress }: LocalTrackRowProps) {
  const handlePress = useCallback(() => onPress(track), [track, onPress]);

  return (
    <TouchableOpacity
      activeOpacity={0.78}
      onPress={handlePress}
      style={localRowStyles.container}
    >
      <View style={localRowStyles.artworkWrapper}>
        <TrackArtwork uri={track.artworkPath} blurhash={null} size={50} borderRadius={8} />
        <View style={localRowStyles.downloadedBadge}>
          <Ionicons name="checkmark" size={10} color="#FFFFFF" />
        </View>
      </View>

      <View style={localRowStyles.meta}>
        <View style={localRowStyles.titleRow}>
          <Text style={localRowStyles.title} numberOfLines={1}>
            {track.title}
          </Text>
        </View>
        <Text style={localRowStyles.artist} numberOfLines={1}>
          {track.artist}
          {track.durationMs > 0 ? ` · ${formatDuration(track.durationMs)}` : ''}
        </Text>
      </View>

      {/* Green local dot indicator */}
      <View style={localRowStyles.localDot} />
    </TouchableOpacity>
  );
}

const localRowStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 9,
    gap: 12,
  },
  artworkWrapper: {
    position: 'relative',
    flexShrink: 0,
  },
  downloadedBadge: {
    position: 'absolute',
    bottom: -3,
    left: -3,
    backgroundColor: '#34C759',
    borderRadius: 8,
    width: 16,
    height: 16,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#F5F5F7',
  },
  meta: { flex: 1 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  title: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#1D1D1F',
  },
  artist: {
    fontSize: 12,
    color: '#6E6E73',
    marginTop: 2,
  },
  localDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#1DB954',
    flexShrink: 0,
  },
});

// ─── Section headers ──────────────────────────────────────────────────────────

interface SectionHeaderProps {
  title: string;
  badge: string;
  badgeColor: string;
}

function SearchSectionHeader({ title, badge, badgeColor }: SectionHeaderProps) {
  return (
    <View style={sectionHeaderStyles.container}>
      <Text style={sectionHeaderStyles.title}>{title}</Text>
      <View style={[sectionHeaderStyles.badge, { backgroundColor: badgeColor }]}>
        <Text style={sectionHeaderStyles.badgeText}>{badge}</Text>
      </View>
    </View>
  );
}

const sectionHeaderStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 10,
    backgroundColor: '#F5F5F7',
    gap: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1D1D1F',
  },
  badge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#1D1D1F',
    letterSpacing: 0.5,
  },
});

// ─── Genre grid (empty state) ─────────────────────────────────────────────────

interface GenreGridProps {
  onSelect: (query: string) => void;
}

function GenreGrid({ onSelect }: GenreGridProps) {
  const ITEM_WIDTH = (SCREEN_WIDTH - 52) / 2;

  return (
    <View style={genreGridStyles.container}>
      <Text style={genreGridStyles.heading}>Explore Genres</Text>
      <View style={genreGridStyles.grid}>
        {BOLLYWOOD_GENRES.map((g) => (
          <TouchableOpacity
            key={g.label}
            onPress={() => onSelect(g.query)}
            style={[genreGridStyles.card, { width: ITEM_WIDTH }]}
            activeOpacity={0.8}
          >
            <Ionicons name={g.icon} size={22} color="#FA233B" />
            <Text style={genreGridStyles.label}>{g.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const genreGridStyles = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    marginBottom: 28,
  },
  heading: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1D1D1F',
    marginBottom: 14,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  card: {
    height: 72,
    backgroundColor: '#161616',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#D2D2D7',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.4,
        shadowRadius: 6,
      },
      android: { elevation: 3 },
    }),
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#CCCCCC',
  },
});

// ─── Recent searches ──────────────────────────────────────────────────────────

interface RecentSearchesProps {
  searches: string[];
  onSelect: (query: string) => void;
  onRemove: (query: string) => void;
  onClearAll: () => void;
}

function RecentSearches({ searches, onSelect, onRemove, onClearAll }: RecentSearchesProps) {
  if (searches.length === 0) return null;

  return (
    <View style={recentStyles.container}>
      <View style={recentStyles.header}>
        <Text style={recentStyles.heading}>Recent Searches</Text>
        <TouchableOpacity onPress={onClearAll}>
          <Text style={recentStyles.clearAll}>Clear All</Text>
        </TouchableOpacity>
      </View>
      {searches.map((s) => (
        <View key={s} style={recentStyles.row}>
          <TouchableOpacity
            style={recentStyles.rowMain}
            onPress={() => onSelect(s)}
            activeOpacity={0.75}
          >
            <Ionicons name="time-outline" size={17} color="#8E8E93" />
            <Text style={recentStyles.text} numberOfLines={1}>
              {s}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => onRemove(s)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="close" size={14} color="#8E8E93" />
          </TouchableOpacity>
        </View>
      ))}
    </View>
  );
}

const recentStyles = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  heading: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1D1D1F',
  },
  clearAll: {
    fontSize: 13,
    color: '#FA233B',
    fontWeight: '500',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: '#FFFFFF',
  },
  rowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  text: {
    fontSize: 15,
    fontWeight: '400',
    color: '#3A3A3C',
    flex: 1,
  },
});

// ─── YouTube result with library check ───────────────────────────────────────

interface YtResultRowProps {
  result: YouTubeSearchResult;
  isInLibrary: boolean;
  downloadProgress: number | undefined;
  onDownload: (id: string, title: string, artist: string, thumbnail: string) => void;
}

function YtResultRow({ result, isInLibrary, downloadProgress, onDownload }: YtResultRowProps) {
  // If already in library we display a status badge instead of a download button.
  // We do this by passing a fake 100 progress to YoutubeResultCard when isInLibrary
  return (
    <YoutubeResultCard
      result={result}
      onDownload={onDownload}
      downloadProgress={isInLibrary ? 100 : downloadProgress}
    />
  );
}

// ─── Section list types ───────────────────────────────────────────────────────

type LocalSection = {
  title: 'In Your Library';
  badge: 'LOCAL';
  badgeColor: '#1DB954';
  data: Track[];
  sectionType: 'local';
};

type YouTubeSection = {
  title: 'Online';
  badge: 'STREAMING';
  badgeColor: '#FA233B';
  data: YouTubeSearchResult[];
  sectionType: 'youtube';
};

type SearchSection = LocalSection | YouTubeSection;

// ─── Main screen ──────────────────────────────────────────────────────────────

export function SearchScreen() {
  const navigation = useNavigation<RootStackNavigationProp>();
  const insets = useSafeAreaInsets();
  const { playTrack } = usePlayerQueue();
  const activeRntpTrack = useActiveTrack();
  const downloadQueue = useDownloadStore((s) => s.queue);

  const allTracks = useAllTracks();
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 420);
  const inputRef = useRef<TextInput>(null);

  const [recentSearches, setRecentSearches] = useState<string[]>(() => loadRecentSearches());
  const [pendingDownload, setPendingDownload] = useState<YouTubeSearchResult | null>(null);
  const [qualitySheetVisible, setQualitySheetVisible] = useState(false);

  // Animated search bar width (expands when focused)
  const cancelOpacity = useSharedValue(0);

  const handleSearchFocus = useCallback(() => {
    cancelOpacity.value = withTiming(1, { duration: 180 });
  }, []);

  const handleSearchBlur = useCallback(() => {
    if (query.length === 0) {
      cancelOpacity.value = withTiming(0, { duration: 180 });
    }
  }, [query]);

  const cancelStyle = useAnimatedStyle(() => ({
    opacity: cancelOpacity.value,
    width: cancelOpacity.value * 60,
  }));

  // Auto-focus on mount
  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 200);
    return () => clearTimeout(timer);
  }, []);

  // ── Fuse.js local search ──

  const fuse = useMemo(
    () =>
      new Fuse(allTracks, {
        keys: [
          { name: 'title', weight: 0.6 },
          { name: 'artist', weight: 0.3 },
          { name: 'album', weight: 0.1 },
        ],
        threshold: 0.35,
        includeScore: true,
      }),
    [allTracks],
  );

  const localResults = useMemo((): Track[] => {
    if (!debouncedQuery.trim()) return [];
    return fuse.search(debouncedQuery).map((r) => r.item).slice(0, 8);
  }, [fuse, debouncedQuery]);

  // ── YouTube search ──

  const {
    data: ytResults,
    isFetching: ytLoading,
    isError: ytError,
    refetch: retryYouTubeSearch,
  } = useQuery({
    queryKey: ['music-search', debouncedQuery],
    queryFn: () => searchMusic(debouncedQuery, 15),
    enabled: debouncedQuery.trim().length >= 2,
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });

  // ── Download state ──

  const progressMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of downloadQueue) {
      map.set(item.youtubeId, item.progress);
    }
    return map;
  }, [downloadQueue]);

  // Library lookup: build a set of "title|||artist" for fast matching
  const libraryFingerprints = useMemo(() => {
    const set = new Set<string>();
    for (const t of allTracks) {
      set.add(`${t.title.toLowerCase()}|||${t.artist.toLowerCase()}`);
    }
    return set;
  }, [allTracks]);

  const isInLibrary = useCallback(
    (result: YouTubeSearchResult): boolean => {
      // Try both full title and parsed "Artist - Title"
      const fullKey = `${result.title.toLowerCase()}|||${result.author.toLowerCase()}`;
      if (libraryFingerprints.has(fullKey)) return true;
      const dashIdx = result.title.indexOf(' - ');
      if (dashIdx > 0) {
        const artist = result.title.substring(0, dashIdx).trim().toLowerCase();
        const title = result.title.substring(dashIdx + 3).trim().toLowerCase();
        return libraryFingerprints.has(`${title}|||${artist}`);
      }
      return false;
    },
    [libraryFingerprints],
  );

  // ── Handlers ──

  const handleQueryChange = useCallback((text: string) => {
    setQuery(text);
  }, []);

  const handleClearQuery = useCallback(() => {
    setQuery('');
    cancelOpacity.value = withTiming(0, { duration: 180 });
    inputRef.current?.focus();
  }, []);

  const handleCancel = useCallback(() => {
    setQuery('');
    cancelOpacity.value = withTiming(0, { duration: 180 });
    inputRef.current?.blur();
  }, []);

  const handleShortcutPress = useCallback((genreQuery: string) => {
    setQuery(genreQuery);
    cancelOpacity.value = withTiming(1, { duration: 180 });
    saveRecentSearch(genreQuery);
    setRecentSearches(loadRecentSearches());
    inputRef.current?.blur();
  }, []);

  const handleRecentPress = useCallback((recent: string) => {
    setQuery(recent);
    cancelOpacity.value = withTiming(1, { duration: 180 });
    inputRef.current?.blur();
  }, []);

  const handleRemoveRecent = useCallback((recent: string) => {
    removeRecentSearch(recent);
    setRecentSearches(loadRecentSearches());
  }, []);

  const handleClearAllRecent = useCallback(() => {
    settingsStorage.set(RECENT_SEARCHES_KEY, '[]');
    setRecentSearches([]);
  }, []);

  const handleLocalTrackPress = useCallback(
    (track: Track) => {
      void playTrack(modelToTrack(track), modelsToTracks(allTracks));
      navigation.navigate('NowPlaying');
    },
    [playTrack, allTracks, navigation],
  );

  const handleSubmitEditing = useCallback(() => {
    if (query.trim()) {
      saveRecentSearch(query.trim());
      setRecentSearches(loadRecentSearches());
    }
  }, [query]);

  const handleDownloadRequest = useCallback(
    (id: string, _title: string, _artist: string, _thumbnail: string) => {
      const result = (ytResults ?? []).find((r) => r.id === id);
      if (result) {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setPendingDownload(result);
        setQualitySheetVisible(true);
      }
    },
    [ytResults],
  );

  const handleQualitySelect = useCallback(
    async (_quality: Quality) => {
      if (!pendingDownload) return;
      setQualitySheetVisible(false);
      const { title: trackTitle, author } = pendingDownload;
      const provider = pendingDownload.provider ?? 'youtube';
      // Saavn provides the proper album from search; YouTube has no clean
      // album so we fall back to the channel name as a reasonable label.
      const album =
        provider === 'saavn'
          ? pendingDownload.saavnAlbum ?? 'JioSaavn'
          : 'YouTube';
      const result = await DownloadManager.enqueue({
        youtubeId: pendingDownload.id,
        title: trackTitle,
        artist: author,
        album,
        thumbnail: pendingDownload.thumbnail,
        durationMs: pendingDownload.duration_ms,
        provider,
        saavnEncryptedUrl: pendingDownload.saavnEncryptedUrl,
        saavnHas320kbps: pendingDownload.saavnHas320kbps,
      });
      if (!result.success) {
        Alert.alert(
          'Cannot start download',
          result.reason ?? 'Please try again.',
        );
      }
      setPendingDownload(null);
    },
    [pendingDownload],
  );

  const handleQualityDismiss = useCallback(() => {
    setQualitySheetVisible(false);
    setPendingDownload(null);
  }, []);

  // ── Section list data ──

  const isSearching = debouncedQuery.trim().length >= 2;

  const sections = useMemo((): SearchSection[] => {
    if (!isSearching) return [];
    const result: SearchSection[] = [];
    if (localResults.length > 0) {
      result.push({
        title: 'In Your Library',
        badge: 'LOCAL',
        badgeColor: '#1DB954',
        data: localResults,
        sectionType: 'local',
      });
    }
    result.push({
      title: 'Online',
      badge: 'STREAMING',
      badgeColor: '#FA233B',
      data: ytResults ?? [],
      sectionType: 'youtube',
    });
    return result;
  }, [isSearching, localResults, ytResults]);

  // ── Render items ──

  const renderSectionHeader = useCallback(
    ({ section }: { section: SearchSection }) => (
      <SearchSectionHeader
        title={section.title}
        badge={section.badge}
        badgeColor={section.badgeColor}
      />
    ),
    [],
  );

  const renderItem = useCallback(
    ({ item, section }: { item: Track | YouTubeSearchResult; section: SearchSection }) => {
      if (section.sectionType === 'local') {
        return (
          <LocalTrackRow
            track={item as Track}
            onPress={handleLocalTrackPress}
          />
        );
      }

      // YouTube section
      const ytItem = item as YouTubeSearchResult;
      return (
        <YtResultRow
          result={ytItem}
          isInLibrary={isInLibrary(ytItem)}
          downloadProgress={progressMap.get(ytItem.id)}
          onDownload={handleDownloadRequest}
        />
      );
    },
    [handleLocalTrackPress, isInLibrary, progressMap, handleDownloadRequest],
  );

  const keyExtractor = useCallback(
    (item: Track | YouTubeSearchResult, index: number): string => {
      if ((item as Track).artworkPath !== undefined) return (item as Track).id;
      return (item as YouTubeSearchResult).id + index;
    },
    [],
  );

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor="#F5F5F7" />

      {/* ── Search header ── */}
      <View style={[styles.searchHeader, { paddingTop: insets.top + 12 }]}>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={18} color="#8E8E93" />
          <TextInput
            ref={inputRef}
            style={styles.searchInput}
            value={query}
            onChangeText={handleQueryChange}
            onSubmitEditing={handleSubmitEditing}
            onFocus={handleSearchFocus}
            onBlur={handleSearchBlur}
            placeholder="Songs, artists, YouTube…"
            placeholderTextColor="#8E8E93"
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
          />
          {query.length > 0 && (
            <TouchableOpacity
              onPress={handleClearQuery}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close-circle" size={18} color="#8E8E93" />
            </TouchableOpacity>
          )}
        </View>
        <Animated.View style={[styles.cancelWrapper, cancelStyle]}>
          <TouchableOpacity onPress={handleCancel}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>

      {/* ── Content ── */}
      <KeyboardAvoidingView
        style={styles.content}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {!isSearching ? (
          /* Empty state */
          <SectionList
            sections={[]}
            renderItem={() => null}
            renderSectionHeader={() => null}
            ListHeaderComponent={
              <View style={styles.emptyState}>
                <GenreGrid onSelect={handleShortcutPress} />
                <RecentSearches
                  searches={recentSearches}
                  onSelect={handleRecentPress}
                  onRemove={handleRemoveRecent}
                  onClearAll={handleClearAllRecent}
                />
              </View>
            }
            contentContainerStyle={[styles.listContent, { paddingBottom: getScreenBottomInset(insets.bottom, !!activeRntpTrack) }]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          />
        ) : (
          <SectionList
            sections={sections as any}
            keyExtractor={keyExtractor}
            renderSectionHeader={renderSectionHeader}
            renderItem={renderItem}
            stickySectionHeadersEnabled={false}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[styles.listContent, { paddingBottom: getScreenBottomInset(insets.bottom, !!activeRntpTrack) }]}
            keyboardShouldPersistTaps="handled"
            ListFooterComponent={
              ytLoading ? (
                <View>
                  {/* Show skeleton only if YouTube section data is empty */}
                  {(ytResults ?? []).length === 0 && (
                    <>
                      <SearchSectionHeader
                        title="Online"
                        badge="STREAMING"
                        badgeColor="#FA233B"
                      />
                      <YouTubeSkeleton />
                    </>
                  )}
                </View>
              ) : ytError ? (
                <View style={styles.searchMessage}>
                  <View style={styles.searchMessageIcon}>
                    <Ionicons name="wifi" size={24} color="#FA233B" />
                  </View>
                  <Text style={styles.searchMessageTitle}>Search is having trouble</Text>
                  <Text style={styles.searchMessageText}>
                    Check your connection and try again.
                  </Text>
                  <TouchableOpacity
                    onPress={() => void retryYouTubeSearch()}
                    style={styles.searchRetryButton}
                    activeOpacity={0.82}
                  >
                    <Text style={styles.searchRetryText}>Retry Search</Text>
                  </TouchableOpacity>
                </View>
              ) : isSearching && localResults.length === 0 && (ytResults ?? []).length === 0 ? (
                <View style={styles.searchMessage}>
                  <View style={styles.searchMessageIcon}>
                    <Ionicons name="search" size={24} color="#FA233B" />
                  </View>
                  <Text style={styles.searchMessageTitle}>No songs found</Text>
                  <Text style={styles.searchMessageText}>
                    Try a song title, artist name, or movie name.
                  </Text>
                </View>
              ) : null
            }
          />
        )}
      </KeyboardAvoidingView>

      {/* Quality picker overlay */}
      <QualitySheet
        visible={qualitySheetVisible}
        onSelect={handleQualitySelect}
        onDismiss={handleQualityDismiss}
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
  searchHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 16,
    gap: 10,
    backgroundColor: '#F5F5F7',
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    paddingHorizontal: 16,
    height: 50,
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(60,60,67,0.10)',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.06,
        shadowRadius: 14,
      },
      android: { elevation: 2 },
    }),
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: '#1D1D1F',
    fontWeight: '400',
  },
  cancelWrapper: {
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  cancelText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#FA233B',
  },
  content: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 100,
  },
  emptyState: {
    paddingTop: 8,
  },
  searchMessage: {
    marginHorizontal: 20,
    marginTop: 18,
    padding: 18,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(60,60,67,0.10)',
    alignItems: 'center',
  },
  searchMessageIcon: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(250,35,59,0.10)',
    marginBottom: 12,
  },
  searchMessageTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1D1D1F',
    letterSpacing: -0.2,
  },
  searchMessageText: {
    marginTop: 6,
    fontSize: 13,
    fontWeight: '500',
    color: '#8E8E93',
    textAlign: 'center',
  },
  searchRetryButton: {
    marginTop: 14,
    minHeight: 38,
    paddingHorizontal: 16,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FA233B',
  },
  searchRetryText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
  },
});
