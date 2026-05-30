/**
 * DownloadsScreen
 * ───────────────
 *
 * The new, user-controlled intelligent-download flow.
 *
 * Top-down structure:
 *   1. <StorageStatsCard />    — gold-accented card showing library cap +
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
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  StatusBar,
  TextInput,
  Alert,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { AnimatePresence, MotiView } from 'moti';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';

import { useDownloadStore, type DownloadItem } from '@/stores/downloadStore';
import { useShallow } from 'zustand/react/shallow';
import { useTheme } from '@/theme';
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
// Premium gold-accented panel — the bulk-download differentiator. Library
// fill is gold (Iron Man), storage fill is cyan (HUD telemetry).

interface StorageStatsCardProps {
  snapshot: StorageSnapshot | null;
  fitsByStorage: number;
}

function StorageStatsCard({ snapshot, fitsByStorage }: StorageStatsCardProps) {
  const { colors } = useTheme();
  const libraryPct =
    snapshot ? Math.min(1, snapshot.libraryCount / MAX_LIBRARY_SIZE) : 0;
  const usedBytes =
    snapshot ? Math.max(0, snapshot.totalBytes - snapshot.freeBytes) : 0;
  const storagePct =
    snapshot && snapshot.totalBytes > 0 ? Math.min(1, usedBytes / snapshot.totalBytes) : 0;

  const libraryBarColor =
    libraryPct >= 0.9 ? colors.danger : libraryPct >= 0.7 ? colors.gold : colors.gold;

  return (
    <View style={[statsStyles.card, { backgroundColor: colors.bgElevated, borderColor: colors.goldMuted }]}>
      {/* Library row */}
      <View style={statsStyles.row}>
        <View style={statsStyles.labelRow}>
          <Text style={[statsStyles.rowLabel, { color: colors.gold }]}>Library</Text>
          <Text style={[statsStyles.rowValue, { color: colors.textSecondary }]}>
            <Text style={[statsStyles.rowValueBold, { color: colors.textPrimary }]}>
              {snapshot ? snapshot.libraryCount.toLocaleString() : '—'}
            </Text>
            {' / '}
            {MAX_LIBRARY_SIZE.toLocaleString()}{' '}
            <Text style={[statsStyles.rowSub, { color: colors.textTertiary }]}>
              ({Math.round(libraryPct * 100)}%)
            </Text>
          </Text>
        </View>
        <View style={[statsStyles.track, { backgroundColor: colors.bgRaised }]}>
          <View
            style={[
              statsStyles.fill,
              {
                width: `${(libraryPct * 100).toFixed(1)}%` as `${number}%`,
                backgroundColor: libraryBarColor,
              },
            ]}
          />
        </View>
      </View>

      {/* Storage row */}
      <View style={statsStyles.row}>
        <View style={statsStyles.labelRow}>
          <Text style={[statsStyles.rowLabel, { color: colors.accent }]}>Storage</Text>
          <Text style={[statsStyles.rowValue, { color: colors.textSecondary }]}>
            <Text style={[statsStyles.rowValueBold, { color: colors.textPrimary }]}>
              {snapshot ? formatBytes(snapshot.freeBytes) : '—'}
            </Text>{' '}
            free of {snapshot ? formatBytes(snapshot.totalBytes) : '—'}
          </Text>
        </View>
        <View style={[statsStyles.track, { backgroundColor: colors.bgRaised }]}>
          <View
            style={[
              statsStyles.fill,
              {
                width: `${(storagePct * 100).toFixed(1)}%` as `${number}%`,
                backgroundColor: colors.accent,
              },
            ]}
          />
        </View>
      </View>

      {/* Footer */}
      <Text style={[statsStyles.footer, { color: colors.textSecondary }]}>
        ≈ {fitsByStorage.toLocaleString()} more song{fitsByStorage === 1 ? '' : 's'} fit
      </Text>
    </View>
  );
}

const statsStyles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginBottom: 18,
    padding: 16,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 14,
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
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  rowValue: {
    fontSize: 12,
    fontWeight: '400',
  },
  rowValueBold: {
    fontWeight: '700',
  },
  rowSub: {
    fontWeight: '500',
  },
  track: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  fill: {
    height: 6,
    borderRadius: 3,
  },
  footer: {
    fontSize: 12,
    fontWeight: '500',
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
  const { colors } = useTheme();
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
        style={[
          stepperStyles.btn,
          { backgroundColor: colors.bgRaised, borderColor: colors.border },
          !canDec && { opacity: 0.4 },
        ]}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        accessibilityLabel="Decrease"
        accessibilityRole="button"
      >
        <Text style={[stepperStyles.btnText, { color: canDec ? colors.accent : colors.textTertiary }]}>
          −
        </Text>
      </TouchableOpacity>

      <TextInput
        style={[
          stepperStyles.input,
          { borderColor: colors.borderAccent, backgroundColor: colors.bgRaised, color: colors.textPrimary },
        ]}
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
        style={[
          stepperStyles.btn,
          { backgroundColor: colors.bgRaised, borderColor: colors.border },
          !canInc && { opacity: 0.4 },
        ]}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        accessibilityLabel="Increase"
        accessibilityRole="button"
      >
        <Text style={[stepperStyles.btnText, { color: canInc ? colors.accent : colors.textTertiary }]}>
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
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnText: {
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 24,
  },
  input: {
    width: 80,
    height: 48,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
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
  const { colors } = useTheme();

  if (!rec) {
    return (
      <View style={[decisionStyles.card, { backgroundColor: colors.bgElevated, borderColor: colors.border }]}>
        <ActivityIndicator size="small" color={colors.accent} />
        <Text style={[decisionStyles.loading, { color: colors.textSecondary }]}>
          Checking storage and library size...
        </Text>
      </View>
    );
  }

  const totalBytes = count * AVG_TRACK_BYTES;
  const freeAfter = Math.max(0, rec.freeBytes - totalBytes);
  const exceedsRecommendation = count > rec.recommended;
  const cantDownload = rec.maxAllowed === 0;
  const findDisabled = isFinding || count === 0 || cantDownload;

  return (
    <View style={[decisionStyles.card, { backgroundColor: colors.bgElevated, borderColor: colors.border }]}>
      {/* Headline */}
      <Text style={[decisionStyles.headline, { color: colors.textPrimary }]}>
        Recommended: <Text style={{ color: colors.accent }}>{rec.recommended} songs</Text>
      </Text>
      <Text style={[decisionStyles.reason, { color: colors.textSecondary }]}>{rec.reason}</Text>

      {/* Stepper */}
      <View style={decisionStyles.stepperBlock}>
        <Text style={[decisionStyles.stepperLabel, { color: colors.textSecondary }]}>
          How many songs to download?
        </Text>
        <Stepper
          value={count}
          min={0}
          max={rec.maxAllowed}
          onChange={onCountChange}
        />
      </View>

      {/* Live size estimate */}
      <Text style={[decisionStyles.sizeEstimate, { color: colors.accent }]}>
        ≈ {formatBytes(totalBytes)} total · 320k AAC
      </Text>
      <Text style={[decisionStyles.helperText, { color: colors.textTertiary }]}>
        You can review every recommendation before anything downloads.
      </Text>

      {/* Warning when above recommendation */}
      {exceedsRecommendation && !cantDownload ? (
        <MotiView
          from={{ opacity: 0, translateY: -4 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 220 }}
          style={[decisionStyles.warning, { backgroundColor: 'rgba(255,59,71,0.12)', borderColor: 'rgba(255,59,71,0.35)' }]}
        >
          <Text style={[decisionStyles.warningText, { color: colors.danger }]}>
            Picking {count} will leave only {formatBytes(freeAfter)} free. Phone may slow down.
          </Text>
        </MotiView>
      ) : null}

      {/* Find Songs button — cyan brand gradient (interactive HUD accent) */}
      <TouchableOpacity
        onPress={onFind}
        disabled={findDisabled}
        style={[
          decisionStyles.findButton,
          findDisabled && { backgroundColor: colors.bgRaised },
        ]}
        activeOpacity={0.85}
        accessibilityLabel="Find songs"
        accessibilityRole="button"
      >
        {!findDisabled ? (
          <LinearGradient
            colors={colors.brandGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        ) : null}
        {isFinding ? (
          <ActivityIndicator size="small" color={colors.accent} />
        ) : (
          <Text
            style={[
              decisionStyles.findButtonText,
              { color: findDisabled ? colors.textTertiary : colors.bg },
            ]}
          >
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
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 14,
    alignItems: 'stretch',
  },
  loading: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 8,
  },
  headline: {
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: -0.2,
  },
  reason: {
    fontSize: 12,
    fontWeight: '400',
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
    letterSpacing: 0.2,
  },
  sizeEstimate: {
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  helperText: {
    marginTop: -6,
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 17,
  },
  warning: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  warningText: {
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 15,
  },
  findButton: {
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
    overflow: 'hidden',
  },
  findButtonText: {
    fontSize: 15,
    fontWeight: '800',
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
  const { colors } = useTheme();
  return (
    <View style={planHeaderStyles.card}>
      <Text style={[planHeaderStyles.title, { color: colors.textPrimary }]}>
        We picked these <Text style={{ color: colors.accent }}>{count}</Text> songs for you
      </Text>
      <Text style={[planHeaderStyles.subtitle, { color: colors.textSecondary }]}>
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
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 12,
    fontWeight: '500',
  },
});

// ─── Plan footer (Approve / Cancel) ───────────────────────────────────────────
// Sticky-feeling gold CTA — the premium "spend your storage" moment.

interface PlanFooterProps {
  remaining: number;
  totalBytes: number;
  onApprove: () => void;
  onCancel: () => void;
}

function PlanFooter({ remaining, totalBytes, onApprove, onCancel }: PlanFooterProps) {
  const { colors } = useTheme();
  const disabled = remaining === 0;
  return (
    <View style={footerStyles.wrap}>
      <TouchableOpacity
        onPress={onApprove}
        disabled={disabled}
        style={[footerStyles.approve, disabled && { backgroundColor: colors.bgRaised }]}
        activeOpacity={0.85}
        accessibilityLabel="Approve and download all"
        accessibilityRole="button"
      >
        {!disabled ? (
          <LinearGradient
            colors={colors.goldGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        ) : null}
        <Ionicons
          name="arrow-down-circle"
          size={18}
          color={disabled ? colors.textTertiary : '#1A1205'}
          style={footerStyles.approveIcon}
        />
        <Text style={[footerStyles.approveText, { color: disabled ? colors.textTertiary : '#1A1205' }]}>
          Approve & Download {remaining > 0 ? `${remaining} ` : ''}(≈ {formatBytes(totalBytes)})
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        onPress={onCancel}
        style={footerStyles.cancel}
        activeOpacity={0.7}
        accessibilityLabel="Cancel plan"
        accessibilityRole="button"
      >
        <Text style={[footerStyles.cancelText, { color: colors.textSecondary }]}>Cancel</Text>
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
    borderRadius: 16,
    paddingVertical: 15,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  approveIcon: {
    marginRight: 8,
  },
  approveText: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  cancel: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  cancelText: {
    fontSize: 13,
    fontWeight: '600',
  },
});

// ─── Queue empty state ────────────────────────────────────────────────────────

function QueueEmptyState() {
  const { colors } = useTheme();
  return (
    <MotiView
      from={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'timing', duration: 300 }}
      style={[emptyStyles.container, { backgroundColor: colors.bgElevated, borderColor: colors.borderAccent }]}
    >
      <View style={[emptyStyles.iconWrap, { backgroundColor: colors.accentMuted, borderColor: colors.borderAccent }]}>
        <Ionicons name="arrow-down-circle" size={28} color={colors.accent} />
      </View>
      <Text style={[emptyStyles.title, { color: colors.textPrimary }]}>Queue empty</Text>
      <Text style={[emptyStyles.subtitle, { color: colors.textSecondary }]}>
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
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    gap: 8,
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 2,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 12,
    fontWeight: '400',
    textAlign: 'center',
    lineHeight: 17,
  },
});

// ─── Active downloads badge ───────────────────────────────────────────────────

function ActiveBadge({ count }: { count: number }) {
  const { colors } = useTheme();
  if (count === 0) return null;
  return (
    <View style={[badgeStyles.pill, { backgroundColor: colors.accentMuted, borderColor: colors.borderAccent }]}>
      <Text style={[badgeStyles.text, { color: colors.accent }]}>{count}</Text>
    </View>
  );
}

const badgeStyles = StyleSheet.create({
  pill: {
    borderRadius: 999,
    minWidth: 22,
    height: 22,
    paddingHorizontal: 7,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  text: {
    fontSize: 11,
    fontWeight: '800',
    lineHeight: 13,
  },
});

// ─── Section header ───────────────────────────────────────────────────────────

interface SectionHeaderProps {
  title: string;
  right?: React.ReactNode;
}

function SectionHeader({ title, right }: SectionHeaderProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.sectionHeader}>
      <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>{title}</Text>
      {right}
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export function DownloadsScreen() {
  const { colors, isDark } = useTheme();

  // Shallow projection of the queue: only id + status. This is the render
  // driver for the active-queue FlashList. Because the selector maps to a
  // {id,status}[] compared with `useShallow`, it stays referentially stable
  // across progress ticks — the parent re-renders ONLY when queue membership
  // or a row's status changes, never on the ~4Hz progress mutations. Each
  // DownloadQueueItem self-subscribes to its own progress slice. This is the
  // fix for "scroll while bulk downloading → crash": the parent no longer
  // re-maps/relayouts every row on every tick.
  const queueRows = useDownloadStore(
    useShallow((s) => s.queue.map((i) => ({ id: i.id, status: i.status }))),
  );
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

  // Re-pull storage + recommendation whenever the screen regains focus.
  // Without this the library count + "free space" pills stay frozen on the
  // numbers we saw at mount, so a user who finishes a 50-song batch and
  // taps back here sees stale headline figures. `useFocusEffect`
  // fires after every focus event (initial AND return-to-tab).
  useFocusEffect(
    useCallback(() => {
      void refreshStorage();
      return undefined;
    }, [refreshStorage]),
  );

  // ── Derived data ───────────────────────────────────────────────────────────

  // Counts derived from the shallow status projection so they only recompute
  // when membership/status changes, not on every progress mutation.
  const activeCount = useMemo(
    () =>
      queueRows.filter((i) => i.status !== 'done' && i.status !== 'error')
        .length,
    [queueRows],
  );
  const completedCount = useMemo(
    () => queueRows.filter((i) => i.status === 'done').length,
    [queueRows],
  );

  // Plan cards used to mirror real queue progress via a queueByYtId Map
  // rebuilt every progress tick. That Map drove a `downloadStatus` /
  // `downloadProgress` prop into every SongDiscoveryCard, forcing the
  // entire plan grid to re-render at ~4Hz during a download. The cards
  // now self-subscribe to their own row in the download store instead,
  // so we only need a lightweight Set of "which videoIds are already in
  // the queue" for the plan-footer counts + dedup. Shallow selector means
  // this Set is stable across progress ticks — it only changes when the
  // queue membership changes (add/remove).
  const queuedYtIdsArr = useDownloadStore(
    useShallow((s) => s.queue.map((i) => i.youtubeId)),
  );
  const queuedYtIds = useMemo(() => new Set(queuedYtIdsArr), [queuedYtIdsArr]);

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

  // FlashList row renderer. DownloadQueueItem self-subscribes to its own
  // progress slice, so we only thread the stable id + stable onCancel.
  const renderQueueItem = useCallback(
    ({ item }: { item: { id: string; status: DownloadItem['status'] } }) => (
      <DownloadQueueItem id={item.id} onCancel={handleCancel} />
    ),
    [handleCancel],
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
        try {
          // Look up the original suggestion so we can thread Saavn metadata
          // (encrypted URL, 320kbps flag, album) through to DownloadManager —
          // without it the pipeline would try to fetch a Saavn id off YouTube.
          const suggestion = suggestions.find((s) => s.videoId === videoId);
          // If we couldn't locate the suggestion in the live array (rare —
          // could happen if a Skip storm raced this tap), bail with a clear
          // message instead of pretending we have Saavn metadata we don't.
          if (!suggestion) {
            Alert.alert('Cannot start download', 'That suggestion is no longer available. Try again.');
            return;
          }
          const result = await DownloadManager.enqueue({
            youtubeId: videoId,
            title,
            artist,
            thumbnail,
            durationMs,
            quality: '320k',
            provider: suggestion.provider ?? 'saavn',
            album: suggestion.saavnAlbum,
            saavnEncryptedUrl: suggestion.saavnEncryptedUrl,
            saavnHas320kbps: suggestion.saavnHas320kbps,
          });
          if (!result.success) {
            Alert.alert('Cannot start download', result.reason ?? 'Please try again.');
          }
        } catch (err) {
          // Catch-all so a thrown DB / native error never escapes the touch
          // handler and crashes the app. Surface a friendly toast instead.
          console.warn('[DownloadsScreen] enqueue (single) threw', err);
          Alert.alert(
            'Download queue issue',
            'Could not start that download. Please try again.',
          );
        }
      })();
    },
    [suggestions],
  );

  // ── Plan: approve all ──────────────────────────────────────────────────────

  const handlePlanApprove = useCallback(async () => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    // Hand the entire approval set to DownloadManager in one bulk call.
    // The manager dedupes against the queue and library, respects the
    // 1500-song cap, and starts the worker pool — all in a single
    // transaction. UI stays responsive even for 1200-song approvals.
    const toEnqueue = suggestions.filter((s) => !queuedYtIds.has(s.videoId));
    if (toEnqueue.length === 0) {
      setSuggestions([]);
      setFlow('decision');
      void refreshStorage();
      return;
    }

    try {
      const result = await DownloadManager.enqueueBatch(
        toEnqueue.map((s) => ({
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
        })),
      );

      if (result.rejected > 0 && result.reason) {
        Alert.alert(
          'Some songs could not be queued',
          `${result.accepted} added · ${result.skipped} already in library · ${result.reason}`,
        );
      } else if (result.accepted === 0 && result.skipped > 0) {
        Alert.alert(
          'Already in your library',
          'All approved songs are already downloaded or queued.',
        );
      }
    } catch (err) {
      console.warn('[DownloadsScreen] enqueueBatch failed', err);
      Alert.alert('Download queue issue', 'Could not queue these songs. Please try again.');
      return;
    }

    setSuggestions([]);
    setFlow('decision');
    void refreshStorage();
  }, [suggestions, queuedYtIds, refreshStorage]);

  // ── Plan: cancel ───────────────────────────────────────────────────────────

  const handlePlanCancel = useCallback(() => {
    void Haptics.selectionAsync();
    setSuggestions([]);
    setFlow('decision');
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────
  // (getCardStatus is gone — each SongDiscoveryCard self-subscribes to its
  // own row in the download queue, so the parent doesn't need to compute
  // per-card status on every render.)
  //
  // The screen is a single FlashList that VIRTUALISES the active queue. The
  // stats / decision / plan-review chrome lives in ListHeaderComponent (it is
  // not a list, so plain mapped cards are fine there). The active queue itself
  // can hold up to 1500 rows during a bulk download, so it MUST be virtualised
  // — the old "ScrollView + queue.map wrapped in Reanimated layout worklets"
  // mounted every row at once and was the source of the scroll-while-
  // downloading crash. FlashList owns row lifecycle now (no per-row
  // entering/exiting/Layout worklets, which conflict with recycling anyway).

  const listHeader = (
    <>
      {/* Screen title */}
      <View style={styles.screenHeader}>
        <Text style={[styles.screenTitle, { color: colors.textPrimary }]}>Downloads</Text>
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
            {suggestions.map((s) => (
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
                onSkip={handlePlanSkip}
                rationale={s.rationale}
                estimatedSizeReadable={s.estimatedSizeReadable}
              />
            ))}
          </AnimatePresence>

          <PlanFooter
            remaining={suggestions.filter(
              (s) => !queuedYtIds.has(s.videoId),
            ).length}
            totalBytes={suggestions
              .filter((s) => !queuedYtIds.has(s.videoId))
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
            <View style={[styles.errorBox, { backgroundColor: colors.bgElevated, borderColor: 'rgba(255,59,71,0.25)' }]}>
              <View style={[styles.errorIconWrap, { backgroundColor: 'rgba(255,59,71,0.12)' }]}>
                <Ionicons name="cloud-offline" size={23} color={colors.danger} />
              </View>
              <Text style={[styles.errorText, { color: colors.textSecondary }]}>{flowError}</Text>
              <TouchableOpacity
                onPress={handleFindSongs}
                style={[styles.retryBtn, { backgroundColor: colors.bgRaised, borderColor: colors.borderAccent }]}
                activeOpacity={0.8}
              >
                <Text style={[styles.retryText, { color: colors.accent }]}>Try again</Text>
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
                <Text style={[styles.clearBtn, { color: colors.accent }]}>Clear Completed</Text>
              </TouchableOpacity>
            )}
          </View>
        }
      />
    </>
  );

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.bg} />

      <FlashList
        data={queueRows}
        renderItem={renderQueueItem}
        keyExtractor={(i) => i.id}
        extraData={queueRows}
        estimatedItemSize={96}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={<QueueEmptyState />}
        ListFooterComponent={<View style={styles.bottomSpacer} />}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      />
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
// Layout/geometry only — colours themed inline via useTheme().

const styles = StyleSheet.create({
  root: {
    flex: 1,
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
    fontWeight: '800',
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
    fontWeight: '700',
  },

  // Error box
  errorBox: {
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    gap: 8,
  },
  errorIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 18,
  },
  retryBtn: {
    marginTop: 4,
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  retryText: {
    fontSize: 13,
    fontWeight: '700',
  },

  bottomSpacer: {
    height: 100,
  },
});
