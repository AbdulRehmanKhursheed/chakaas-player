/**
 * LyricsPanel — Synced & plain-text lyrics display for the Now Playing screen.
 *
 * Features:
 *   - Fetches from LRClib via getLyrics()
 *   - Shows skeleton lines while loading
 *   - Synced LRC: current line large+white, adjacent lines grey+faded
 *   - Auto-scrolls to keep current line vertically centred
 *   - Falls back to scrollable plain-text when no synced lyrics
 *   - "No lyrics available" empty state
 */

import React, {
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withSequence,
} from 'react-native-reanimated';
import { getLyrics, parseLRC, type SyncedLine } from '@/services/api/lrclib';
import { logger } from '@/utils/logger';

// ─── Constants ───────────────────────────────────────────────────────────────

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const PANEL_HEIGHT = SCREEN_HEIGHT * 0.38;
const LINE_HEIGHT = 52; // approx height of one lyric row
const CENTER_OFFSET = PANEL_HEIGHT / 2 - LINE_HEIGHT;

// ─── Types ───────────────────────────────────────────────────────────────────

interface LyricsPanelProps {
  trackId: string;
  artist: string;
  title: string;
  album: string;
  /** Total track duration in milliseconds. */
  duration_ms: number;
  /** Current playback position in seconds. */
  currentPosition: number;
  accentColor?: string;
}

type LyricsState =
  | { status: 'loading' }
  | { status: 'synced'; lines: SyncedLine[] }
  | { status: 'plain'; text: string }
  | { status: 'empty' };

// ─── Skeleton line ────────────────────────────────────────────────────────────

function SkeletonLine({ width }: { width: number }) {
  const opacity = useSharedValue(0.3);

  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(0.65, { duration: 700 }),
        withTiming(0.3, { duration: 700 }),
      ),
      -1,
      false,
    );
  }, []);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View style={[styles.skeletonLine, { width }, style]} />
  );
}

// ─── Synced lyrics view ───────────────────────────────────────────────────────

function SyncedLyrics({
  lines,
  currentPosition,
}: {
  lines: SyncedLine[];
  currentPosition: number;
  accentColor?: string;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const [lineHeights, setLineHeights] = useState<number[]>([]);

  // Find active index: last line whose timestamp <= currentPosition
  const activeIndex = React.useMemo(() => {
    let idx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].time <= currentPosition) idx = i;
      else break;
    }
    return idx;
  }, [lines, currentPosition]);

  // Auto-scroll to keep the active line centred
  useEffect(() => {
    if (activeIndex < 0 || !scrollRef.current) return;

    // Accumulate heights to get y offset of the active line
    const heightsUpToActive = lineHeights.slice(0, activeIndex);
    const accumulatedY = heightsUpToActive.reduce((sum, h) => sum + h, 0);
    const scrollY = Math.max(0, accumulatedY - CENTER_OFFSET);

    scrollRef.current.scrollTo({ y: scrollY, animated: true });
  }, [activeIndex, lineHeights]);

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.lyricsScroll}
      contentContainerStyle={styles.lyricsContent}
      showsVerticalScrollIndicator={false}
      scrollEventThrottle={16}
    >
      {/* Top padding so first line can scroll to centre */}
      <View style={{ height: CENTER_OFFSET }} />

      {lines.map((line, index) => {
        const diff = index - activeIndex;
        const isCurrent = diff === 0;
        const isClose = Math.abs(diff) <= 2;

        const opacity = isCurrent ? 1 : isClose ? 0.45 - Math.abs(diff) * 0.1 : 0.2;
        const fontSize = isCurrent ? 22 : isClose ? 16 : 14;
        const fontWeight = isCurrent ? '700' : '400';
        const color = isCurrent ? '#1D1D1F' : '#8E8E93';

        return (
          <View
            key={`${line.time}-${index}`}
            style={styles.lyricLine}
            onLayout={(e) => {
              const h = e.nativeEvent.layout.height;
              setLineHeights((prev) => {
                const next = [...prev];
                next[index] = h;
                return next;
              });
            }}
          >
            <Text
              style={[
                styles.lyricText,
                {
                  opacity,
                  fontSize,
                  fontWeight: fontWeight as any,
                  color,
                  transform: isCurrent ? [{ scale: 1.02 }] : [{ scale: 1 }],
                },
              ]}
            >
              {line.text}
            </Text>
          </View>
        );
      })}

      {/* Bottom padding so last line can scroll to centre */}
      <View style={{ height: CENTER_OFFSET }} />
    </ScrollView>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function LyricsPanel({
  trackId,
  artist,
  title,
  album,
  duration_ms,
  currentPosition,
  accentColor = '#FA233B',
}: LyricsPanelProps) {
  const [lyricsState, setLyricsState] = useState<LyricsState>({ status: 'loading' });
  const lastFetchedId = useRef<string>('');

  // Fetch when track changes
  useEffect(() => {
    if (!trackId || lastFetchedId.current === trackId) return;
    lastFetchedId.current = trackId;

    setLyricsState({ status: 'loading' });

    const durationSeconds = duration_ms / 1000;

    getLyrics(artist, title, album, durationSeconds)
      .then((entry) => {
        if (!entry) {
          setLyricsState({ status: 'empty' });
          return;
        }

        if (entry.syncedLyrics) {
          const lines = parseLRC(entry.syncedLyrics).filter((l) => l.text.trim().length > 0);
          if (lines.length > 0) {
            setLyricsState({ status: 'synced', lines });
            return;
          }
        }

        if (entry.plainLyrics && entry.plainLyrics.trim().length > 0) {
          setLyricsState({ status: 'plain', text: entry.plainLyrics });
          return;
        }

        setLyricsState({ status: 'empty' });
      })
      .catch((err: unknown) => {
        logger.error('[LyricsPanel] fetch failed:', err);
        setLyricsState({ status: 'empty' });
      });
  }, [trackId, artist, title, album, duration_ms]);

  // ── Render states ──────────────────────────────────────────────────────────

  if (lyricsState.status === 'loading') {
    return (
      <View style={styles.container}>
        <View style={styles.skeletonWrapper}>
          {[220, 180, 260, 200, 240, 170, 210].map((w, i) => (
            <SkeletonLine key={i} width={w} />
          ))}
        </View>
      </View>
    );
  }

  if (lyricsState.status === 'synced') {
    return (
      <View style={styles.container}>
        <SyncedLyrics
          lines={lyricsState.lines}
          currentPosition={currentPosition}
          accentColor={accentColor}
        />
      </View>
    );
  }

  if (lyricsState.status === 'plain') {
    return (
      <View style={styles.container}>
        <ScrollView
          style={styles.lyricsScroll}
          contentContainerStyle={styles.lyricsContent}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.plainText}>{lyricsState.text}</Text>
        </ScrollView>
      </View>
    );
  }

  // Empty state
  return (
    <View style={[styles.container, styles.emptyContainer]}>
      <Ionicons name="text" size={34} color="#C7C7CC" />
      <Text style={styles.emptyTitle}>No lyrics available</Text>
      <Text style={styles.emptySubtitle}>
        {`Lyrics for "${title}" could not be found`}
      </Text>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    height: PANEL_HEIGHT,
    overflow: 'hidden',
  },

  // ── Skeleton ──────────────────────────────────────────────────────────────
  skeletonWrapper: {
    paddingHorizontal: 20,
    gap: 16,
    paddingTop: 24,
  },
  skeletonLine: {
    height: 14,
    borderRadius: 7,
    backgroundColor: '#E5E5EA',
    alignSelf: 'center',
  },

  // ── Lyrics ────────────────────────────────────────────────────────────────
  lyricsScroll: {
    flex: 1,
  },
  lyricsContent: {
    paddingHorizontal: 20,
  },
  lyricLine: {
    paddingVertical: 8,
    alignItems: 'center',
  },
  lyricText: {
    textAlign: 'center',
    letterSpacing: -0.3,
    lineHeight: 30,
  },

  // ── Plain text ────────────────────────────────────────────────────────────
  plainText: {
    fontSize: 15,
    lineHeight: 26,
    color: '#3A3A3C',
    textAlign: 'center',
    paddingHorizontal: 4,
    paddingTop: 16,
  },

  // ── Empty state ────────────────────────────────────────────────────────────
  emptyContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1D1D1F',
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#8E8E93',
    textAlign: 'center',
    paddingHorizontal: 32,
  },
});
