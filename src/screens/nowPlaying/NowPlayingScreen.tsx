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
  useMemo,
  useRef,
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
  Pressable,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withRepeat,
  withSequence,
  withTiming,
  cancelAnimation,
  FadeIn,
  FadeOut,
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
import { MarqueeText } from '@/components/ui/MarqueeText';
import type { RootStackNavigationProp } from '@/types/navigation';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { SleepTimer, type SleepTimerState } from '@/features/player/SleepTimer';
import { useColorTheme, isDarkOrGrey, GOLD } from '@/features/player/ColorTheme';
import { useSettingsStore } from '@/stores/settingsStore';
import TrackPlayer from 'react-native-track-player';

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

  const handleJump = useCallback(
    async (index: number, alreadyActive: boolean) => {
      if (alreadyActive) return;
      try {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        await TrackPlayer.skip(index);
        await TrackPlayer.play();
      } catch (err) {
        logger.warn('[NowPlaying] queue jump failed:', err);
      }
    },
    [],
  );

  if (!queue || queue.length === 0) {
    return (
      <View style={styles.queueEmpty}>
        <Ionicons name="musical-notes-outline" size={28} color="#C7C7CC" />
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
          <Pressable
            key={`${track.id ?? index}`}
            onPress={() => {
              void handleJump(index, isActive);
            }}
            android_ripple={{ color: `${accentColor}1A`, borderless: false }}
            style={({ pressed }) => [
              styles.queueItem,
              isActive && {
                backgroundColor: `${accentColor}14`,
                borderRadius: 10,
                paddingHorizontal: 8,
                marginHorizontal: -8,
              },
              pressed && !isActive && { opacity: 0.6 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={
              isActive
                ? `Now playing ${track.title ?? 'Unknown Title'}`
                : `Play ${track.title ?? 'Unknown Title'}`
            }
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
          </Pressable>
        );
      })}
    </View>
  );
}

// ─── Sleep-timer sheet ────────────────────────────────────────────────────────

interface SleepTimerSheetProps {
  isVisible: boolean;
  onClose: () => void;
  accentColor: string;
  state: SleepTimerState;
}

function SleepTimerSheet({ isVisible, onClose, accentColor, state }: SleepTimerSheetProps) {
  const options = [5, 15, 30, 45, 60] as const;
  const handlePick = useCallback(
    (mins: number) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      SleepTimer.start(mins);
      setTimeout(onClose, 100);
    },
    [onClose],
  );
  const handleEOT = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    SleepTimer.startEndOfTrack();
    setTimeout(onClose, 100);
  }, [onClose]);
  const handleCancel = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    SleepTimer.cancel();
    setTimeout(onClose, 100);
  }, [onClose]);

  return (
    <BottomSheet isVisible={isVisible} onClose={onClose} snapPoint={420}>
      <View style={sheetStyles.body}>
        <Text style={sheetStyles.title}>Sleep Timer</Text>
        <Text style={sheetStyles.subtitle}>Pause playback after…</Text>
        <View style={sheetStyles.grid}>
          {options.map((mins) => (
            <Pressable
              key={mins}
              onPress={() => handlePick(mins)}
              style={({ pressed }) => [
                sheetStyles.pill,
                pressed && { opacity: 0.7 },
                state.mode === 'duration' &&
                  Math.round(state.totalMs / 60_000) === mins && {
                    backgroundColor: `${accentColor}22`,
                    borderColor: accentColor,
                  },
              ]}
            >
              <Text style={sheetStyles.pillText}>{mins} min</Text>
            </Pressable>
          ))}
          <Pressable
            onPress={handleEOT}
            style={({ pressed }) => [
              sheetStyles.pill,
              sheetStyles.pillWide,
              pressed && { opacity: 0.7 },
              state.mode === 'end-of-track' && {
                backgroundColor: `${accentColor}22`,
                borderColor: accentColor,
              },
            ]}
          >
            <Ionicons name="musical-notes" size={16} color="#1D1D1F" />
            <Text style={sheetStyles.pillText}>End of track</Text>
          </Pressable>
        </View>
        {state.isActive ? (
          <Pressable
            onPress={handleCancel}
            style={({ pressed }) => [
              sheetStyles.cancelButton,
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text style={sheetStyles.cancelText}>Cancel timer</Text>
          </Pressable>
        ) : null}
      </View>
    </BottomSheet>
  );
}

const sheetStyles = StyleSheet.create({
  body: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 24,
    gap: 14,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: '#1D1D1F',
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 13,
    color: '#6E6E73',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 4,
  },
  pill: {
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E5EA',
    minWidth: 84,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  pillWide: {
    flexBasis: '100%',
  },
  pillText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1D1D1F',
  },
  cancelButton: {
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#FF3B30',
    marginTop: 12,
  },
  cancelText: {
    color: '#FF3B30',
    fontWeight: '700',
    fontSize: 14,
  },
});

// ─── Sleep-timer hook ─────────────────────────────────────────────────────────

function useSleepTimerState(): SleepTimerState {
  const [state, setState] = useState<SleepTimerState>(SleepTimer.getState());
  useEffect(() => {
    return SleepTimer.subscribe(setState);
  }, []);
  return state;
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

  // Premium theming: when album-color theming is on, blend the ColorTheme
  // store's dominant colour (with gold fallback for dark/grey art) into the
  // existing accent extraction. When the setting is off, lock to gold so
  // the UI stays consistent.
  const albumThemingEnabled = useSettingsStore((s) => s.albumColorThemingEnabled);
  const themedColors = useColorTheme((s) => s.colors);
  const accentColor = useMemo(() => {
    if (!albumThemingEnabled) return GOLD;
    if (!artworkUri) return '#FA233B';
    const candidate = themedColors.dominant ?? extractedAccentColor;
    if (isDarkOrGrey(candidate)) return GOLD;
    return candidate;
  }, [albumThemingEnabled, artworkUri, themedColors.dominant, extractedAccentColor]);

  // Sleep-timer wiring.
  const sleepState = useSleepTimerState();
  const [sleepSheetVisible, setSleepSheetVisible] = useState(false);
  const openSleepSheet = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSleepSheetVisible(true);
  }, []);
  const closeSleepSheet = useCallback(() => setSleepSheetVisible(false), []);

  // Gold-glow pulse when a sleep timer is active.
  const sleepGlow = useSharedValue(0);
  useEffect(() => {
    if (sleepState.isActive) {
      sleepGlow.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 900 }),
          withTiming(0.35, { duration: 900 }),
        ),
        -1,
        true,
      );
    } else {
      cancelAnimation(sleepGlow);
      sleepGlow.value = withTiming(0, { duration: 180 });
    }
    return () => {
      cancelAnimation(sleepGlow);
    };
  }, [sleepState.isActive]);
  const sleepGlowStyle = useAnimatedStyle(() => ({ opacity: sleepGlow.value }));

  const sleepLabel = sleepState.isActive
    ? sleepState.mode === 'end-of-track'
      ? 'EOT'
      : `${Math.max(1, Math.ceil(sleepState.remainingMs / 60_000))}m`
    : null;

  // ── Like state (DB-backed via Track.like()/.unlike() writers) ────────────
  const [liked, setLiked] = useState(false);
  // Mirror `liked` in a ref so `handleLike` (a stable callback) can read the
  // latest value without re-creating itself on every toggle. Crucially this
  // also avoids the rapid-tap race where two taps captured the same `liked`
  // closure and both flipped in the same direction.
  const likedRef = useRef(false);
  // Guard against overlapping DB writes when the user spams the heart.
  const likeWriteInFlightRef = useRef(false);
  const likeScale = useSharedValue(1);

  // Sync local "liked" with the DB record for the active track. Re-runs
  // whenever the active track changes so the heart reflects the new song's
  // saved state immediately.
  useEffect(() => {
    let cancelled = false;
    const id = activeTrack?.id;
    if (!id) {
      setLiked(false);
      likedRef.current = false;
      return;
    }
    (async () => {
      try {
        const record = await tracksCollection.find(String(id));
        if (!cancelled) {
          const v = !!record.liked;
          setLiked(v);
          likedRef.current = v;
        }
      } catch {
        if (!cancelled) {
          setLiked(false);
          likedRef.current = false;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTrack?.id]);

  const handleLike = useCallback(async () => {
    // Heavy haptic on a sticky toggle — Spotify / Apple Music feel.
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    likeScale.value = withSequence(
      withSpring(0.85, { ...SPRING_FAST, mass: 0.5 }),
      withSpring(1.35, { ...SPRING_FAST, damping: 10 }),
      withSpring(1, SPRING_FAST),
    );

    const id = activeTrack?.id;
    if (!id) return;
    if (likeWriteInFlightRef.current) {
      // Coalesce rapid taps: ignore until the in-flight write resolves so the
      // DB doesn't end up out-of-sync with optimistic state.
      return;
    }

    const next = !likedRef.current;
    likedRef.current = next;
    setLiked(next);
    likeWriteInFlightRef.current = true;
    try {
      const record = await tracksCollection.find(String(id));
      if (next) {
        await record.like();
      } else {
        await record.unlike();
      }
    } catch (err) {
      logger.warn('[NowPlaying] like toggle failed:', err);
      likedRef.current = !next;
      setLiked(!next);
    } finally {
      likeWriteInFlightRef.current = false;
    }
  }, [activeTrack?.id, likeScale]);

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
    // Always cancel on unmount so the worklet doesn't keep mutating the
    // shared value after the screen is gone.
    return () => {
      cancelAnimation(artworkScale);
    };
  }, [isPlaying]);

  const artworkAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: artworkScale.value }],
  }));

  // ── Play/pause morph pulse ─────────────────────────────────────────────────
  // The PlayerControls component owns the icon swap; we add a subtle ring
  // pulse around it whenever the playing-state flips, giving a "morph"
  // feeling without editing the sibling component.
  const morphPulse = useSharedValue(0);
  useEffect(() => {
    morphPulse.value = 0;
    morphPulse.value = withSequence(
      withTiming(1, { duration: 220 }),
      withTiming(0, { duration: 320 }),
    );
  }, [isPlaying]);
  const morphStyle = useAnimatedStyle(() => ({
    opacity: morphPulse.value * 0.55,
    transform: [{ scale: 0.85 + morphPulse.value * 0.45 }],
  }));

  // Haptic on play/pause + skip — primary actions.
  const handleTogglePlayPause = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    void togglePlayPause();
  }, [togglePlayPause]);
  const handleSkipNext = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    void skipToNext();
  }, [skipToNext]);
  const handleSkipPrev = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    void skipToPrevious();
  }, [skipToPrevious]);

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
  // Build a smooth 4-stop gradient: a stronger dominant-tint at the top
  // (where the blurred art shows through), fading through a near-white mid
  // band, and settling into the page background so the bottom controls have
  // crisp contrast. The extra alpha stop kills the visible "seam" between
  // the accent wash and the white plate that the 3-stop version produced
  // when the dominant colour was very saturated.
  const gradientColors: [string, string, string, string] = [
    `${accentColor}33`,
    `${accentColor}10`,
    '#F5F5F7f2',
    '#F5F5F7',
  ];
  const gradientLocations: [number, number, number, number] = [0, 0.28, 0.62, 1];

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

      {/* Soft light gradient overlay — dominant accent fades to background */}
      <LinearGradient
        colors={gradientColors}
        locations={gradientLocations}
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

          <View style={styles.headerRight}>
            <TouchableOpacity
              onPress={openSleepSheet}
              style={styles.headerButton}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityLabel="Sleep timer"
              accessibilityRole="button"
            >
              <View>
                <Animated.View
                  pointerEvents="none"
                  style={[styles.sleepGlow, { backgroundColor: GOLD }, sleepGlowStyle]}
                />
                <Ionicons
                  name="moon"
                  size={22}
                  color={sleepState.isActive ? GOLD : '#1D1D1F'}
                />
              </View>
              {sleepLabel ? (
                <Text style={[styles.sleepLabel, { color: GOLD }]}>{sleepLabel}</Text>
              ) : null}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleMenu}
              style={styles.headerButton}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Ionicons name="ellipsis-horizontal" size={25} color="#1D1D1F" />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── 2. Artwork ─────────────────────────────────────────────────── */}
        <View style={styles.artworkWrapper}>
          <Animated.View style={[styles.artworkShadow, artworkAnimStyle]}>
            {/* Keyed inner so each track change drives a FadeIn/FadeOut. */}
            <Animated.View
              key={String(activeTrack?.id ?? 'empty')}
              entering={FadeIn.duration(280)}
              exiting={FadeOut.duration(180)}
              style={styles.artworkFadeBox}
            >
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
          </Animated.View>
        </View>

        {/* ── 3. Track info ──────────────────────────────────────────────── */}
        <View style={styles.trackInfo}>
          <View style={styles.titleRow}>
            <View style={styles.titleMarqueeWrap}>
              <MarqueeText style={styles.trackTitle}>
                {activeTrack?.title ?? 'Not Playing'}
              </MarqueeText>
            </View>
            <TouchableOpacity
              onPress={handleLike}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={liked ? 'Unlike song' : 'Like song'}
            >
              <Animated.View style={[styles.likeButton, likeStyle]}>
                <Ionicons
                  name={liked ? 'heart' : 'heart-outline'}
                  size={28}
                  color={liked ? '#FA233B' : '#8E8E93'}
                />
              </Animated.View>
            </TouchableOpacity>
          </View>

          <MarqueeText style={styles.trackArtist}>
            {activeTrack?.artist ?? '—'}
          </MarqueeText>
        </View>

        {/* ── 4. Progress slider ─────────────────────────────────────────── */}
        <View style={styles.progressWrapper}>
          <ConnectedProgressSlider onSeek={seekTo} accentColor={accentColor} />
        </View>

        {/* ── 5. Controls ─────────────────────────────────────────────────── */}
        <View style={styles.controlsWrapper}>
          <Animated.View
            pointerEvents="none"
            style={[
              styles.morphRing,
              { borderColor: accentColor },
              morphStyle,
            ]}
          />
          <PlayerControls
            isPlaying={isPlaying}
            isLoading={isLoading}
            onPlayPause={handleTogglePlayPause}
            onPrevious={handleSkipPrev}
            onNext={handleSkipNext}
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

      <SleepTimerSheet
        isVisible={sleepSheetVisible}
        onClose={closeSleepSheet}
        accentColor={accentColor}
        state={sleepState}
      />
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
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sleepGlow: {
    position: 'absolute',
    top: -4,
    left: -4,
    right: -4,
    bottom: -4,
    borderRadius: 20,
    opacity: 0,
  },
  sleepLabel: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.4,
    marginTop: 2,
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
  artworkFadeBox: {
    width: ARTWORK_SIZE,
    height: ARTWORK_SIZE,
    borderRadius: 22,
    overflow: 'hidden',
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
  titleMarqueeWrap: {
    flex: 1,
  },
  trackTitle: {
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
    position: 'relative',
  },
  morphRing: {
    position: 'absolute',
    width: 92,
    height: 92,
    borderRadius: 46,
    borderWidth: 2,
    alignSelf: 'center',
    top: -13,
    zIndex: 0,
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
    gap: 8,
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
