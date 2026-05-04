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
import { tracksCollection } from '@/db';
import { logger } from '@/utils/logger';
import { EqualizerBars } from '@/components/EqualizerBars';
import type { RootStackNavigationProp } from '@/types/navigation';

import { PlayerControls } from './components/PlayerControls';
import { ProgressSlider } from './components/ProgressSlider';
import { VolumeSlider } from './components/VolumeSlider';

// ─── Constants ───────────────────────────────────────────────────────────────

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const ARTWORK_SIZE = Math.min(SCREEN_WIDTH - 96, 300);
const SAFE_TOP = Platform.OS === 'ios' ? 54 : (StatusBar.currentHeight ?? 24) + 8;

const SPRING_GENTLE = { damping: 22, stiffness: 180, mass: 1 };
const SPRING_FAST = { damping: 18, stiffness: 260, mass: 0.6 };

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
  // Poll at 250 ms so the bar moves smoothly. Only this leaf component
  // re-renders on each tick — the parent NowPlayingScreen and PlayerControls
  // are isolated from progress updates by living above this connector.
  const progress = useProgress(250);
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

// ─── Placeholder artwork ──────────────────────────────────────────────────────
// Clean gradient + initials, no app branding. Premium players (Spotify,
// Apple Music, Tidal) all show *something* derived from the song itself
// rather than the app's logo when artwork is missing.

const PLACEHOLDER_GRADIENT_PAIRS: Array<[string, string]> = [
  ['#FA233B', '#FF7D8A'],
  ['#1D1D1F', '#3A3A3C'],
  ['#5856D6', '#AF52DE'],
  ['#FF9500', '#FFCC00'],
  ['#34C759', '#30B0C7'],
  ['#FF2D55', '#FF9500'],
];

function pickGradient(seed: string): [string, string] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = seed.charCodeAt(i) + ((h << 5) - h);
  }
  return PLACEHOLDER_GRADIENT_PAIRS[Math.abs(h) % PLACEHOLDER_GRADIENT_PAIRS.length];
}

function getInitial(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '♪';
  return trimmed.charAt(0).toUpperCase();
}

interface ArtworkPlaceholderProps {
  size: number;
  seed: string;
  isPlaying: boolean;
}

function ArtworkPlaceholder({ size, seed, isPlaying }: ArtworkPlaceholderProps) {
  const [start, end] = pickGradient(seed);
  return (
    <LinearGradient
      colors={[start, end]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.artworkPlaceholder, { width: size, height: size, borderRadius: 16 }]}
    >
      <Text style={[styles.placeholderInitial, { fontSize: size * 0.42 }]}>
        {getInitial(seed)}
      </Text>
      <EqualizerBars
        playing={isPlaying}
        count={5}
        barWidth={size * 0.045}
        gap={size * 0.035}
        height={size * 0.22}
        color="rgba(255,255,255,0.85)"
        style={{ marginTop: size * 0.06 }}
      />
    </LinearGradient>
  );
}

// ─── Queue list ───────────────────────────────────────────────────────────────

interface QueuePanelProps {
  activeTrackId: string | null;
  accentColor: string;
  isPlaying: boolean;
}

function QueuePanel({ activeTrackId, accentColor, isPlaying }: QueuePanelProps) {
  const { queue } = usePlayerQueue();

  if (!queue || queue.length === 0) {
    return (
      <View style={styles.queueEmpty}>
        <Text style={styles.queueEmptyText}>Queue is empty</Text>
      </View>
    );
  }

  // Render as plain Views — the outer ScrollView handles scrolling so the
  // queue can extend past the visible area and the user reaches it by
  // scrolling up.
  return (
    <View style={styles.queueContent}>
      {queue.map((track: any, index: number) => {
        const isActive =
          activeTrackId != null && String(track.id ?? '') === activeTrackId;
        return (
          <View
            key={`${track.id ?? index}`}
            style={[
              styles.queueItem,
              isActive && {
                backgroundColor: `${accentColor}14`,
                borderRadius: 10,
                paddingHorizontal: 8,
                marginHorizontal: -8,
              },
            ]}
          >
            {track.artwork ? (
              <FastImage source={{ uri: track.artwork }} style={styles.queueArt} />
            ) : (
              <View style={[styles.queueArt, styles.queueArtPlaceholder]}>
                <Ionicons name="musical-note" size={16} color="#8E8E93" />
              </View>
            )}
            <View style={styles.queueInfo}>
              <Text
                style={[
                  styles.queueTitle,
                  isActive && { color: accentColor, fontWeight: '700' },
                ]}
                numberOfLines={1}
              >
                {track.title ?? 'Unknown Title'}
              </Text>
              <Text style={styles.queueArtist} numberOfLines={1}>
                {track.artist ?? 'Unknown Artist'}
              </Text>
            </View>
            {isActive ? (
              <EqualizerBars
                playing={isPlaying}
                count={3}
                barWidth={3}
                gap={3}
                height={16}
                color={accentColor}
              />
            ) : (
              <Text style={styles.queueIndex}>{index + 1}</Text>
            )}
          </View>
        );
      })}
    </View>
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

  // ── Like state (DB-backed via Track.like()/.unlike() writers) ────────────
  const [liked, setLiked] = useState(false);
  const likeScale = useSharedValue(1);

  // Sync local "liked" with the DB record for the active track. Re-runs
  // whenever the active track changes so the heart reflects the new song's
  // saved state immediately.
  useEffect(() => {
    let cancelled = false;
    const id = activeTrack?.id;
    if (!id) {
      setLiked(false);
      return;
    }
    (async () => {
      try {
        const record = await tracksCollection.find(String(id));
        if (!cancelled) setLiked(!!record.liked);
      } catch {
        if (!cancelled) setLiked(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTrack?.id]);

  const handleLike = useCallback(async () => {
    likeScale.value = withSequence(
      withSpring(1.4, SPRING_FAST),
      withSpring(1, SPRING_FAST),
    );
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const id = activeTrack?.id;
    if (!id) return;

    // Optimistic flip — gives instant visual feedback. The DB write below
    // will either succeed (matching our optimistic state) or fail and we
    // revert.
    const next = !liked;
    setLiked(next);
    try {
      const record = await tracksCollection.find(String(id));
      if (next) {
        await record.like();
      } else {
        await record.unlike();
      }
    } catch (err) {
      logger.warn('[NowPlaying] like toggle failed:', err);
      setLiked(!next);
    }
  }, [activeTrack?.id, liked, likeScale]);

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
        bounces
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
              <ArtworkPlaceholder
                size={ARTWORK_SIZE}
                seed={`${activeTrack?.title ?? ''}-${activeTrack?.artist ?? ''}`}
                isPlaying={isPlaying}
              />
            )}
          </Animated.View>
        </View>

        {/* ── 3. Track info ──────────────────────────────────────────────── */}
        <View style={styles.trackInfo}>
          <View style={styles.titleRow}>
            <Text
              style={styles.trackTitle}
              numberOfLines={2}
              ellipsizeMode="tail"
            >
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

        {/* ── 7. Up Next ──────────────────────────────────────────────────── */}
        <View style={styles.upNextHeader}>
          <Text style={[styles.upNextTitle, { color: accentColor }]}>Up Next</Text>
          <View style={[styles.upNextRule, { backgroundColor: `${accentColor}33` }]} />
        </View>
        <QueuePanel
          activeTrackId={activeTrack?.id ? String(activeTrack.id) : null}
          accentColor={accentColor}
          isPlaying={isPlaying}
        />
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
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderInitial: {
    color: '#FFFFFF',
    fontWeight: '800',
    letterSpacing: -2,
    textShadowColor: 'rgba(0,0,0,0.12)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
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

  // ── Up Next header ────────────────────────────────────────────────────────
  upNextHeader: {
    paddingHorizontal: 32,
    paddingTop: 6,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  upNextTitle: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  upNextRule: {
    flex: 1,
    height: 1,
    borderRadius: 0.5,
  },

  // ── Queue panel ───────────────────────────────────────────────────────────
  queueContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 24,
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
