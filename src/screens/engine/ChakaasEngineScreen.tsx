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
import React, { useCallback, useEffect, useState } from 'react';
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
import type { RootStackNavigationProp } from '@/types/navigation';

// ─── Helpers ────────────────────────────────────────────────────────────────

interface EngineHealth {
  label: string;
  description: string;
  progress: number; // 0..1
  gradient: [string, string];
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
      gradient: ['#8E8E93', '#C7C7CC'],
    };
  }
  if (score < 40) {
    return {
      label: 'Tuning in',
      description: 'Picking up patterns. Suggestions are getting more personal.',
      progress: 0.25 + Math.min(1, (score - 10) / 30) * 0.3,
      gradient: ['#5856D6', '#FA233B'],
    };
  }
  if (score < 120) {
    return {
      label: 'Locked in',
      description: 'Confident in your taste. Discover is on point.',
      progress: 0.55 + Math.min(1, (score - 40) / 80) * 0.3,
      gradient: ['#FA233B', '#FF9500'],
    };
  }
  return {
    label: 'Mastered',
    description: 'The engine knows you. Recommendations are sharply tuned.',
    progress: Math.min(1, 0.85 + (score - 120) / 400 * 0.15),
    gradient: ['#FA233B', '#FFCC00'],
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

// ─── Hero card ──────────────────────────────────────────────────────────────

interface HeroCardProps {
  health: EngineHealth;
  playCount: number;
  artistCount: number;
}

function HeroCard({ health, playCount, artistCount }: HeroCardProps) {
  return (
    <LinearGradient
      colors={health.gradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={heroStyles.card}
    >
      <Text style={heroStyles.eyebrow}>CHAKAAS ENGINE</Text>
      <Text style={heroStyles.title}>{health.label}</Text>
      <Text style={heroStyles.description}>{health.description}</Text>

      <View style={heroStyles.progressTrack}>
        <View
          style={[heroStyles.progressFill, { width: `${health.progress * 100}%` }]}
        />
      </View>

      <View style={heroStyles.statsRow}>
        <View style={heroStyles.statBox}>
          <Text style={heroStyles.statValue}>{playCount.toLocaleString()}</Text>
          <Text style={heroStyles.statLabel}>plays logged</Text>
        </View>
        <View style={heroStyles.statBox}>
          <Text style={heroStyles.statValue}>{artistCount.toLocaleString()}</Text>
          <Text style={heroStyles.statLabel}>artists tracked</Text>
        </View>
      </View>
    </LinearGradient>
  );
}

const heroStyles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginBottom: 24,
    borderRadius: 24,
    padding: 22,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.85)',
    letterSpacing: 1.6,
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
    color: '#FFFFFF',
    marginTop: 4,
    letterSpacing: -1.0,
  },
  description: {
    fontSize: 13,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.92)',
    marginTop: 6,
    lineHeight: 18,
  },
  progressTrack: {
    marginTop: 16,
    height: 6,
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: 6,
    backgroundColor: '#FFFFFF',
    borderRadius: 3,
  },
  statsRow: {
    flexDirection: 'row',
    marginTop: 16,
    gap: 12,
  },
  statBox: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  statValue: {
    fontSize: 22,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  statLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.85)',
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});

// ─── Top artists chart ──────────────────────────────────────────────────────

interface TopArtistsProps {
  topArtists: EngineStats['topArtists'];
}

function TopArtistsChart({ topArtists }: TopArtistsProps) {
  if (topArtists.length === 0) {
    return (
      <View style={artistStyles.empty}>
        <Text style={artistStyles.emptyText}>
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
              <Text style={artistStyles.artistName} numberOfLines={1}>
                {row.artist}
              </Text>
              <Text style={artistStyles.score}>{row.score.toFixed(1)}</Text>
            </View>
            <View style={artistStyles.barTrack}>
              <View style={[artistStyles.barFill, { width: `${widthPct}%` }]} />
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
    color: '#1D1D1F',
  },
  seedBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: 'rgba(88,86,214,0.12)',
  },
  seedBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#5856D6',
    letterSpacing: 0.5,
  },
  score: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FA233B',
    minWidth: 36,
    textAlign: 'right',
  },
  barTrack: {
    height: 6,
    backgroundColor: '#F2F2F7',
    borderRadius: 3,
    overflow: 'hidden',
  },
  barFill: {
    height: 6,
    backgroundColor: '#FA233B',
    borderRadius: 3,
  },
  empty: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 13,
    color: '#8E8E93',
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
  if (loading && picks.length === 0) {
    return (
      <View style={thinkingStyles.empty}>
        <Text style={thinkingStyles.emptyText}>Composing suggestions…</Text>
      </View>
    );
  }
  if (picks.length === 0) {
    return (
      <View style={thinkingStyles.empty}>
        <Text style={thinkingStyles.emptyText}>
          Nothing new to suggest right now.
        </Text>
      </View>
    );
  }
  return (
    <View style={thinkingStyles.list}>
      {picks.slice(0, 5).map((p) => (
        <View key={p.id} style={thinkingStyles.row}>
          <View style={thinkingStyles.bullet} />
          <View style={thinkingStyles.body}>
            <Text style={thinkingStyles.title} numberOfLines={1}>
              {p.title} <Text style={thinkingStyles.dim}>· {p.author}</Text>
            </Text>
            <Text style={thinkingStyles.reason} numberOfLines={1}>
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
    backgroundColor: '#FA233B',
    marginTop: 6,
  },
  body: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1D1D1F',
  },
  dim: {
    fontWeight: '400',
    color: '#8E8E93',
  },
  reason: {
    fontSize: 12,
    color: '#8E8E93',
  },
  empty: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 13,
    color: '#8E8E93',
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
  if (events.length === 0) {
    return (
      <View style={eventStyles.empty}>
        <Text style={eventStyles.emptyText}>No plays logged yet.</Text>
      </View>
    );
  }
  return (
    <View style={eventStyles.list}>
      {events.map((e) => {
        const pct = Math.round(e.completionRatio * 100);
        const isLearn = !e.wasSkipped && e.completionRatio >= 0.3;
        return (
          <View key={e.id} style={eventStyles.row}>
            <View
              style={[
                eventStyles.signal,
                {
                  backgroundColor: isLearn
                    ? 'rgba(29,185,84,0.12)'
                    : 'rgba(142,142,147,0.12)',
                },
              ]}
            >
              <Ionicons
                name={isLearn ? 'arrow-up' : 'arrow-down'}
                size={14}
                color={isLearn ? '#1DB954' : '#8E8E93'}
              />
            </View>
            <View style={eventStyles.body}>
              <Text style={eventStyles.title} numberOfLines={1}>
                {e.title}
              </Text>
              <Text style={eventStyles.sub} numberOfLines={1}>
                {e.artist} · {formatRelativeTime(e.playedAt)}
              </Text>
            </View>
            <Text
              style={[
                eventStyles.pct,
                { color: isLearn ? '#1DB954' : '#8E8E93' },
              ]}
            >
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
  },
  body: {
    flex: 1,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1D1D1F',
  },
  sub: {
    fontSize: 12,
    color: '#8E8E93',
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
    color: '#8E8E93',
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
  return (
    <View style={mainStyles.section}>
      <Text style={mainStyles.sectionTitle}>{title}</Text>
      <View style={mainStyles.sectionCard}>{children}</View>
    </View>
  );
}

// ─── Main screen ────────────────────────────────────────────────────────────

export function ChakaasEngineScreen() {
  const navigation = useNavigation<RootStackNavigationProp<'ChakaasEngine'>>();

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
      'Wipes everything the engine has learned about your taste. The engine will start fresh and learn from your real plays — no defaults, no seeded artists. Plays already in your library are kept.',
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
      <StatusBar barStyle="dark-content" backgroundColor="#F5F5F7" />

      {/* Header */}
      <View style={mainStyles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={mainStyles.headerBtn}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="chevron-back" size={26} color="#1D1D1F" />
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
            tintColor="#FA233B"
            colors={['#FA233B']}
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
            <Ionicons name="refresh-circle" size={22} color="#FF3B30" />
            <View style={{ flex: 1 }}>
              <Text style={mainStyles.resetLabel}>Reset learning</Text>
              <Text style={mainStyles.resetSub}>
                Wipe affinity scores. Restores your original seed.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#C7C7CC" />
          </TouchableOpacity>
        </Section>
      </ScrollView>
    </View>
  );
}

const mainStyles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F5F5F7',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 56 : 36,
    paddingBottom: 12,
    paddingHorizontal: 12,
    backgroundColor: '#F5F5F7',
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
    color: '#1D1D1F',
    textAlign: 'center',
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6E6E73',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    paddingHorizontal: 24,
    marginBottom: 10,
  },
  sectionCard: {
    marginHorizontal: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: '#F2F2F7',
  },
  maintRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  maintSeparator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#F2F2F7',
    marginVertical: 12,
  },
  maintLabel: {
    fontSize: 14,
    color: '#3A3A3C',
  },
  maintValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1D1D1F',
  },
  resetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  resetLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FF3B30',
  },
  resetSub: {
    fontSize: 12,
    color: '#8E8E93',
    marginTop: 2,
  },
});
