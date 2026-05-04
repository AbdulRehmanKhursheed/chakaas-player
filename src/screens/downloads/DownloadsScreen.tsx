/**
 * DownloadsScreen
 * ───────────────
 *
 * The new, user-controlled intelligent-download flow.
 *
 * Top-down structure:
 *   1. <StorageStatsCard />    — accent card showing library cap +
 *                                device free space (animated bars).
 *   2. <DownloadDecisionCard /> — the stepper / number-input flow.
 *                                Pick how many songs you want; tap
 *                                "Find Songs" to run the ranking pipeline.
 *   3. Plan review section     — the curated list. Each card has Skip
 *                                (auto-fetches a replacement to keep the
 *                                count constant) and 320k action (enqueues just
 *                                that one). "Approve & Download All" enqueues
 *                                every remaining card.
 *   4. <DownloadQueueItem />   — live progress for the active download queue.
 *
 * No download starts without explicit user action. Every byte the user spends
 * is shown to them up-front via the size estimates in step 2 and the
 * per-card "≈ N MB" caption in step 3.
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ActivityIndicator,
  StatusBar,
  TextInput,
  Alert,
} from 'react-native';
import Animated, {
  FadeInDown,
  FadeOutUp,
  Layout,
} from 'react-native-reanimated';
import { AnimatePresence, MotiView } from 'moti';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';

import { useDownloadStore } from '@/stores/downloadStore';
import { DownloadManager, MAX_LIBRARY_SIZE } from '@/features/download/DownloadManager';
import {
  buildDownloadCandidates,
  getReplacementSuggestion,
  type DownloadSuggestion,
} from '@/features/recommendations/IntelligentDownloader';
import {
  AVG_TRACK_BYTES,
  formatBytes,
  getRecommendedDownloadCount,
  getStorageInfo,
  getLibrarySpaceInfo,
  type RecommendedDownloadInfo,
} from '@/services/storage/StorageEstimator';

import { DownloadQueueItem } from './components/DownloadQueueItem';
import { SongDiscoveryCard } from './components/SongDiscoveryCard';

// ─── Types ────────────────────────────────────────────────────────────────────

type FlowState =
  /** Decision card visible; user has not yet hit Find Songs. */
  | 'decision'
  /** Find Songs is running. */
  | 'finding'
  /** Plan review visible; suggestions array populated. */
  | 'plan'
  /** Find Songs failed. */
  | 'error';

interface StorageSnapshot {
  /** Library track count. */
  libraryCount: number;
  /** Total device storage in bytes. */
  totalBytes: number;
  /** Free device storage in bytes. */
  freeBytes: number;
}

// ─── StorageStatsCard ─────────────────────────────────────────────────────────

interface StorageStatsCardProps {
  snapshot: StorageSnapshot | null;
  fitsByStorage: number;
}

function StorageStatsCard({ snapshot, fitsByStorage }: StorageStatsCardProps) {
  const libraryPct =
    snapshot ? Math.min(1, snapshot.libraryCount / MAX_LIBRARY_SIZE) : 0;
  const usedBytes =
    snapshot ? Math.max(0, snapshot.totalBytes - snapshot.freeBytes) : 0;
  const storagePct =
    snapshot && snapshot.totalBytes > 0 ? Math.min(1, usedBytes / snapshot.totalBytes) : 0;

  const libraryBarColor =
    libraryPct >= 0.9 ? '#E74C3C' : libraryPct >= 0.7 ? '#F39C12' : '#FA233B';

  return (
    <View style={statsStyles.card}>
      {/* Library row */}
      <View style={statsStyles.row}>
        <View style={statsStyles.labelRow}>
          <Text style={statsStyles.rowLabel}>Library</Text>
          <Text style={statsStyles.rowValue}>
            <Text style={statsStyles.rowValueBold}>
              {snapshot ? snapshot.libraryCount.toLocaleString() : '—'}
            </Text>
            {' / '}
            {MAX_LIBRARY_SIZE.toLocaleString()}{' '}
            <Text style={statsStyles.rowSub}>
              ({Math.round(libraryPct * 100)}%)
            </Text>
          </Text>
        </View>
        <View style={statsStyles.track}>
          <MotiView
            animate={{ width: `${(libraryPct * 100).toFixed(1)}%` as any }}
            transition={{ type: 'timing', duration: 600 }}
            style={[statsStyles.fill, { backgroundColor: libraryBarColor }]}
          />
        </View>
      </View>

      {/* Storage row */}
      <View style={statsStyles.row}>
        <View style={statsStyles.labelRow}>
          <Text style={statsStyles.rowLabel}>Storage</Text>
          <Text style={statsStyles.rowValue}>
            <Text style={statsStyles.rowValueBold}>
              {snapshot ? formatBytes(snapshot.freeBytes) : '—'}
            </Text>{' '}
            free of {snapshot ? formatBytes(snapshot.totalBytes) : '—'}
          </Text>
        </View>
        <View style={statsStyles.track}>
          <MotiView
            animate={{ width: `${(storagePct * 100).toFixed(1)}%` as any }}
            transition={{ type: 'timing', duration: 600 }}
            style={[statsStyles.fill, { backgroundColor: '#3498DB' }]}
          />
        </View>
      </View>

      {/* Footer */}
      <Text style={statsStyles.footer}>
        ≈ {fitsByStorage.toLocaleString()} more song{fitsByStorage === 1 ? '' : 's'} fit
      </Text>
    </View>
  );
}

const statsStyles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginBottom: 18,
    padding: 14,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.35)',
    gap: 14,
    ...Platform.select({
      ios: {
        shadowColor: '#FA233B',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 8,
      },
      android: { elevation: 2 },
    }),
  },
  row: {
    gap: 6,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  rowLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FA233B',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  rowValue: {
    fontSize: 12,
    color: '#6E6E73',
    fontWeight: '400',
  },
  rowValueBold: {
    fontWeight: '700',
    color: '#1D1D1F',
  },
  rowSub: {
    color: '#8E8E93',
    fontWeight: '500',
  },
  track: {
    height: 5,
    backgroundColor: '#F2F2F7',
    borderRadius: 3,
    overflow: 'hidden',
  },
  fill: {
    height: 5,
    borderRadius: 3,
  },
  footer: {
    fontSize: 12,
    fontWeight: '500',
    color: '#6E6E73',
    marginTop: 2,
  },
});

// ─── Stepper input ────────────────────────────────────────────────────────────

interface StepperProps {
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}

function Stepper({ value, min, max, onChange }: StepperProps) {
  const [text, setText] = useState(String(value));

  // Keep the input in sync with the controlled value when callers change it.
  useEffect(() => {
    setText(String(value));
  }, [value]);

  const clamp = useCallback(
    (n: number) => Math.max(min, Math.min(max, n)),
    [min, max],
  );

  const decrement = useCallback(() => {
    void Haptics.selectionAsync();
    onChange(clamp(value - 1));
  }, [value, clamp, onChange]);

  const increment = useCallback(() => {
    void Haptics.selectionAsync();
    onChange(clamp(value + 1));
  }, [value, clamp, onChange]);

  const handleSubmit = useCallback(() => {
    const n = parseInt(text, 10);
    if (Number.isFinite(n)) {
      onChange(clamp(n));
    } else {
      setText(String(value));
    }
  }, [text, value, clamp, onChange]);

  const canDec = value > min;
  const canInc = value < max;

  return (
    <View style={stepperStyles.row}>
      <TouchableOpacity
        onPress={decrement}
        disabled={!canDec}
        style={[stepperStyles.btn, !canDec && stepperStyles.btnDisabled]}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        accessibilityLabel="Decrease"
        accessibilityRole="button"
      >
        <Text style={[stepperStyles.btnText, !canDec && stepperStyles.btnTextDisabled]}>
          −
        </Text>
      </TouchableOpacity>

      <TextInput
        style={stepperStyles.input}
        value={text}
        keyboardType="number-pad"
        onChangeText={setText}
        onBlur={handleSubmit}
        onSubmitEditing={handleSubmit}
        selectTextOnFocus
        maxLength={3}
        accessibilityLabel="Number of songs"
      />

      <TouchableOpacity
        onPress={increment}
        disabled={!canInc}
        style={[stepperStyles.btn, !canInc && stepperStyles.btnDisabled]}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        accessibilityLabel="Increase"
        accessibilityRole="button"
      >
        <Text style={[stepperStyles.btnText, !canInc && stepperStyles.btnTextDisabled]}>
          +
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const stepperStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  btn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F2F2F7',
    borderWidth: 1,
    borderColor: '#D2D2D7',
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnDisabled: {
    backgroundColor: '#0E0E0E',
    borderColor: '#F2F2F7',
  },
  btnText: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FA233B',
    lineHeight: 24,
  },
  btnTextDisabled: {
    color: '#C7C7CC',
  },
  input: {
    width: 80,
    height: 48,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#D2D2D7',
    backgroundColor: '#FFFFFF',
    color: '#1D1D1F',
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
    paddingVertical: 0,
  },
});

// ─── DownloadDecisionCard ─────────────────────────────────────────────────────

interface DownloadDecisionCardProps {
  rec: RecommendedDownloadInfo | null;
  count: number;
  onCountChange: (n: number) => void;
  onFind: () => void;
  isFinding: boolean;
}

function DownloadDecisionCard({
  rec,
  count,
  onCountChange,
  onFind,
  isFinding,
}: DownloadDecisionCardProps) {
  if (!rec) {
    return (
      <View style={decisionStyles.card}>
        <ActivityIndicator size="small" color="#FA233B" />
        <Text style={decisionStyles.loading}>Checking storage and library size...</Text>
      </View>
    );
  }

  const totalBytes = count * AVG_TRACK_BYTES;
  const freeAfter = Math.max(0, rec.freeBytes - totalBytes);
  const exceedsRecommendation = count > rec.recommended;
  const cantDownload = rec.maxAllowed === 0;

  return (
    <View style={decisionStyles.card}>
      {/* Headline */}
      <Text style={decisionStyles.headline}>
        Recommended: <Text style={decisionStyles.headlineAccent}>{rec.recommended} songs</Text>
      </Text>
      <Text style={decisionStyles.reason}>{rec.reason}</Text>

      {/* Stepper */}
      <View style={decisionStyles.stepperBlock}>
        <Text style={decisionStyles.stepperLabel}>How many songs to download?</Text>
        <Stepper
          value={count}
          min={0}
          max={rec.maxAllowed}
          onChange={onCountChange}
        />
      </View>

      {/* Live size estimate */}
      <Text style={decisionStyles.sizeEstimate}>
        ≈ {formatBytes(totalBytes)} total · 320k AAC
      </Text>
      <Text style={decisionStyles.helperText}>
        You can review every recommendation before anything downloads.
      </Text>

      {/* Warning when above recommendation */}
      {exceedsRecommendation && !cantDownload ? (
        <MotiView
          from={{ opacity: 0, translateY: -4 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 220 }}
          style={decisionStyles.warning}
        >
          <Text style={decisionStyles.warningText}>
            Picking {count} will leave only {formatBytes(freeAfter)} free. Phone may slow down.
          </Text>
        </MotiView>
      ) : null}

      {/* Find Songs button */}
      <TouchableOpacity
        onPress={onFind}
        disabled={isFinding || count === 0 || cantDownload}
        style={[
          decisionStyles.findButton,
          (isFinding || count === 0 || cantDownload) && decisionStyles.findButtonDisabled,
        ]}
        activeOpacity={0.85}
        accessibilityLabel="Find songs"
        accessibilityRole="button"
      >
        {isFinding ? (
          <ActivityIndicator size="small" color="#FFFFFF" />
        ) : (
          <Text style={decisionStyles.findButtonText}>
            {cantDownload ? 'No room to download' : count === 0 ? 'Pick a number first' : 'Find Songs'}
          </Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const decisionStyles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginBottom: 22,
    padding: 18,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(60,60,67,0.10)',
    gap: 14,
    alignItems: 'stretch',
  },
  loading: {
    fontSize: 12,
    color: '#8E8E93',
    textAlign: 'center',
    marginTop: 8,
  },
  headline: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1D1D1F',
    textAlign: 'center',
    letterSpacing: -0.2,
  },
  headlineAccent: {
    color: '#FA233B',
  },
  reason: {
    fontSize: 12,
    fontWeight: '400',
    color: '#6E6E73',
    textAlign: 'center',
    lineHeight: 17,
  },
  stepperBlock: {
    alignItems: 'center',
    gap: 10,
    marginTop: 6,
  },
  stepperLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6E6E73',
    letterSpacing: 0.2,
  },
  sizeEstimate: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FA233B',
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  helperText: {
    marginTop: -6,
    fontSize: 12,
    fontWeight: '500',
    color: '#8E8E93',
    textAlign: 'center',
    lineHeight: 17,
  },
  warning: {
    backgroundColor: 'rgba(231,76,60,0.12)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(231,76,60,0.35)',
  },
  warningText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#E74C3C',
    textAlign: 'center',
    lineHeight: 15,
  },
  findButton: {
    backgroundColor: '#FA233B',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
    ...Platform.select({
      ios: {
        shadowColor: '#FA233B',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 12,
      },
      android: { elevation: 5 },
    }),
  },
  findButtonDisabled: {
    backgroundColor: '#F2F2F7',
  },
  findButtonText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
});

// ─── Plan review header ───────────────────────────────────────────────────────

interface PlanHeaderProps {
  count: number;
  totalBytes: number;
  reason: string;
}

function PlanHeader({ count, totalBytes, reason }: PlanHeaderProps) {
  return (
    <View style={planHeaderStyles.card}>
      <Text style={planHeaderStyles.title}>
        We picked these <Text style={planHeaderStyles.titleAccent}>{count}</Text> songs for you
      </Text>
      <Text style={planHeaderStyles.subtitle}>
        ≈ {formatBytes(totalBytes)} total · {reason}
      </Text>
    </View>
  );
}

const planHeaderStyles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginBottom: 12,
    paddingVertical: 6,
    gap: 4,
  },
  title: {
    fontSize: 17,
    fontWeight: '800',
    color: '#1D1D1F',
    letterSpacing: -0.3,
  },
  titleAccent: {
    color: '#FA233B',
  },
  subtitle: {
    fontSize: 12,
    fontWeight: '500',
    color: '#6E6E73',
  },
});

// ─── Plan footer (Approve / Cancel) ───────────────────────────────────────────

interface PlanFooterProps {
  remaining: number;
  totalBytes: number;
  onApprove: () => void;
  onCancel: () => void;
}

function PlanFooter({ remaining, totalBytes, onApprove, onCancel }: PlanFooterProps) {
  return (
    <View style={footerStyles.wrap}>
      <TouchableOpacity
        onPress={onApprove}
        disabled={remaining === 0}
        style={[footerStyles.approve, remaining === 0 && footerStyles.approveDisabled]}
        activeOpacity={0.85}
        accessibilityLabel="Approve and download all"
        accessibilityRole="button"
      >
        <Text style={footerStyles.approveText}>
          Approve & Download {remaining > 0 ? `${remaining} ` : ''}({formatBytes(totalBytes)})
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        onPress={onCancel}
        style={footerStyles.cancel}
        activeOpacity={0.7}
        accessibilityLabel="Cancel plan"
        accessibilityRole="button"
      >
        <Text style={footerStyles.cancelText}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );
}

const footerStyles = StyleSheet.create({
  wrap: {
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 6,
    gap: 10,
  },
  approve: {
    backgroundColor: '#FA233B',
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#FA233B',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 12,
      },
      android: { elevation: 5 },
    }),
  },
  approveDisabled: {
    backgroundColor: '#F2F2F7',
  },
  approveText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
  cancel: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  cancelText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6E6E73',
  },
});

// ─── Queue empty state ────────────────────────────────────────────────────────

function QueueEmptyState() {
  return (
    <MotiView
      from={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'timing', duration: 300 }}
      style={emptyStyles.container}
    >
      <Ionicons name="arrow-down-circle" size={32} color="#FA233B" />
      <Text style={emptyStyles.title}>Queue empty</Text>
      <Text style={emptyStyles.subtitle}>
        Approved songs will appear here while downloading
      </Text>
    </MotiView>
  );
}

const emptyStyles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginVertical: 8,
    paddingVertical: 28,
    paddingHorizontal: 20,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#F2F2F7',
    borderStyle: 'dashed',
    alignItems: 'center',
    gap: 6,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: '#8E8E93',
  },
  subtitle: {
    fontSize: 12,
    fontWeight: '400',
    color: '#8E8E93',
    textAlign: 'center',
    lineHeight: 17,
  },
});

// ─── Active downloads badge ───────────────────────────────────────────────────

function ActiveBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <View style={badgeStyles.pill}>
      <Text style={badgeStyles.text}>{count}</Text>
    </View>
  );
}

const badgeStyles = StyleSheet.create({
  pill: {
    backgroundColor: '#FA233B',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  text: {
    fontSize: 11,
    fontWeight: '800',
    color: '#FFFFFF',
    lineHeight: 13,
  },
});

// ─── Section header ───────────────────────────────────────────────────────────

interface SectionHeaderProps {
  title: string;
  right?: React.ReactNode;
}

function SectionHeader({ title, right }: SectionHeaderProps) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {right}
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export function DownloadsScreen() {
  const queue          = useDownloadStore((s) => s.queue);
  const clearCompleted = useDownloadStore((s) => s.clearCompleted);
  const removeItem     = useDownloadStore((s) => s.removeItem);

  // Storage / recommendation snapshot
  const [snapshot, setSnapshot]       = useState<StorageSnapshot | null>(null);
  const [rec, setRec]                 = useState<RecommendedDownloadInfo | null>(null);

  // User-controlled count
  const [count, setCount]             = useState<number>(0);

  // Flow state
  const [flow, setFlow]               = useState<FlowState>('decision');
  const [flowError, setFlowError]     = useState<string | null>(null);

  // Plan suggestions + status keyed by videoId
  const [suggestions, setSuggestions] = useState<DownloadSuggestion[]>([]);
  const [planReason, setPlanReason]   = useState<string>('');

  // ── Initial load: storage + library + recommendation ──────────────────────

  const refreshStorage = useCallback(async () => {
    try {
      const [{ totalBytes, freeBytes }, libInfo, recInfo] = await Promise.all([
        getStorageInfo(),
        getLibrarySpaceInfo(MAX_LIBRARY_SIZE),
        getRecommendedDownloadCount(MAX_LIBRARY_SIZE),
      ]);
      setSnapshot({
        libraryCount: libInfo.trackCount,
        totalBytes,
        freeBytes,
      });
      setRec(recInfo);
      // Auto-default the stepper to the recommendation when we haven't
      // landed on a non-zero user value yet.
      setCount((prev) => (prev === 0 ? recInfo.recommended : prev));
    } catch (err) {
      // Graceful — leave snapshot null so the card shows a placeholder.
      console.warn('[DownloadsScreen] storage refresh failed', err);
    }
  }, []);

  useEffect(() => {
    void refreshStorage();
  }, [refreshStorage]);

  // ── Derived data ───────────────────────────────────────────────────────────

  const activeCount    = queue.filter(
    (i) => i.status !== 'done' && i.status !== 'error',
  ).length;
  const completedCount = queue.filter((i) => i.status === 'done').length;

  // Build a lookup so plan cards can mirror real queue progress.
  const queueByYtId = useMemo(
    () => new Map(queue.map((i) => [i.youtubeId, i])),
    [queue],
  );

  const planTotalBytes = suggestions.reduce(
    (sum, s) => sum + s.estimatedBytes,
    0,
  );

  // ── Queue actions ──────────────────────────────────────────────────────────

  const handleClearCompleted = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    clearCompleted();
  }, [clearCompleted]);

  const handleCancel = useCallback(
    (id: string) => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      removeItem(id);
    },
    [removeItem],
  );

  // ── Find Songs ─────────────────────────────────────────────────────────────

  const handleFindSongs = useCallback(async () => {
    if (count <= 0) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setFlow('finding');
    setFlowError(null);
    try {
      const list = await buildDownloadCandidates(count);
      if (list.length === 0) {
        setFlow('error');
        setFlowError('No songs found from YouTube right now. Check your connection and try again.');
        return;
      }
      setSuggestions(list);
      setPlanReason(
        rec?.reason ?? `Based on your last 14 days of listening`,
      );
      setFlow('plan');
    } catch (err) {
      setFlow('error');
      setFlowError(err instanceof Error ? err.message : 'Search failed');
    }
  }, [count, rec]);

  // ── Plan: skip-and-replace ─────────────────────────────────────────────────

  const handlePlanSkip = useCallback(
    async (videoId: string) => {
      void Haptics.selectionAsync();
      // Drop the skipped card immediately, then try to fetch a replacement.
      const remaining = suggestions.filter((s) => s.videoId !== videoId);
      const exclude = [
        ...remaining.map((s) => s.videoId),
        videoId,
      ];
      try {
        const replacement = await getReplacementSuggestion(exclude);
        if (replacement) {
          setSuggestions([...remaining, replacement]);
        } else {
          setSuggestions(remaining);
        }
      } catch {
        setSuggestions(remaining);
      }
    },
    [suggestions],
  );

  // ── Plan: enqueue a single card ───────────────────────────────────────────

  const handlePlanDownloadOne = useCallback(
    (
      videoId: string,
      title: string,
      artist: string,
      thumbnail: string,
      durationMs: number,
    ) => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      void (async () => {
        // Look up the original suggestion so we can thread Saavn metadata
        // (encrypted URL, 320kbps flag, album) through to DownloadManager —
        // without it the pipeline would try to fetch a Saavn id off YouTube.
        const suggestion = suggestions.find((s) => s.videoId === videoId);
        const result = await DownloadManager.enqueue({
          youtubeId: videoId,
          title,
          artist,
          thumbnail,
          durationMs,
          quality: '320k',
          provider: suggestion?.provider ?? 'saavn',
          album: suggestion?.saavnAlbum,
          saavnEncryptedUrl: suggestion?.saavnEncryptedUrl,
          saavnHas320kbps: suggestion?.saavnHas320kbps,
        });
        if (!result.success) {
          Alert.alert('Cannot start download', result.reason ?? 'Please try again.');
        }
      })();
    },
    [suggestions],
  );

  // ── Plan: approve all ──────────────────────────────────────────────────────

  const handlePlanApprove = useCallback(async () => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    // Enqueue every suggestion that isn't already in the queue or library.
    let failedReason: string | null = null;
    for (const s of suggestions) {
      const already = queueByYtId.has(s.videoId);
      if (already) continue;
      try {
        const result = await DownloadManager.enqueue({
          youtubeId: s.videoId,
          title: s.title,
          artist: s.artist,
          thumbnail: s.thumbnail,
          durationMs: s.duration_ms,
          quality: '320k',
          provider: s.provider,
          album: s.saavnAlbum,
          saavnEncryptedUrl: s.saavnEncryptedUrl,
          saavnHas320kbps: s.saavnHas320kbps,
        });
        if (!result.success) {
          failedReason = result.reason ?? 'Some songs could not be queued.';
          break;
        }
      } catch (err) {
        console.warn('[DownloadsScreen] enqueue failed', err);
        failedReason = 'Some songs could not be queued.';
        break;
      }
    }

    if (failedReason) {
      Alert.alert('Download queue issue', failedReason);
      return;
    }

    // Reset to the decision card so the user can refresh storage figures
    // and queue another batch.
    setSuggestions([]);
    setFlow('decision');
    void refreshStorage();
  }, [suggestions, queueByYtId, refreshStorage]);

  // ── Plan: cancel ───────────────────────────────────────────────────────────

  const handlePlanCancel = useCallback(() => {
    void Haptics.selectionAsync();
    setSuggestions([]);
    setFlow('decision');
  }, []);

  // ── Per-card status (mirrors live queue if already enqueued) ──────────────

  function getCardStatus(
    videoId: string,
  ): { status: 'idle' | 'downloading' | 'done'; progress: number } {
    const q = queueByYtId.get(videoId);
    if (q) {
      return {
        status: q.status === 'done' ? 'done' : 'downloading',
        progress: q.progress,
      };
    }
    return { status: 'idle', progress: 0 };
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor="#F5F5F7" />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Screen title */}
        <View style={styles.screenHeader}>
          <Text style={styles.screenTitle}>Downloads</Text>
        </View>

        {/* ════════════════════════════════════════════════
            1. Storage Stats Card
        ════════════════════════════════════════════════ */}
        <StorageStatsCard
          snapshot={snapshot}
          fitsByStorage={rec?.fitsByStorage ?? 0}
        />

        {/* ════════════════════════════════════════════════
            2. Decision Card  (or  3. Plan Review)
        ════════════════════════════════════════════════ */}
        {flow === 'plan' ? (
          <>
            <PlanHeader
              count={suggestions.length}
              totalBytes={planTotalBytes}
              reason={planReason}
            />

            <AnimatePresence>
              {suggestions.map((s) => {
                const { status, progress } = getCardStatus(s.videoId);
                return (
                  <SongDiscoveryCard
                    key={s.videoId}
                    result={{
                      id: s.videoId,
                      title: s.title,
                      author: s.artist,
                      duration_ms: s.duration_ms,
                      thumbnail: s.thumbnail,
                      view_count: '',
                    }}
                    onDownload={handlePlanDownloadOne}
                    onSkip={() => handlePlanSkip(s.videoId)}
                    downloadStatus={status}
                    downloadProgress={progress}
                    rationale={s.rationale}
                    estimatedSizeReadable={s.estimatedSizeReadable}
                  />
                );
              })}
            </AnimatePresence>

            <PlanFooter
              remaining={suggestions.filter(
                (s) => !queueByYtId.has(s.videoId),
              ).length}
              totalBytes={suggestions
                .filter((s) => !queueByYtId.has(s.videoId))
                .reduce((sum, s) => sum + s.estimatedBytes, 0)}
              onApprove={handlePlanApprove}
              onCancel={handlePlanCancel}
            />
          </>
        ) : (
          <>
            <DownloadDecisionCard
              rec={rec}
              count={count}
              onCountChange={setCount}
              onFind={handleFindSongs}
              isFinding={flow === 'finding'}
            />

            {flow === 'error' && flowError ? (
              <View style={styles.errorBox}>
                <View style={styles.errorIconWrap}>
                  <Ionicons name="cloud-offline" size={23} color="#FA233B" />
                </View>
                <Text style={styles.errorText}>{flowError}</Text>
                <TouchableOpacity
                  onPress={handleFindSongs}
                  style={styles.retryBtn}
                  activeOpacity={0.8}
                >
                  <Text style={styles.retryText}>Try again</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </>
        )}

        {/* ════════════════════════════════════════════════
            4. Active queue
        ════════════════════════════════════════════════ */}
        <SectionHeader
          title="Download Queue"
          right={
            <View style={styles.queueHeaderRight}>
              <ActiveBadge count={activeCount} />
              {completedCount > 0 && (
                <TouchableOpacity
                  onPress={handleClearCompleted}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityLabel="Clear completed downloads"
                  accessibilityRole="button"
                >
                  <Text style={styles.clearBtn}>Clear Completed</Text>
                </TouchableOpacity>
              )}
            </View>
          }
        />

        {queue.length === 0 ? (
          <QueueEmptyState />
        ) : (
          <AnimatePresence>
            {queue.map((item) => (
              <Animated.View
                key={item.id}
                entering={FadeInDown.duration(250).springify()}
                exiting={FadeOutUp.duration(200)}
                layout={Layout.springify().damping(18)}
              >
                <DownloadQueueItem
                  item={item}
                  onCancel={() => handleCancel(item.id)}
                />
              </Animated.View>
            ))}
          </AnimatePresence>
        )}

        {/* Bottom padding — leaves room for the mini player */}
        <View style={styles.bottomSpacer} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F5F5F7',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 4,
  },

  // Screen title
  screenHeader: {
    paddingHorizontal: 16,
    paddingBottom: 18,
    paddingTop: 4,
  },
  screenTitle: {
    fontSize: 32,
    fontWeight: '800',
    color: '#1D1D1F',
    letterSpacing: -0.8,
    lineHeight: 36,
  },

  // Section headers
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginTop: 14,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1D1D1F',
    letterSpacing: -0.3,
  },

  // Queue header right cluster
  queueHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  clearBtn: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6E6E73',
  },

  // Error box
  errorBox: {
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    borderRadius: 18,
    backgroundColor: '#FFF1F2',
    borderWidth: 1,
    borderColor: 'rgba(250,35,59,0.18)',
    alignItems: 'center',
    gap: 8,
  },
  errorIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(250,35,59,0.10)',
  },
  errorText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#3A3A3C',
    textAlign: 'center',
    lineHeight: 18,
  },
  retryBtn: {
    marginTop: 4,
    paddingHorizontal: 18,
    paddingVertical: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(250,35,59,0.18)',
  },
  retryText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FA233B',
  },

  bottomSpacer: {
    height: 100,
  },
});
