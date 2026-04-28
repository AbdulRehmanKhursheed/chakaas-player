/**
 * NowPlayingScreen — Full-screen premium music player.
 *
 * Layout (top → bottom):
 *   1. Blurred album art full-screen background + soft gradient overlay
 *   2. Header  : dismiss chevron · "NOW PLAYING" · 3-dot menu
 *   3. Artwork : large rounded card, drop shadow, breathing scale when playing
 *   4. Track info : title + like heart · artist · album
 *   5. Progress slider (ProgressSlider)
 *   6. Player controls (PlayerControls)
 *   7. Volume slider (VolumeSlider)
 *   8. Bottom tab (Lyrics / Queue)
 *
 * Animation:
 *   - Artwork "breathing" scale pulses gently while playing
 *   - Accent colour extracted from artwork drives gradient + controls
 *   - Tab switch has a horizontal slide + fade transition
 */

import React, {
  useCallback,
  useEffect,
  useState,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
  ScrollView,
  Platform,
  StatusBar,
  Image,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withRepeat,
  withSequence,
  withTiming,
  interpolate,
  Extrapolation,
  cancelAnimation,
} from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { useActiveTrack, useProgress } from 'react-native-track-player';
import FastImage from 'react-native-fast-image';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';

import { usePlayer } from '@/features/player/usePlayer';
import { usePlayerStore } from '@/stores/playerStore';
import { useUIStore } from '@/stores/uiStore';
import { useAccentColor } from '@/hooks/useAccentColor';
import { usePlayerQueue } from '@/features/player/useQueue';
import type { RootStackNavigationProp } from '@/types/navigation';

import { PlayerControls } from './components/PlayerControls';
import { ProgressSlider } from './components/ProgressSlider';
import { LyricsPanel } from './components/LyricsPanel';
import { VolumeSlider } from './components/VolumeSlider';

// ─── Constants ───────────────────────────────────────────────────────────────

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const ARTWORK_SIZE = Math.min(SCREEN_WIDTH - 96, 300);
const SAFE_TOP = Platform.OS === 'ios' ? 54 : (StatusBar.currentHeight ?? 24) + 8;

const SPRING_GENTLE = { damping: 22, stiffness: 180, mass: 1 };
const SPRING_FAST = { damping: 18, stiffness: 260, mass: 0.6 };

type ActiveTab = 'lyrics' | 'queue';

// ─── Progress slider connected to RNTP ──────────────────────────────────────
// Isolated so the 500-ms `useProgress` re-renders stay scoped to the slider.
// Without this wrapper the entire NowPlayingScreen + PlayerControls would
// re-render every poll, causing button animation state to reset on each
// slider drag event.

interface ConnectedProgressSliderProps {
  onSeek: (position: number) => void;
  accentColor: string;
}

function ConnectedProgressSlider({ onSeek, accentColor }: ConnectedProgressSliderProps) {
  const progress = useProgress(500);
  const activeTrack = useActiveTrack();
  const metadataDuration =
    typeof activeTrack?.duration === 'number' && activeTrack.duration > 0
      ? activeTrack.duration
      : 0;
  const duration = progress.duration > 0 ? progress.duration : metadataDuration;

  return (
    <ProgressSlider
      duration={duration}
      position={progress.position}
      onSeek={onSeek}
      accentColor={accentColor}
    />
  );
}

interface ConnectedLyricsPanelProps {
  trackId: string;
  artist: string;
  title: string;
  album: string;
  accentColor: string;
}

function ConnectedLyricsPanel({
  trackId,
  artist,
  title,
  album,
  accentColor,
}: ConnectedLyricsPanelProps) {
  const progress = useProgress(500);
  const activeTrack = useActiveTrack();
  const metadataDurationMs =
    typeof activeTrack?.duration === 'number' && activeTrack.duration > 0
      ? activeTrack.duration * 1000
      : 0;
  const durationMs = progress.duration > 0
    ? progress.duration * 1000
    : metadataDurationMs;

  return (
    <LyricsPanel
      trackId={trackId}
      artist={artist}
      title={title}
      album={album}
      duration_ms={durationMs}
      currentPosition={progress.position}
      accentColor={accentColor}
    />
  );
}

// ─── Placeholder artwork ──────────────────────────────────────────────────────

function ArtworkPlaceholder({ size }: { size: number }) {
  return (
    <View style={[styles.artworkPlaceholder, { width: size, height: size, borderRadius: 16 }]}>
      <View style={styles.placeholderBadge}>
        <Ionicons name="musical-note" size={54} color="#FA233B" />
      </View>
      <Text style={styles.placeholderText}>Chakaas Player</Text>
    </View>
  );
}

// ─── Queue list ───────────────────────────────────────────────────────────────

function QueuePanel() {
  const { queue } = usePlayerQueue();

  if (!queue || queue.length === 0) {
    return (
      <View style={styles.queueEmpty}>
        <Text style={styles.queueEmptyText}>Queue is empty</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.queueScroll}
      contentContainerStyle={styles.queueContent}
      showsVerticalScrollIndicator={false}
    >
      {queue.map((track: any, index: number) => (
        <View key={`${track.id ?? index}`} style={styles.queueItem}>
          {track.artwork ? (
            <FastImage
              source={{ uri: track.artwork }}
              style={styles.queueArt}
            />
          ) : (
            <View style={[styles.queueArt, styles.queueArtPlaceholder]}>
              <Ionicons name="musical-note" size={16} color="#8E8E93" />
            </View>
          )}
          <View style={styles.queueInfo}>
            <Text style={styles.queueTitle} numberOfLines={1}>
              {track.title ?? 'Unknown Title'}
            </Text>
            <Text style={styles.queueArtist} numberOfLines={1}>
              {track.artist ?? 'Unknown Artist'}
            </Text>
          </View>
          <Text style={styles.queueIndex}>{index + 1}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export function NowPlayingScreen() {
  const navigation = useNavigation<RootStackNavigationProp<'NowPlaying'>>();

  const activeTrack = useActiveTrack();
  // NOTE: useProgress is intentionally NOT called at this level — see
  // <ConnectedProgressSlider /> below. Polling progress here would cause
  // the entire screen (and PlayerControls' button animations) to re-render
  // every 500 ms, producing the "buttons reload on slide" artefact.
  const {
    isPlaying,
    isLoading,
    togglePlayPause,
    skipToNext,
    skipToPrevious,
    seekTo,
    repeatMode,
    cycleRepeatMode,
  } = usePlayer();

  const shuffleEnabled = usePlayerStore((s) => s.shuffleEnabled);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);

  const artworkUri = activeTrack?.artwork ?? null;
  const { accentColor: extractedAccentColor } = useAccentColor(artworkUri);
  const accentColor = artworkUri ? extractedAccentColor : '#FA233B';

  const [activeTab, setActiveTab] = useState<ActiveTab>('lyrics');
  const tabOffset = useSharedValue(0);

  // ── Like state (local optimistic, wired to DB in a real impl) ─────────────
  const [liked, setLiked] = useState(false);
  const likeScale = useSharedValue(1);

  const handleLike = useCallback(() => {
    likeScale.value = withSequence(
      withSpring(1.4, SPRING_FAST),
      withSpring(1, SPRING_FAST),
    );
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLiked((v) => !v);
  }, []);

  const likeStyle = useAnimatedStyle(() => ({
    transform: [{ scale: likeScale.value }],
  }));

  // ── Artwork breathing animation ───────────────────────────────────────────
  const artworkScale = useSharedValue(1);

  useEffect(() => {
    if (isPlaying) {
      artworkScale.value = withRepeat(
        withSequence(
          withTiming(1.018, { duration: 2200 }),
          withTiming(1.0, { duration: 2200 }),
        ),
        -1,
        true,
      );
    } else {
      cancelAnimation(artworkScale);
      artworkScale.value = withSpring(1, SPRING_GENTLE);
    }
  }, [isPlaying]);

  const artworkAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: artworkScale.value }],
  }));

  // ── Tab switch ────────────────────────────────────────────────────────────
  const handleTabSwitch = useCallback((tab: ActiveTab) => {
    setActiveTab(tab);
    tabOffset.value = withSpring(tab === 'lyrics' ? 0 : 1, SPRING_GENTLE);
    Haptics.selectionAsync();
  }, []);

  const lyricsTabStyle = useAnimatedStyle(() => ({
    opacity: interpolate(tabOffset.value, [0, 1], [1, 0], Extrapolation.CLAMP),
    transform: [
      {
        translateX: interpolate(
          tabOffset.value,
          [0, 1],
          [0, -20],
          Extrapolation.CLAMP,
        ),
      },
    ],
    // Use `position: 'absolute'` to overlap tabs in the same space
    position: 'absolute',
    width: '100%',
  }));

  const queueTabStyle = useAnimatedStyle(() => ({
    opacity: interpolate(tabOffset.value, [0, 1], [0, 1], Extrapolation.CLAMP),
    transform: [
      {
        translateX: interpolate(
          tabOffset.value,
          [0, 1],
          [20, 0],
          Extrapolation.CLAMP,
        ),
      },
    ],
    position: 'absolute',
    width: '100%',
  }));

  // ── Dismiss ────────────────────────────────────────────────────────────────
  const handleDismiss = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    navigation.goBack();
  }, [navigation]);

  // ── Three-dot menu ─────────────────────────────────────────────────────────
  const openSheet = useUIStore((s) => s.openSheet);
  const handleMenu = useCallback(() => {
    if (!activeTrack?.id) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    openSheet('track-context', String(activeTrack.id));
  }, [activeTrack?.id, openSheet]);

  // ── Gradient colours derived from accent ──────────────────────────────────
  const gradientColors: [string, string, string] = [
    `${accentColor}12`,
    '#F5F5F7f7',
    '#F5F5F7',
  ];

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />

      {/* ── Blurred full-screen background ─────────────────────────────────── */}
      {artworkUri ? (
        <>
          <Image
            source={{ uri: artworkUri }}
            style={StyleSheet.absoluteFillObject}
            resizeMode="cover"
            blurRadius={Platform.OS === 'android' ? 18 : 0}
          />
          {Platform.OS === 'ios' && (
            <BlurView
              intensity={80}
              tint="light"
              style={StyleSheet.absoluteFillObject}
            />
          )}
        </>
      ) : (
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: '#F5F5F7' }]} />
      )}

      {/* Soft light gradient overlay */}
      <LinearGradient
        colors={gradientColors}
        locations={[0, 0.45, 1]}
        style={StyleSheet.absoluteFillObject}
      />

      {/* ── Content ─────────────────────────────────────────────────────────── */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        bounces={false}
        scrollEnabled={false}
      >
        {/* ── 1. Header ──────────────────────────────────────────────────── */}
        <View style={[styles.header, { paddingTop: SAFE_TOP }]}>
          <TouchableOpacity
            onPress={handleDismiss}
            style={styles.headerButton}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="chevron-down" size={26} color="#1D1D1F" />
          </TouchableOpacity>

          <View style={styles.headerCenter}>
            <Text style={styles.headerOverline}>Now Playing</Text>
            {activeTrack?.album ? (
              <Text style={styles.headerAlbum} numberOfLines={1}>
                {activeTrack.album}
              </Text>
            ) : null}
          </View>

          <TouchableOpacity
            onPress={handleMenu}
            style={styles.headerButton}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="ellipsis-horizontal" size={25} color="#1D1D1F" />
          </TouchableOpacity>
        </View>

        {/* ── 2. Artwork ─────────────────────────────────────────────────── */}
        <View style={styles.artworkWrapper}>
          <Animated.View style={[styles.artworkShadow, artworkAnimStyle]}>
            {artworkUri ? (
              <FastImage
                source={{ uri: artworkUri, priority: FastImage.priority.high }}
                style={styles.artwork}
                resizeMode={FastImage.resizeMode.cover}
              />
            ) : (
              <ArtworkPlaceholder size={ARTWORK_SIZE} />
            )}
          </Animated.View>
        </View>

        {/* ── 3. Track info ──────────────────────────────────────────────── */}
        <View style={styles.trackInfo}>
          <View style={styles.titleRow}>
            <Text style={styles.trackTitle} numberOfLines={1} adjustsFontSizeToFit>
              {activeTrack?.title ?? 'Not Playing'}
            </Text>
            <TouchableOpacity onPress={handleLike} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Animated.View style={[styles.likeButton, likeStyle]}>
                <Ionicons
                  name={liked ? 'heart' : 'heart-outline'}
                  size={28}
                  color={liked ? '#FA233B' : '#8E8E93'}
                />
              </Animated.View>
            </TouchableOpacity>
          </View>

          <Text style={styles.trackArtist} numberOfLines={1}>
            {activeTrack?.artist ?? '—'}
          </Text>
        </View>

        {/* ── 4. Progress slider ─────────────────────────────────────────── */}
        <View style={styles.progressWrapper}>
          <ConnectedProgressSlider onSeek={seekTo} accentColor={accentColor} />
        </View>

        {/* ── 5. Controls ─────────────────────────────────────────────────── */}
        <View style={styles.controlsWrapper}>
          <PlayerControls
            isPlaying={isPlaying}
            isLoading={isLoading}
            onPlayPause={togglePlayPause}
            onPrevious={skipToPrevious}
            onNext={skipToNext}
            repeatMode={repeatMode}
            onRepeat={cycleRepeatMode}
            shuffleEnabled={shuffleEnabled}
            onShuffle={toggleShuffle}
            accentColor={accentColor}
          />
        </View>

        {/* ── 6. Volume ───────────────────────────────────────────────────── */}
        <View style={styles.volumeWrapper}>
          <VolumeSlider accentColor={accentColor} />
        </View>

        {/* ── 7. Bottom tabs ──────────────────────────────────────────────── */}
        <View style={styles.tabBar}>
          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'lyrics' && styles.tabButtonActive]}
            onPress={() => handleTabSwitch('lyrics')}
          >
            <Text
              style={[
                styles.tabLabel,
                activeTab === 'lyrics' && { color: accentColor },
              ]}
            >
              Lyrics
            </Text>
            {activeTab === 'lyrics' && (
              <View style={[styles.tabIndicator, { backgroundColor: accentColor }]} />
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'queue' && styles.tabButtonActive]}
            onPress={() => handleTabSwitch('queue')}
          >
            <Text
              style={[
                styles.tabLabel,
                activeTab === 'queue' && { color: accentColor },
              ]}
            >
              Queue
            </Text>
            {activeTab === 'queue' && (
              <View style={[styles.tabIndicator, { backgroundColor: accentColor }]} />
            )}
          </TouchableOpacity>
        </View>

        {/* ── 8. Tab content ─────────────────────────────────────────────── */}
        <View style={styles.tabContent} pointerEvents="box-none">
          {/* Lyrics panel */}
          <Animated.View style={lyricsTabStyle} pointerEvents={activeTab === 'lyrics' ? 'auto' : 'none'}>
            {activeTrack ? (
              <ConnectedLyricsPanel
                trackId={activeTrack.id ?? ''}
                artist={activeTrack.artist ?? ''}
                title={activeTrack.title ?? ''}
                album={activeTrack.album ?? ''}
                accentColor={accentColor}
              />
            ) : (
              <View style={styles.tabEmpty}>
                <Text style={styles.tabEmptyText}>No track loaded</Text>
              </View>
            )}
          </Animated.View>

          {/* Queue panel */}
          <Animated.View style={queueTabStyle} pointerEvents={activeTab === 'queue' ? 'auto' : 'none'}>
            <QueuePanel />
          </Animated.View>
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F5F5F7',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },

  // ── Header ────────────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 6,
  },
  headerButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerOverline: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: -0.1,
    color: '#1D1D1F',
  },
  headerAlbum: {
    fontSize: 11,
    color: '#6E6E73',
    marginTop: 1,
    maxWidth: 180,
    textAlign: 'center',
  },
  // ── Artwork ───────────────────────────────────────────────────────────────
  artworkWrapper: {
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingTop: 8,
    paddingBottom: 22,
  },
  artworkShadow: {
    borderRadius: 22,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 16 },
        shadowOpacity: 0.22,
        shadowRadius: 30,
      },
      android: { elevation: 24 },
    }),
  },
  artwork: {
    width: ARTWORK_SIZE,
    height: ARTWORK_SIZE,
    borderRadius: 22,
  },
  artworkPlaceholder: {
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(60,60,67,0.12)',
    gap: 14,
  },
  placeholderBadge: {
    width: 112,
    height: 112,
    borderRadius: 56,
    backgroundColor: 'rgba(250,35,59,0.10)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#8E8E93',
    letterSpacing: -0.1,
  },

  // ── Track info ─────────────────────────────────────────────────────────────
  trackInfo: {
    paddingHorizontal: 30,
    gap: 6,
    marginBottom: 18,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  trackTitle: {
    flex: 1,
    fontSize: 22,
    fontWeight: '800',
    color: '#1D1D1F',
    letterSpacing: -0.7,
  },
  likeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trackArtist: {
    fontSize: 16,
    fontWeight: '600',
    color: '#6E6E73',
  },

  // ── Progress ──────────────────────────────────────────────────────────────
  progressWrapper: {
    paddingHorizontal: 32,
    marginBottom: 18,
  },

  // ── Controls ──────────────────────────────────────────────────────────────
  controlsWrapper: {
    paddingHorizontal: 28,
    marginBottom: 22,
  },

  // ── Volume ────────────────────────────────────────────────────────────────
  volumeWrapper: {
    paddingHorizontal: 34,
    marginBottom: 22,
  },

  // ── Tabs ──────────────────────────────────────────────────────────────────
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: 32,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(60,60,67,0.14)',
    marginBottom: 0,
  },
  tabButton: {
    paddingVertical: 10,
    marginRight: 28,
    position: 'relative',
  },
  tabButtonActive: {},
  tabLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#8E8E93',
    letterSpacing: 0.2,
  },
  tabIndicator: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 2,
    borderRadius: 1,
  },
  tabContent: {
    minHeight: SCREEN_HEIGHT * 0.38,
    position: 'relative',
  },

  // ── Tab empty states ──────────────────────────────────────────────────────
  tabEmpty: {
    height: 120,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabEmptyText: {
    fontSize: 14,
    color: '#8E8E93',
  },

  // ── Queue panel ───────────────────────────────────────────────────────────
  queueScroll: {
    maxHeight: SCREEN_HEIGHT * 0.38,
  },
  queueContent: {
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  queueEmpty: {
    height: 120,
    justifyContent: 'center',
    alignItems: 'center',
  },
  queueEmptyText: {
    fontSize: 14,
    color: '#8E8E93',
  },
  queueItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(60,60,67,0.10)',
  },
  queueArt: {
    width: 44,
    height: 44,
    borderRadius: 6,
  },
  queueArtPlaceholder: {
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  queueInfo: {
    flex: 1,
    gap: 3,
  },
  queueTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: '#1D1D1F',
  },
  queueArtist: {
    fontSize: 12,
    color: '#6E6E73',
  },
  queueIndex: {
    fontSize: 13,
    color: '#8E8E93',
    fontWeight: '500',
    minWidth: 20,
    textAlign: 'right',
  },
});
