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
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, type Theme } from '@/theme';
import { useActiveTrack } from 'react-native-track-player';
import { useSafeTracks } from '@/hooks/useSafeTracks';
import { useDebounce } from '@/hooks/useDebounce';
import { usePlayerQueue } from '@/features/player/useQueue';
import { useDownloadStore } from '@/stores/downloadStore';
import { DownloadManager } from '@/features/download/DownloadManager';
import { resolveAudioStream } from '@/features/download/MultiSourceResolver';
import { searchMusic } from '@/features/download/searchMusic';
import { getScreenBottomInset } from '@/utils/layout';
import { settingsStorage } from '@/stores/settingsStore';
import { TrackArtwork } from '@/components/track/TrackArtwork';
import { YoutubeResultCard } from './components/YoutubeResultCard';
import { SwipeableTrackRow } from '@/components/ui/SwipeableTrackRow';
import { TrackRowSkeleton } from '@/components/ui/SkeletonShimmer';
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
  } catch (err) {
    console.warn('[SearchScreen] saveRecentSearch failed', err);
  }
}

function removeRecentSearch(query: string) {
  try {
    const updated = loadRecentSearches().filter((s) => s !== query);
    settingsStorage.set(RECENT_SEARCHES_KEY, JSON.stringify(updated));
  } catch (err) {
    console.warn('[SearchScreen] removeRecentSearch failed', err);
  }
}

/**
 * Normalize a title/artist string so trivial parenthetical and punctuation
 * variations don't break the library-fingerprint match. Keeps Latin
 * (a–z, 0–9) and the Devanagari block so Hindi titles match too.
 */
function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s*\((?:from|feat\.?|featuring|with|ft\.?)[^)]*\)\s*/gi, ' ')
    .replace(/\s*\[(?:from|feat\.?|featuring|with|ft\.?)[^\]]*\]\s*/gi, ' ')
    .replace(/[^a-z0-9ऀ-ॿ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Quality picking lives in Settings; the Saavn/YouTube providers always
// resolve to the best available stream (320 kbps when offered, 160 kbps
// fallback). No per-download chooser — it was a noisy three-tap detour
// where every option did the same thing.

// ─── YouTube skeleton ──────────────────────────────────────────────────────────

function YouTubeSkeleton() {
  return (
    <View style={skeletonStyles.container}>
      {[0, 1, 2, 3].map((i) => (
        <TrackRowSkeleton key={i} />
      ))}
    </View>
  );
}

// The actual skeleton rows are rendered by `TrackRowSkeleton` (light-theme
// shimmer). All we need locally is the spacing wrapper — the old dark-theme
// `row/thumb/lineN/button` rules were unused leftovers and just confused
// anyone reading the file.
const skeletonStyles = StyleSheet.create({
  container: { paddingHorizontal: 20, gap: 16, paddingTop: 4 },
});

// ─── Local track row ──────────────────────────────────────────────────────────

interface LocalTrackRowProps {
  track: Track;
  onPress: (track: Track) => void;
  onSwipeQueue: (track: Track) => void;
}

function LocalTrackRow({ track, onPress, onSwipeQueue }: LocalTrackRowProps) {
  const { colors } = useTheme();
  const handlePress = useCallback(() => onPress(track), [track, onPress]);
  const handleSwipeQueue = useCallback(() => onSwipeQueue(track), [track, onSwipeQueue]);

  return (
    <SwipeableTrackRow onSwipeQueue={handleSwipeQueue}>
      <TouchableOpacity
        activeOpacity={0.78}
        onPress={handlePress}
        style={[localRowStyles.container, { backgroundColor: colors.bg }]}
      >
        <View style={localRowStyles.artworkWrapper}>
          <TrackArtwork uri={track.artworkPath} blurhash={null} size={50} borderRadius={12} />
          <View
            style={[
              localRowStyles.downloadedBadge,
              { backgroundColor: colors.accent, borderColor: colors.bg },
            ]}
          >
            <Ionicons name="checkmark" size={10} color="#07090D" />
          </View>
        </View>

        <View style={localRowStyles.meta}>
          <View style={localRowStyles.titleRow}>
            <Text style={[localRowStyles.title, { color: colors.textPrimary }]} numberOfLines={1}>
              {track.title}
            </Text>
          </View>
          <Text style={[localRowStyles.artist, { color: colors.textSecondary }]} numberOfLines={1}>
            {track.artist}
            {track.durationMs > 0 ? ` · ${formatDuration(track.durationMs)}` : ''}
          </Text>
        </View>

        {/* Cyan local indicator dot */}
        <View style={[localRowStyles.localDot, { backgroundColor: colors.accent }]} />
      </TouchableOpacity>
    </SwipeableTrackRow>
  );
}

const localRowStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 9,
    gap: 12,
    // Opaque background prevents the underlying swipe-action pills from
    // bleeding through visually at rest.
  },
  artworkWrapper: {
    position: 'relative',
    flexShrink: 0,
  },
  downloadedBadge: {
    position: 'absolute',
    bottom: -3,
    left: -3,
    borderRadius: 8,
    width: 16,
    height: 16,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
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
  },
  artist: {
    fontSize: 12,
    marginTop: 2,
  },
  localDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
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
  const { colors } = useTheme();
  return (
    <View style={[sectionHeaderStyles.container, { backgroundColor: colors.bg }]}>
      <Text style={[sectionHeaderStyles.title, { color: colors.textPrimary }]}>{title}</Text>
      <View
        style={[
          sectionHeaderStyles.badge,
          { backgroundColor: tintColor(badgeColor), borderColor: badgeColor },
        ]}
      >
        <Text style={[sectionHeaderStyles.badgeText, { color: badgeColor }]}>{badge}</Text>
      </View>
    </View>
  );
}

// Translucent fill for the HUD badge pill so the section badge reads as a
// glowing hairline-outlined tag rather than a solid block.
function tintColor(hex: string): string {
  // Accept the cyan accent / gold tokens the badges use and return a soft
  // 16%-alpha tint of the same hue.
  if (hex === '#19E3FF' || hex === '#0AB4D6') return 'rgba(25,227,255,0.16)';
  if (hex === '#F5B642' || hex === '#C8860A') return 'rgba(245,182,66,0.16)';
  return 'rgba(25,227,255,0.16)';
}

const sectionHeaderStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 10,
    gap: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
});

// ─── Genre grid (empty state) ─────────────────────────────────────────────────

interface GenreGridProps {
  onSelect: (query: string) => void;
}

function GenreGrid({ onSelect }: GenreGridProps) {
  const { colors } = useTheme();
  const ITEM_WIDTH = (SCREEN_WIDTH - 52) / 2;

  return (
    <View style={genreGridStyles.container}>
      <Text style={[genreGridStyles.heading, { color: colors.textPrimary }]}>Explore Genres</Text>
      <View style={genreGridStyles.grid}>
        {BOLLYWOOD_GENRES.map((g) => (
          <TouchableOpacity
            key={g.label}
            onPress={() => onSelect(g.query)}
            style={[
              genreGridStyles.card,
              { width: ITEM_WIDTH, backgroundColor: colors.bgElevated, borderColor: colors.borderAccent },
            ]}
            activeOpacity={0.8}
          >
            <View style={[genreGridStyles.iconWrap, { backgroundColor: colors.accentMuted }]}>
              <Ionicons name={g.icon} size={20} color={colors.accent} />
            </View>
            <Text style={[genreGridStyles.label, { color: colors.textPrimary }]}>{g.label}</Text>
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
    marginBottom: 14,
    letterSpacing: -0.3,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  card: {
    height: 78,
    // Dark elevated tile with a cyan HUD hairline. Soft elevation only.
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    gap: 12,
  },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    flexShrink: 1,
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
  const { colors } = useTheme();
  if (searches.length === 0) return null;

  return (
    <View style={recentStyles.container}>
      <View style={recentStyles.header}>
        <Text style={[recentStyles.heading, { color: colors.textPrimary }]}>Recent Searches</Text>
        <TouchableOpacity onPress={onClearAll}>
          <Text style={[recentStyles.clearAll, { color: colors.accent }]}>Clear All</Text>
        </TouchableOpacity>
      </View>
      {searches.map((s) => (
        <View key={s} style={[recentStyles.row, { borderBottomColor: colors.border }]}>
          <TouchableOpacity
            style={recentStyles.rowMain}
            onPress={() => onSelect(s)}
            activeOpacity={0.75}
          >
            <Ionicons name="time-outline" size={17} color={colors.textTertiary} />
            <Text style={[recentStyles.text, { color: colors.textSecondary }]} numberOfLines={1}>
              {s}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => onRemove(s)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="close" size={14} color={colors.textTertiary} />
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
    letterSpacing: -0.3,
  },
  clearAll: {
    fontSize: 13,
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    // Cyan-neutral hairline divider so consecutive recents read as distinct
    // rows on the dark canvas.
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
    flex: 1,
  },
});

// ─── YouTube result with library check ───────────────────────────────────────

interface YtResultRowProps {
  result: YouTubeSearchResult;
  isInLibrary: boolean;
  downloadProgress: number | undefined;
  isStreamLoading: boolean;
  onDownload: (id: string, title: string, artist: string, thumbnail: string) => void;
  onStream: (result: YouTubeSearchResult) => void;
}

function YtResultRow({
  result,
  isInLibrary,
  downloadProgress,
  isStreamLoading,
  onDownload,
  onStream,
}: YtResultRowProps) {
  // If already in library we display a status badge instead of a download button.
  // We do this by passing a fake 100 progress to YoutubeResultCard when isInLibrary
  return (
    <YoutubeResultCard
      result={result}
      onDownload={onDownload}
      onStream={onStream}
      isStreamLoading={isStreamLoading}
      downloadProgress={isInLibrary ? 100 : downloadProgress}
    />
  );
}

// ─── Section list types ───────────────────────────────────────────────────────

type LocalSection = {
  title: 'In Your Library';
  badge: 'LOCAL';
  // Hex string resolved from the active theme (cyan accent for LOCAL).
  badgeColor: string;
  data: Track[];
  sectionType: 'local';
};

type YouTubeSection = {
  title: 'Online';
  badge: 'STREAMING';
  // Hex string resolved from the active theme (gold for STREAMING).
  badgeColor: string;
  data: YouTubeSearchResult[];
  sectionType: 'youtube';
};

type SearchSection = LocalSection | YouTubeSection;

// ─── Main screen ──────────────────────────────────────────────────────────────

export function SearchScreen() {
  const navigation = useNavigation<RootStackNavigationProp>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { playTrack, addTrack, streamTrack } = usePlayerQueue();
  const activeRntpTrack = useActiveTrack();
  const downloadQueue = useDownloadStore((s) => s.queue);

  // `safeTracks` is the filtered library — non-music junk (WhatsApp voices,
  // ringtones, status-music clips) is stripped before it ever feeds the Fuse
  // index or the in-library fingerprint set used by `isInLibrary`. Without
  // this, junk rows could show up under "In Your Library" or block a real
  // Saavn match because their parsed title accidentally collided.
  const safeTracks = useSafeTracks();
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 420);
  const inputRef = useRef<TextInput>(null);

  const [recentSearches, setRecentSearches] = useState<string[]>(() => loadRecentSearches());

  // Per-result spinner state for the "stream now" button. Holds the result
  // id whose URL is currently being resolved. Resolver round-trips can take
  // 1-3s — without this the play button looks unresponsive after tap.
  const [streamingResultId, setStreamingResultId] = useState<string | null>(null);

  // Animated search bar width (expands when focused)
  const cancelOpacity = useSharedValue(0);

  // Visual-only: drive the cyan HUD focus ring on the glass search field.
  const [isSearchFocused, setIsSearchFocused] = useState(false);

  const handleSearchFocus = useCallback(() => {
    setIsSearchFocused(true);
    cancelOpacity.value = withTiming(1, { duration: 180 });
  }, []);

  const handleSearchBlur = useCallback(() => {
    setIsSearchFocused(false);
    if (query.length === 0) {
      cancelOpacity.value = withTiming(0, { duration: 180 });
    }
  }, [query]);

  // Animate transform + opacity (cheap, no layout thrash) — animating
  // `width` per frame was forcing a full layout pass on the JS thread.
  const cancelStyle = useAnimatedStyle(() => ({
    opacity: cancelOpacity.value,
    transform: [{ translateX: (1 - cancelOpacity.value) * 60 }],
  }));

  // Auto-focus on mount
  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 200);
    return () => clearTimeout(timer);
  }, []);

  // ── Fuse.js local search ──

  const fuse = useMemo(
    () =>
      new Fuse(safeTracks, {
        keys: [
          { name: 'title', weight: 0.6 },
          { name: 'artist', weight: 0.3 },
          { name: 'album', weight: 0.1 },
        ],
        threshold: 0.35,
        includeScore: true,
      }),
    [safeTracks],
  );

  const localResults = useMemo((): Track[] => {
    if (!debouncedQuery.trim()) return [];
    return fuse.search(debouncedQuery).map((r) => r.item).slice(0, 30);
  }, [fuse, debouncedQuery]);

  // ── YouTube search ──

  const {
    data: ytResults,
    isFetching: ytLoading,
    isError: ytError,
    refetch: retryYouTubeSearch,
  } = useQuery({
    queryKey: ['music-search', debouncedQuery],
    // Thread React Query's AbortSignal so a rapidly-typing user doesn't
    // pay for stale results — searchMusic checks `signal.aborted` between
    // its Saavn + YouTube sub-calls.
    queryFn: async ({ signal }) => searchMusic(debouncedQuery, 15, { signal }),
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

  // Library lookup: build a set of "title|||artist" for fast matching plus
  // a parallel set of provider ids (saavn / youtube) so a Saavn result
  // matches the library row even when the artist string drifted (Saavn
  // sometimes returns "Arijit Singh, Shilpa Rao" while the downloaded copy
  // has just "Arijit Singh", which breaks a pure title|||artist match).
  const libraryFingerprints = useMemo(() => {
    const titles = new Set<string>();
    const saavnIds = new Set<string>();
    const youtubeIds = new Set<string>();
    for (const t of safeTracks) {
      titles.add(`${normalizeForMatch(t.title)}|||${normalizeForMatch(t.artist)}`);
      if (t.saavnId) saavnIds.add(t.saavnId);
      if (t.youtubeId) youtubeIds.add(t.youtubeId);
    }
    return { titles, saavnIds, youtubeIds };
  }, [safeTracks]);

  const isInLibrary = useCallback(
    (result: YouTubeSearchResult): boolean => {
      // Cheap id check first — if we have a previously-downloaded copy of
      // the same Saavn/YT id, that's a definitive match regardless of how
      // the title/artist may have drifted.
      if (result.provider === 'saavn' && libraryFingerprints.saavnIds.has(result.id)) {
        return true;
      }
      if (
        (result.provider === 'youtube' || !result.provider) &&
        libraryFingerprints.youtubeIds.has(result.id)
      ) {
        return true;
      }
      const fullKey = `${normalizeForMatch(result.title)}|||${normalizeForMatch(result.author)}`;
      if (libraryFingerprints.titles.has(fullKey)) return true;
      const dashIdx = result.title.indexOf(' - ');
      if (dashIdx > 0) {
        const artist = result.title.substring(0, dashIdx).trim();
        const title = result.title.substring(dashIdx + 3).trim();
        return libraryFingerprints.titles.has(
          `${normalizeForMatch(title)}|||${normalizeForMatch(artist)}`,
        );
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
    // Confirm before wiping — the old no-prompt flow was an easy mis-tap and
    // there's no undo. Cancel keeps the existing list intact.
    Alert.alert(
      'Clear all recent searches?',
      'This will remove every recent search. You can’t undo this.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: () => {
            settingsStorage.set(RECENT_SEARCHES_KEY, '[]');
            setRecentSearches([]);
          },
        },
      ],
    );
  }, []);

  const handleLocalTrackPress = useCallback(
    (track: Track) => {
      void playTrack(modelToTrack(track), modelsToTracks(safeTracks));
      navigation.navigate('NowPlaying');
    },
    [playTrack, safeTracks, navigation],
  );

  // Left-swipe on a library row inside Search: drop the track into the
  // upcoming queue without interrupting playback.
  const handleSwipeQueue = useCallback(
    (track: Track) => {
      void addTrack(modelToTrack(track));
    },
    [addTrack],
  );

  const handleSubmitEditing = useCallback(() => {
    if (query.trim()) {
      // Subtle confirmation tap when the user commits a search query.
      void Haptics.selectionAsync();
      saveRecentSearch(query.trim());
      setRecentSearches(loadRecentSearches());
    }
  }, [query]);

  /**
   * Resolve a stream URL via the multi-source resolver and hand it to RNTP
   * as a transient (non-persisted) track. No download, no DB row — the
   * track lives only in the RNTP queue for as long as it's playing.
   */
  const handleStreamRequest = useCallback(
    (target: YouTubeSearchResult) => {
      if (streamingResultId) return; // prevent double-tap stampede
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setStreamingResultId(target.id);
      void (async () => {
        try {
          const provider = target.provider ?? 'youtube';
          const album =
            provider === 'saavn'
              ? target.saavnAlbum ?? 'JioSaavn'
              : 'YouTube';
          const stream = await resolveAudioStream({
            query: `${target.title} ${target.author}`,
            hints: {
              youtubeId: provider === 'youtube' ? target.id : undefined,
              saavnId: provider === 'saavn' ? target.id : undefined,
              saavnEncryptedUrl: target.saavnEncryptedUrl,
              saavnHas320kbps: target.saavnHas320kbps,
            },
          });
          await streamTrack({
            id: target.id,
            title: target.title,
            artist: target.author,
            album,
            artwork: target.thumbnail,
            url: stream.url,
            durationMs: stream.durationMs ?? target.duration_ms,
            requestHeaders: stream.requestHeaders,
          });
          navigation.navigate('NowPlaying');
        } catch (err) {
          console.warn('[SearchScreen] stream failed', err);
          Alert.alert('Could not stream this song', 'Try a different result, or download it instead.');
        } finally {
          setStreamingResultId(null);
        }
      })();
    },
    [streamingResultId, streamTrack, navigation],
  );

  const handleDownloadRequest = useCallback(
    (id: string, _title: string, _artist: string, _thumbnail: string) => {
      const target = (ytResults ?? []).find((r) => r.id === id);
      if (!target) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      void (async () => {
        try {
          const provider = target.provider ?? 'youtube';
          const album =
            provider === 'saavn'
              ? target.saavnAlbum ?? 'JioSaavn'
              : 'YouTube';
          const result = await DownloadManager.enqueue({
            youtubeId: target.id,
            title: target.title,
            artist: target.author,
            album,
            thumbnail: target.thumbnail,
            durationMs: target.duration_ms,
            provider,
            saavnEncryptedUrl: target.saavnEncryptedUrl,
            saavnHas320kbps: target.saavnHas320kbps,
          });
          if (!result.success) {
            Alert.alert(
              'Cannot start download',
              result.reason ?? 'Please try again.',
            );
          }
        } catch {
          Alert.alert('Download error', 'Could not start download. Please try again.');
        }
      })();
    },
    [ytResults],
  );

  // ── Section list data ──

  const isSearching = debouncedQuery.trim().length >= 2;

  const sections = useMemo((): SearchSection[] => {
    if (!isSearching) return [];
    const result: SearchSection[] = [];
    if (localResults.length > 0) {
      result.push({
        title: 'In Your Library',
        badge: 'LOCAL',
        badgeColor: colors.accent,
        data: localResults,
        sectionType: 'local',
      });
    }
    // Only render the Online section header when there are zero local
    // results (so the user still sees a header while online is loading)
    // OR when we actually have online results to show. Skip it otherwise
    // so we don't paint an empty "Online" header next to local hits.
    const ytData = ytResults ?? [];
    if (localResults.length === 0 || ytData.length > 0) {
      result.push({
        title: 'Online',
        badge: 'STREAMING',
        badgeColor: colors.gold,
        data: ytData,
        sectionType: 'youtube',
      });
    }
    return result;
  }, [isSearching, localResults, ytResults, colors]);

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
            onSwipeQueue={handleSwipeQueue}
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
          isStreamLoading={streamingResultId === ytItem.id}
          onDownload={handleDownloadRequest}
          onStream={handleStreamRequest}
        />
      );
    },
    [
      handleLocalTrackPress,
      handleSwipeQueue,
      isInLibrary,
      progressMap,
      streamingResultId,
      handleDownloadRequest,
      handleStreamRequest,
    ],
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
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor={colors.bg}
      />

      {/* ── Search header (dark glass) ── */}
      <View style={[styles.searchHeader, { paddingTop: insets.top + 12 }]}>
        <BlurView
          intensity={40}
          tint={isDark ? 'dark' : 'light'}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <View
          style={[
            styles.searchBar,
            isSearchFocused && {
              borderColor: colors.accent,
              shadowColor: colors.accent,
              shadowOpacity: 0.4,
            },
          ]}
        >
          <Ionicons
            name="search"
            size={18}
            color={isSearchFocused ? colors.accent : colors.textTertiary}
          />
          <TextInput
            ref={inputRef}
            style={styles.searchInput}
            value={query}
            onChangeText={handleQueryChange}
            onSubmitEditing={handleSubmitEditing}
            onFocus={handleSearchFocus}
            onBlur={handleSearchBlur}
            placeholder="Songs, artists, YouTube…"
            placeholderTextColor={colors.textTertiary}
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
          />
          {query.length > 0 && (
            <TouchableOpacity
              onPress={handleClearQuery}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close-circle" size={18} color={colors.textTertiary} />
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
            stickySectionHeadersEnabled={true}
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
                        badgeColor={colors.gold}
                      />
                      <YouTubeSkeleton />
                    </>
                  )}
                </View>
              ) : ytError ? (
                <View style={styles.searchMessage}>
                  <View style={[styles.searchMessageIcon, { backgroundColor: colors.goldMuted }]}>
                    <Ionicons name="wifi" size={24} color={colors.danger} />
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
                    <LinearGradient
                      colors={colors.brandGradient}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={StyleSheet.absoluteFill}
                    />
                    <Text style={styles.searchRetryText}>Retry Search</Text>
                  </TouchableOpacity>
                </View>
              ) : isSearching && localResults.length === 0 && (ytResults ?? []).length === 0 ? (
                <View style={styles.searchMessage}>
                  <View style={styles.searchMessageIcon}>
                    <Ionicons name="search" size={24} color={colors.accent} />
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

    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const createStyles = (colors: Theme['colors']) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.bg,
    },
    searchHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingBottom: 16,
      gap: 10,
      // Transparent so the BlurView absolute fill behind it shows through;
      // a cyan HUD hairline sits at the bottom edge.
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.borderAccent,
    },
    searchBar: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.bgRaised,
      borderRadius: 16,
      paddingHorizontal: 16,
      height: 50,
      gap: 8,
      borderWidth: 1,
      borderColor: colors.border,
      // Cyan focus glow toggled inline via shadowOpacity on focus.
      shadowColor: colors.accent,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0,
      shadowRadius: 10,
    },
    searchInput: {
      flex: 1,
      fontSize: 16,
      color: colors.textPrimary,
      fontWeight: '500',
      paddingVertical: 0,
    },
    cancelWrapper: {
      overflow: 'hidden',
      justifyContent: 'center',
      alignItems: 'flex-end',
      width: 60,
    },
    cancelText: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.accent,
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
      borderRadius: 20,
      backgroundColor: colors.bgElevated,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderAccent,
      alignItems: 'center',
    },
    searchMessageIcon: {
      width: 52,
      height: 52,
      borderRadius: 26,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accentMuted,
      marginBottom: 12,
    },
    searchMessageTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.textPrimary,
      letterSpacing: -0.2,
    },
    searchMessageText: {
      marginTop: 6,
      fontSize: 13,
      fontWeight: '500',
      color: colors.textSecondary,
      textAlign: 'center',
    },
    searchRetryButton: {
      marginTop: 14,
      minHeight: 40,
      paddingHorizontal: 18,
      borderRadius: 999,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    searchRetryText: {
      fontSize: 13,
      fontWeight: '800',
      color: '#07090D',
    },
  });
