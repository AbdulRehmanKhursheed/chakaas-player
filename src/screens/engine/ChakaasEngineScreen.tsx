/**
 * ChakaasEngineScreen — analytics surface for the on-device recommendation
 * engine. Shows the user what the engine has learned, how confident it is,
 * which artists currently dominate their taste, and what it would suggest
 * downloading next.
 *
 * Sources:
 *   - `getEngineStats()` from artistAffinity (top artists, totals, decay date)
 *   - `getDiscoverFeed()` from discoverEngine (currently-thinking picks)
 *   - `playsCollection` for the play-count + recent-events list
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  StatusBar,
  Platform,
  TouchableOpacity,
  RefreshControl,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Q } from '@nozbe/watermelondb';
import { LinearGradient } from 'expo-linear-gradient';
import { MotiView } from 'moti';

import {
  getEngineStats,
  resetAffinity,
  type EngineStats,
} from '@/features/recommendations/artistAffinity';
import {
  getDiscoverFeed,
  type DiscoverItem,
} from '@/features/recommendations/discoverEngine';
import { playsCollection, tracksCollection } from '@/db';
import { logger } from '@/utils/logger';
import { useTheme, type Theme } from '@/theme';
import type { RootStackNavigationProp } from '@/types/navigation';

// ─── Helpers ────────────────────────────────────────────────────────────────

interface EngineHealth {
  label: string;
  description: string;
  progress: number; // 0..1
  /** Tier index 0..3, used to pick HUD accent treatment. */
  tier: number;
}

function deriveHealth(playCount: number, artistCount: number): EngineHealth {
  // Plays carry more signal than raw artist count, but a tiny library with
  // no plays can still reflect seeded interests via the artist count.
  const score = playCount + artistCount * 0.5;
  if (score < 10) {
    return {
      label: 'Warming up',
      description: 'Play a few songs and the engine will start learning your taste.',
      progress: Math.min(1, score / 10) * 0.25,
      tier: 0,
    };
  }
  if (score < 40) {
    return {
      label: 'Tuning in',
      description: 'Picking up patterns. Suggestions are getting more personal.',
      progress: 0.25 + Math.min(1, (score - 10) / 30) * 0.3,
      tier: 1,
    };
  }
  if (score < 120) {
    return {
      label: 'Locked in',
      description: 'Confident in your taste. Discover is on point.',
      progress: 0.55 + Math.min(1, (score - 40) / 80) * 0.3,
      tier: 2,
    };
  }
  return {
    label: 'Mastered',
    description: 'The engine knows you. Recommendations are sharply tuned.',
    progress: Math.min(1, 0.85 + (score - 120) / 400 * 0.15),
    tier: 3,
  };
}

function formatRelativeTime(epochSeconds: number | null): string {
  if (!epochSeconds || epochSeconds <= 0) return 'never';
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - epochSeconds);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
  const days = Math.floor(diff / 86400);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

// ─── Hero card — J.A.R.V.I.S. HUD reactor ────────────────────────────────────

interface HeroCardProps {
  health: EngineHealth;
  playCount: number;
  artistCount: number;
}

function HeroCard({ health, playCount, artistCount }: HeroCardProps) {
  const { colors } = useTheme();
  const pct = Math.round(health.progress * 100);
  // Mastered taps the Iron Man gold; every other tier stays arc-reactor cyan.
  const ringAccent = health.tier >= 3 ? colors.gold : colors.accent;
  const heroGradient =
    health.tier >= 3
      ? (['#12161E', '#0E1218'] as const)
      : (['#0B141C', '#0E1218'] as const);

  return (
    <View style={heroStyles.wrap}>
      <LinearGradient
        colors={heroGradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[heroStyles.card, { borderColor: colors.borderAccent }]}
      >
        {/* Faint HUD grid scan-line sweeping vertically */}
        <MotiView
          pointerEvents="none"
          from={{ translateY: -40, opacity: 0 }}
          animate={{ translateY: 220, opacity: 0.5 }}
          transition={{
            type: 'timing',
            duration: 2600,
            loop: true,
            repeatReverse: false,
          }}
          style={heroStyles.scanLineWrap}
        >
          <LinearGradient
            colors={['transparent', ringAccent, 'transparent']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={heroStyles.scanLine}
          />
        </MotiView>

        <View style={heroStyles.topRow}>
          {/* Reactor ring readout */}
          <View style={heroStyles.ringCol}>
            <View style={[heroStyles.ringOuter, { borderColor: colors.borderAccent }]}>
              <MotiView
                from={{ opacity: 0.35, scale: 0.96 }}
                animate={{ opacity: 0.9, scale: 1.04 }}
                transition={{
                  type: 'timing',
                  duration: 1800,
                  loop: true,
                  repeatReverse: true,
                }}
                style={[
                  heroStyles.ringPulse,
                  { borderColor: ringAccent },
                ]}
              />
              <View style={[heroStyles.ringInner, { backgroundColor: ringAccent }]}>
                <Text style={[heroStyles.ringPct, { color: colors.bg }]}>{pct}</Text>
                <Text style={[heroStyles.ringUnit, { color: colors.bg }]}>%</Text>
              </View>
            </View>
            <Text style={[heroStyles.ringCaption, { color: colors.textTertiary }]}>
              CALIBRATION
            </Text>
          </View>

          <View style={heroStyles.titleCol}>
            <Text style={[heroStyles.eyebrow, { color: ringAccent }]}>CHAKAAS ENGINE</Text>
            <Text style={[heroStyles.title, { color: colors.textPrimary }]}>{health.label}</Text>
            <Text style={[heroStyles.description, { color: colors.textSecondary }]}>
              {health.description}
            </Text>
          </View>
        </View>

        {/* HUD progress bar */}
        <View style={[heroStyles.progressTrack, { backgroundColor: colors.bgRaised }]}>
          <LinearGradient
            colors={
              health.tier >= 3 ? colors.goldGradient : colors.brandGradient
            }
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[heroStyles.progressFill, { width: `${pct}%` }]}
          />
        </View>

        <View style={heroStyles.statsRow}>
          <View style={[heroStyles.statBox, { backgroundColor: colors.bgRaised, borderColor: colors.border }]}>
            <Text style={[heroStyles.statValue, { color: ringAccent }]}>
              {playCount.toLocaleString()}
            </Text>
            <Text style={[heroStyles.statLabel, { color: colors.textSecondary }]}>plays logged</Text>
          </View>
          <View style={[heroStyles.statBox, { backgroundColor: colors.bgRaised, borderColor: colors.border }]}>
            <Text style={[heroStyles.statValue, { color: ringAccent }]}>
              {artistCount.toLocaleString()}
            </Text>
            <Text style={[heroStyles.statLabel, { color: colors.textSecondary }]}>artists tracked</Text>
          </View>
        </View>
      </LinearGradient>
    </View>
  );
}

const heroStyles = StyleSheet.create({
  wrap: {
    marginHorizontal: 16,
    marginBottom: 24,
  },
  card: {
    borderRadius: 20,
    padding: 22,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  scanLineWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: 2,
  },
  scanLine: {
    flex: 1,
    height: 2,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
  },
  ringCol: {
    alignItems: 'center',
    gap: 6,
  },
  ringOuter: {
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringPulse: {
    position: 'absolute',
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 1.5,
  },
  ringInner: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  ringPct: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  ringUnit: {
    fontSize: 11,
    fontWeight: '800',
    marginTop: 4,
    marginLeft: 1,
  },
  ringCaption: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  titleCol: {
    flex: 1,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.8,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    marginTop: 4,
    letterSpacing: -0.8,
  },
  description: {
    fontSize: 13,
    fontWeight: '500',
    marginTop: 6,
    lineHeight: 18,
  },
  progressTrack: {
    marginTop: 18,
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: 6,
    borderRadius: 3,
  },
  statsRow: {
    flexDirection: 'row',
    marginTop: 16,
    gap: 12,
  },
  statBox: {
    flex: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  statValue: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  statLabel: {
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});

// ─── Top artists chart — affinity viz ────────────────────────────────────────

interface TopArtistsProps {
  topArtists: EngineStats['topArtists'];
}

function TopArtistsChart({ topArtists }: TopArtistsProps) {
  const { colors } = useTheme();
  if (topArtists.length === 0) {
    return (
      <View style={artistStyles.empty}>
        <Text style={[artistStyles.emptyText, { color: colors.textSecondary }]}>
          No artist signal yet. Play some songs and they'll show up here.
        </Text>
      </View>
    );
  }

  const max = Math.max(...topArtists.map((a) => a.score), 1);

  return (
    <View style={artistStyles.list}>
      {topArtists.map((row) => {
        const widthPct = Math.max(8, (row.score / max) * 100);
        return (
          <View key={row.artist} style={artistStyles.row}>
            <View style={artistStyles.rowHeader}>
              <Text style={[artistStyles.artistName, { color: colors.textPrimary }]} numberOfLines={1}>
                {row.artist}
              </Text>
              {row.isSeed && (
                <View style={[artistStyles.seedBadge, { backgroundColor: colors.accentMuted }]}>
                  <Text style={[artistStyles.seedBadgeText, { color: colors.accent }]}>SEED</Text>
                </View>
              )}
              <Text style={[artistStyles.score, { color: colors.accent }]}>{row.score.toFixed(1)}</Text>
            </View>
            <View style={[artistStyles.barTrack, { backgroundColor: colors.bgRaised }]}>
              <LinearGradient
                colors={colors.brandGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[artistStyles.barFill, { width: `${widthPct}%` }]}
              />
            </View>
          </View>
        );
      })}
    </View>
  );
}

const artistStyles = StyleSheet.create({
  list: {
    gap: 14,
  },
  row: {
    gap: 6,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  artistName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
  },
  seedBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  seedBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  score: {
    fontSize: 13,
    fontWeight: '700',
    minWidth: 36,
    textAlign: 'right',
  },
  barTrack: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  barFill: {
    height: 6,
    borderRadius: 3,
  },
  empty: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
});

// ─── Thinking-about list ────────────────────────────────────────────────────

interface ThinkingProps {
  picks: DiscoverItem[];
  loading: boolean;
}

function ThinkingList({ picks, loading }: ThinkingProps) {
  const { colors } = useTheme();
  if (loading && picks.length === 0) {
    return (
      <View style={thinkingStyles.empty}>
        <MotiView
          from={{ opacity: 0.4 }}
          animate={{ opacity: 1 }}
          transition={{ type: 'timing', duration: 800, loop: true, repeatReverse: true }}
        >
          <Text style={[thinkingStyles.emptyText, { color: colors.accent }]}>
            Composing suggestions…
          </Text>
        </MotiView>
      </View>
    );
  }
  if (picks.length === 0) {
    return (
      <View style={thinkingStyles.empty}>
        <Text style={[thinkingStyles.emptyText, { color: colors.textSecondary }]}>
          Nothing new to suggest right now.
        </Text>
      </View>
    );
  }
  return (
    <View style={thinkingStyles.list}>
      {picks.slice(0, 5).map((p) => (
        <View key={p.id} style={thinkingStyles.row}>
          <View style={[thinkingStyles.bullet, { backgroundColor: colors.accent }]} />
          <View style={thinkingStyles.body}>
            <Text style={[thinkingStyles.title, { color: colors.textPrimary }]} numberOfLines={1}>
              {p.title} <Text style={[thinkingStyles.dim, { color: colors.textSecondary }]}>· {p.author}</Text>
            </Text>
            <Text style={[thinkingStyles.reason, { color: colors.textSecondary }]} numberOfLines={1}>
              {p.reason}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const thinkingStyles = StyleSheet.create({
  list: {
    gap: 12,
  },
  row: {
    flexDirection: 'row',
    gap: 10,
  },
  bullet: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 6,
  },
  body: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
  },
  dim: {
    fontWeight: '400',
  },
  reason: {
    fontSize: 12,
  },
  empty: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 13,
    fontWeight: '600',
  },
});

// ─── Recent learning events ────────────────────────────────────────────────

interface PlayEventRow {
  id: string;
  title: string;
  artist: string;
  completionRatio: number;
  wasSkipped: boolean;
  playedAt: number;
}

function RecentEvents({ events }: { events: PlayEventRow[] }) {
  const { colors } = useTheme();
  if (events.length === 0) {
    return (
      <View style={eventStyles.empty}>
        <Text style={[eventStyles.emptyText, { color: colors.textSecondary }]}>No plays logged yet.</Text>
      </View>
    );
  }
  return (
    <View style={eventStyles.list}>
      {events.map((e) => {
        const pct = Math.round(e.completionRatio * 100);
        const isLearn = !e.wasSkipped && e.completionRatio >= 0.3;
        const signalColor = isLearn ? colors.accent : colors.textTertiary;
        return (
          <View key={e.id} style={eventStyles.row}>
            <View
              style={[
                eventStyles.signal,
                {
                  backgroundColor: isLearn ? colors.accentMuted : colors.bgRaised,
                  borderColor: isLearn ? colors.borderAccent : colors.border,
                },
              ]}
            >
              <Ionicons
                name={isLearn ? 'arrow-up' : 'arrow-down'}
                size={14}
                color={signalColor}
              />
            </View>
            <View style={eventStyles.body}>
              <Text style={[eventStyles.title, { color: colors.textPrimary }]} numberOfLines={1}>
                {e.title}
              </Text>
              <Text style={[eventStyles.sub, { color: colors.textSecondary }]} numberOfLines={1}>
                {e.artist} · {formatRelativeTime(e.playedAt)}
              </Text>
            </View>
            <Text style={[eventStyles.pct, { color: signalColor }]}>
              {pct}%
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const eventStyles = StyleSheet.create({
  list: {
    gap: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  signal: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  body: {
    flex: 1,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
  },
  sub: {
    fontSize: 12,
    marginTop: 1,
  },
  pct: {
    fontSize: 13,
    fontWeight: '700',
  },
  empty: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 13,
  },
});

// ─── Section wrapper ────────────────────────────────────────────────────────

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View style={sectionStyles.section}>
      <Text style={[sectionStyles.sectionTitle, { color: colors.textTertiary }]}>{title}</Text>
      <View
        style={[
          sectionStyles.sectionCard,
          { backgroundColor: colors.bgElevated, borderColor: colors.borderAccent },
        ]}
      >
        {children}
      </View>
    </View>
  );
}

const sectionStyles = StyleSheet.create({
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    paddingHorizontal: 24,
    marginBottom: 10,
  },
  sectionCard: {
    marginHorizontal: 16,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
});

// ─── Main screen ────────────────────────────────────────────────────────────

export function ChakaasEngineScreen() {
  const navigation = useNavigation<RootStackNavigationProp<'ChakaasEngine'>>();
  const theme = useTheme();
  const { colors, isDark } = theme;
  const mainStyles = useMemo(() => createMainStyles(theme), [theme]);

  const [stats, setStats] = useState<EngineStats | null>(null);
  const [playCount, setPlayCount] = useState(0);
  const [picks, setPicks] = useState<DiscoverItem[]>([]);
  const [picksLoading, setPicksLoading] = useState(true);
  const [recent, setRecent] = useState<PlayEventRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadAll = useCallback(async () => {
    try {
      setStats(getEngineStats(10));

      const totalPlays = await playsCollection.query().fetchCount();
      setPlayCount(totalPlays);

      const recentPlays = await playsCollection
        .query(Q.sortBy('played_at', Q.desc), Q.take(10))
        .fetch();
      const events: PlayEventRow[] = [];
      for (const p of recentPlays as any[]) {
        try {
          const track = await tracksCollection.find(p.trackId);
          events.push({
            id: p.id,
            title: track.title,
            artist: track.artist,
            completionRatio: p.completionRatio ?? 0,
            wasSkipped: !!p.wasSkipped,
            playedAt:
              typeof p.playedAt === 'number'
                ? p.playedAt > 1e12
                  ? Math.floor(p.playedAt / 1000)
                  : p.playedAt
                : 0,
          });
        } catch {
          // Track was deleted — skip the event.
        }
      }
      setRecent(events);

      setPicksLoading(true);
      try {
        const feed = await getDiscoverFeed(8);
        setPicks(feed);
      } catch (err) {
        logger.warn('[ChakaasEngine] Discover feed failed:', err);
      } finally {
        setPicksLoading(false);
      }
    } catch (err) {
      logger.error('[ChakaasEngine] loadAll failed:', err);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadAll();
    setRefreshing(false);
  }, [loadAll]);

  const handleReset = useCallback(() => {
    Alert.alert(
      'Reset learning?',
      'Wipes everything the engine has learned from your plays and restores the starter taste seed (Nusrat, Arijit, Atif, Badshah and friends). Real plays will build on top of the seed again. Plays already in your library are kept.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => {
            resetAffinity();
            void loadAll();
          },
        },
      ],
    );
  }, [loadAll]);

  const health = deriveHealth(playCount, stats?.totalArtists ?? 0);

  return (
    <View style={mainStyles.root}>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor={colors.bg}
      />

      {/* Header */}
      <View style={mainStyles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={mainStyles.headerBtn}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={mainStyles.headerTitle}>Engine</Text>
        <View style={mainStyles.headerBtn} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
      >
        <HeroCard
          health={health}
          playCount={playCount}
          artistCount={stats?.totalArtists ?? 0}
        />

        <Section title="What I'm thinking">
          <ThinkingList picks={picks} loading={picksLoading} />
        </Section>

        <Section title="Top artists">
          <TopArtistsChart topArtists={stats?.topArtists ?? []} />
        </Section>

        <Section title="Recent learning events">
          <RecentEvents events={recent} />
        </Section>

        <Section title="Maintenance">
          <View style={mainStyles.maintRow}>
            <Text style={mainStyles.maintLabel}>Last decay run</Text>
            <Text style={mainStyles.maintValue}>
              {formatRelativeTime(stats?.lastDecayAt ?? null)}
            </Text>
          </View>
          {(stats?.dislikedArtistCount ?? 0) > 0 && (
            <>
              <View style={mainStyles.maintSeparator} />
              <View style={mainStyles.maintRow}>
                <Text style={mainStyles.maintLabel}>Repeatedly skipped</Text>
                <Text style={mainStyles.maintValue}>
                  {stats?.dislikedArtistCount} artists
                </Text>
              </View>
            </>
          )}
          <View style={mainStyles.maintSeparator} />
          <TouchableOpacity onPress={handleReset} style={mainStyles.resetRow}>
            <Ionicons name="refresh-circle" size={22} color={colors.danger} />
            <View style={{ flex: 1 }}>
              <Text style={mainStyles.resetLabel}>Reset learning</Text>
              <Text style={mainStyles.resetSub}>
                Wipe affinity scores. Restores your original seed.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
          </TouchableOpacity>
        </Section>
      </ScrollView>
    </View>
  );
}

function createMainStyles({ colors }: Theme) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.bg,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingTop: Platform.OS === 'ios' ? 56 : 36,
      paddingBottom: 12,
      paddingHorizontal: 12,
      backgroundColor: colors.bg,
    },
    headerBtn: {
      width: 40,
      height: 40,
      justifyContent: 'center',
      alignItems: 'center',
    },
    headerTitle: {
      flex: 1,
      fontSize: 17,
      fontWeight: '700',
      color: colors.textPrimary,
      textAlign: 'center',
    },
    maintRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    maintSeparator: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
      marginVertical: 12,
    },
    maintLabel: {
      fontSize: 14,
      color: colors.textSecondary,
    },
    maintValue: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textPrimary,
    },
    resetRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    resetLabel: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.danger,
    },
    resetSub: {
      fontSize: 12,
      color: colors.textSecondary,
      marginTop: 2,
    },
  });
}
