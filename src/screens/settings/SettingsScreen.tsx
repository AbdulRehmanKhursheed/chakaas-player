import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Platform,
  StatusBar,
  Alert,
  Switch,
  Pressable,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import {
  getStorageStats,
  getArtworkDir,
} from '@/services/storage/fileSystem';
import RNBlobUtil from 'react-native-blob-util';
import { Ionicons } from '@expo/vector-icons';
import type { RootStackNavigationProp } from '@/types/navigation';
import { useSettingsStore } from '@/stores/settingsStore';
import { useUIStore } from '@/stores/uiStore';
import { useTheme, type Theme } from '@/theme';
import { cleanupVoiceNotesAndClips } from '@/db/cleanup';
import { CrashLogsModal } from './CrashLogsModal';
import { crashSink } from '@/utils/crashSink';

// ─── Section wrapper ──────────────────────────────────────────────────────────

interface SectionProps {
  title: string;
  children: React.ReactNode;
}

function Section({ title, children }: SectionProps) {
  const { colors } = useTheme();
  return (
    <View style={sectionStyles.container}>
      <Text style={[sectionStyles.title, { color: colors.textTertiary }]}>{title}</Text>
      <View
        style={[
          sectionStyles.card,
          { backgroundColor: colors.bgElevated, borderColor: colors.borderAccent },
        ]}
      >
        {children}
      </View>
    </View>
  );
}

const sectionStyles = StyleSheet.create({
  container: {
    marginBottom: 28,
  },
  title: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  card: {
    marginHorizontal: 16,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
});

// ─── Row components ───────────────────────────────────────────────────────────

function Separator() {
  const { colors } = useTheme();
  return <View style={[rowStyles.separator, { backgroundColor: colors.border }]} />;
}

interface TapRowProps {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  sublabel?: string;
  onPress: () => void;
  destructive?: boolean;
  detail?: string;
}

function TapRow({ icon, label, sublabel, onPress, destructive = false, detail }: TapRowProps) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity
      style={rowStyles.container}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons
        name={icon}
        size={20}
        color={destructive ? colors.danger : colors.accent}
        style={rowStyles.icon}
      />
      <View style={rowStyles.tapBody}>
        <View style={{ flex: 1 }}>
          <Text style={[rowStyles.label, { color: destructive ? colors.danger : colors.textPrimary }]}>
            {label}
          </Text>
          {sublabel && <Text style={[rowStyles.sublabel, { color: colors.textSecondary }]}>{sublabel}</Text>}
        </View>
        {detail && <Text style={[rowStyles.detail, { color: colors.textSecondary }]}>{detail}</Text>}
        <Text style={[rowStyles.chevron, { color: colors.textTertiary }]}>›</Text>
      </View>
    </TouchableOpacity>
  );
}

const rowStyles = StyleSheet.create({
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 52,
  },
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
    minHeight: 56,
  },
  icon: {
    width: 28,
    textAlign: 'center',
    marginTop: 1,
  },
  tapBody: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  label: {
    fontSize: 15,
    fontWeight: '500',
  },
  sublabel: {
    fontSize: 12,
    marginTop: 2,
    lineHeight: 17,
  },
  detail: {
    fontSize: 14,
    marginRight: 4,
  },
  chevron: {
    fontSize: 22,
  },
});

// ─── Toggle + snap-slider rows ───────────────────────────────────────────────

interface ToggleRowProps {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  sublabel?: string;
  value: boolean;
  onChange: (next: boolean) => void;
}

function ToggleRow({ icon, label, sublabel, value, onChange }: ToggleRowProps) {
  const { colors } = useTheme();
  return (
    <View style={rowStyles.container}>
      <Ionicons name={icon} size={20} color={colors.accent} style={rowStyles.icon} />
      <View style={{ flex: 1 }}>
        <Text style={[rowStyles.label, { color: colors.textPrimary }]}>{label}</Text>
        {sublabel && <Text style={[rowStyles.sublabel, { color: colors.textSecondary }]}>{sublabel}</Text>}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.bgRaised, true: colors.accent }}
        thumbColor={Platform.OS === 'android' ? colors.textPrimary : undefined}
        ios_backgroundColor={colors.bgRaised}
      />
    </View>
  );
}

interface SnapPickerRowProps {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  sublabel?: string;
  options: number[];
  value: number;
  formatOption: (v: number) => string;
  onChange: (next: number) => void;
  disabled?: boolean;
}

function SnapPickerRow({
  icon,
  label,
  sublabel,
  options,
  value,
  formatOption,
  onChange,
  disabled = false,
}: SnapPickerRowProps) {
  const { colors } = useTheme();
  return (
    <View style={[rowStyles.container, { flexDirection: 'column', alignItems: 'stretch' }]}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <Ionicons name={icon} size={20} color={colors.accent} style={rowStyles.icon} />
        <View style={{ flex: 1 }}>
          <Text style={[rowStyles.label, { color: disabled ? colors.textTertiary : colors.textPrimary }]}>
            {label}
          </Text>
          {sublabel && <Text style={[rowStyles.sublabel, { color: colors.textSecondary }]}>{sublabel}</Text>}
        </View>
      </View>
      <View style={pickerStyles.pillRow}>
        {options.map((opt) => {
          const active = opt === value;
          return (
            <Pressable
              key={opt}
              disabled={disabled}
              onPress={() => onChange(opt)}
              style={({ pressed }) => [
                pickerStyles.pill,
                {
                  backgroundColor: active ? colors.accentMuted : colors.bgRaised,
                  borderColor: active ? colors.borderAccent : colors.border,
                },
                pressed && { opacity: 0.7 },
                disabled && { opacity: 0.4 },
              ]}
            >
              <Text
                style={[
                  pickerStyles.pillText,
                  { color: active ? colors.accent : colors.textSecondary },
                ]}
              >
                {formatOption(opt)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const pickerStyles = StyleSheet.create({
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
    marginLeft: 40,
  },
  pill: {
    paddingHorizontal: 13,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pillText: {
    fontSize: 13,
    fontWeight: '700',
  },
});

const CROSSFADE_OPTIONS = [1000, 2000, 4000, 6000, 8000, 12000];

// ─── Appearance scheme picker ─────────────────────────────────────────────────

type SchemePref = 'light' | 'dark' | 'system';

const SCHEME_OPTIONS: { value: SchemePref; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
  { value: 'light', label: 'Light', icon: 'sunny' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
  { value: 'system', label: 'System', icon: 'phone-portrait' },
];

interface SchemePickerRowProps {
  value: SchemePref;
  onChange: (next: SchemePref) => void;
}

function SchemePickerRow({ value, onChange }: SchemePickerRowProps) {
  const { colors } = useTheme();
  return (
    <View style={[rowStyles.container, { flexDirection: 'column', alignItems: 'stretch' }]}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <Ionicons name="contrast" size={20} color={colors.accent} style={rowStyles.icon} />
        <View style={{ flex: 1 }}>
          <Text style={[rowStyles.label, { color: colors.textPrimary }]}>Appearance</Text>
          <Text style={[rowStyles.sublabel, { color: colors.textSecondary }]}>
            Choose the Arc Reactor dark theme, a light scheme, or follow your device.
          </Text>
        </View>
      </View>
      <View style={schemeStyles.segment}>
        {SCHEME_OPTIONS.map((opt) => {
          const active = opt.value === value;
          return (
            <Pressable
              key={opt.value}
              onPress={() => onChange(opt.value)}
              accessibilityRole="button"
              accessibilityLabel={opt.label}
              accessibilityState={{ selected: active }}
              style={({ pressed }) => [
                schemeStyles.segmentItem,
                {
                  backgroundColor: active ? colors.accentMuted : colors.bgRaised,
                  borderColor: active ? colors.borderAccent : colors.border,
                },
                pressed && { opacity: 0.7 },
              ]}
            >
              <Ionicons
                name={opt.icon}
                size={16}
                color={active ? colors.accent : colors.textSecondary}
              />
              <Text
                style={[
                  schemeStyles.segmentText,
                  { color: active ? colors.accent : colors.textSecondary },
                ]}
              >
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const schemeStyles = StyleSheet.create({
  segment: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
    marginLeft: 40,
  },
  segmentItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  segmentText: {
    fontSize: 13,
    fontWeight: '700',
  },
});

// ─── Storage stats ────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export function SettingsScreen() {
  const navigation = useNavigation<RootStackNavigationProp>();
  const theme = useTheme();
  const { colors, isDark } = theme;
  const styles = useMemo(() => createStyles(theme), [theme]);

  const colorSchemePreference = useUIStore((s) => s.colorSchemePreference);
  const setColorScheme = useUIStore((s) => s.setColorScheme);

  const [storageStats, setStorageStats] = useState<{
    totalFiles: number;
    totalSizeBytes: number;
    musicDirPath: string;
  } | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  const appVersion = '1.0.0';

  // Crash-logs modal: surfaces the in-app crashSink dump so the user can
  // see (and copy) what's been captured between reloads.
  const [crashLogsOpen, setCrashLogsOpen] = useState(false);
  const [crashCount, setCrashCount] = useState(0);
  useFocusEffect(
    useCallback(() => {
      try {
        setCrashCount(crashSink.getEntries().length);
      } catch {
        setCrashCount(0);
      }
    }, []),
  );

  // ── Premium-player settings (live store reads) ────────────────────────
  const crossfadeEnabled = useSettingsStore((s) => s.crossfadeEnabled);
  const crossfadeMs = useSettingsStore((s) => s.crossfadeMs);
  const sleepTimerEndOfTrack = useSettingsStore((s) => s.sleepTimerEndOfTrack);
  const albumColorThemingEnabled = useSettingsStore(
    (s) => s.albumColorThemingEnabled,
  );
  const setCrossfadeEnabled = useSettingsStore((s) => s.setCrossfadeEnabled);
  const setCrossfadeMs = useSettingsStore((s) => s.setCrossfadeMs);
  const setSleepTimerEndOfTrack = useSettingsStore(
    (s) => s.setSleepTimerEndOfTrack,
  );
  const setAlbumColorThemingEnabled = useSettingsStore(
    (s) => s.setAlbumColorThemingEnabled,
  );

  useEffect(() => {
    loadStats();
  }, []);

  // The stats card shows total songs + bytes on disk. Both can change from
  // outside this screen (downloads finishing, library cleanup running),
  // so re-pull every time the user returns to Settings instead of leaving
  // them looking at the snapshot from first mount.
  useFocusEffect(
    useCallback(() => {
      void loadStats();
      return undefined;
    }, []),
  );

  const loadStats = async () => {
    setStatsLoading(true);
    try {
      const stats = await getStorageStats();
      setStorageStats(stats);
    } catch {
      // Non-fatal — storage stats are display-only
    } finally {
      setStatsLoading(false);
    }
  };

  // Show the user-visible MediaStore folder (Music/Chakaas). The app's
  // primary copy lives in DocumentDir (app-private, not browsable), but we
  // also publish a copy to Music/Chakaas so other apps + the Files app can
  // see it. Telling the user a path they can't open was confusing.
  const handleShowMusicLocation = useCallback(() => {
    if (Platform.OS === 'android') {
      Alert.alert(
        'Music location',
        'Your downloads appear in:\n\nMusic / Chakaas\n\nOpen your Files or Music app to browse them.',
      );
    } else {
      Alert.alert(
        'Music location',
        'Downloads are stored inside Chakaas Player and play directly from there.',
      );
    }
  }, []);

  const handleCleanLibrary = useCallback(() => {
    Alert.alert(
      'Clean Library',
      'Remove WhatsApp voice notes, status music clips, ringtones, and ' +
        'UUID-named files from your library. Your songs downloaded via ' +
        'Chakaas are never touched. Original device files are not deleted.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clean',
          style: 'destructive',
          onPress: async () => {
            try {
              const removed = await cleanupVoiceNotesAndClips();
              Alert.alert(
                'Done',
                removed === 0
                  ? 'No non-music tracks found. Your library is clean.'
                  : `Removed ${removed} non-music ${removed === 1 ? 'track' : 'tracks'} from your library.`,
              );
              await loadStats();
            } catch {
              Alert.alert('Error', 'Could not clean library.');
            }
          },
        },
      ],
    );
  }, []);

  const handleClearArtworkCache = useCallback(() => {
    Alert.alert(
      'Clear Artwork Cache',
      'This will delete all cached album art. It will be re-downloaded on next play.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            try {
              const dir = await getArtworkDir();
              // The cache directory may not exist yet if no artwork has
              // ever been downloaded — that's "already clear", not an
              // error. lstat throws on a missing path, so guard it.
              const dirExists = await RNBlobUtil.fs.exists(dir);
              if (!dirExists) {
                Alert.alert('Done', 'Artwork cache is already empty.');
                await loadStats();
                return;
              }
              const entries = await RNBlobUtil.fs.lstat(dir);
              for (const entry of entries) {
                if (entry.type === 'file') {
                  await RNBlobUtil.fs.unlink(entry.path);
                }
              }
              Alert.alert('Done', 'Artwork cache cleared.');
              await loadStats();
            } catch {
              Alert.alert('Error', 'Could not clear artwork cache.');
            }
          },
        },
      ],
    );
  }, []);

  return (
    <View style={styles.root}>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor={colors.bg}
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Header ── */}
        <View style={styles.header}>
          <Text style={styles.headerEyebrow}>CONTROL CENTER</Text>
          <Text style={styles.headerTitle}>Settings</Text>
        </View>

        {/* ── Engine ── */}
        <Section title="Recommendation Engine">
          <TapRow
            icon="sparkles"
            label="Chakaas Engine"
            sublabel="See what the engine has learned and what it's thinking"
            onPress={() => navigation.navigate('ChakaasEngine')}
          />
        </Section>

        {/* ── Appearance ── */}
        <Section title="Appearance">
          <SchemePickerRow
            value={colorSchemePreference}
            onChange={setColorScheme}
          />
          <Separator />
          <ToggleRow
            icon="color-palette"
            label="Album color theming"
            sublabel="Tint the Now Playing screen and Mini Player using the current artwork. When off, the UI uses the static cyan accent."
            value={albumColorThemingEnabled}
            onChange={setAlbumColorThemingEnabled}
          />
        </Section>

        {/* ── Playback ── */}
        <Section title="Playback">
          <ToggleRow
            icon="swap-horizontal"
            label="Crossfade"
            sublabel="Smoothly blend the end of one song into the start of the next"
            value={crossfadeEnabled}
            onChange={setCrossfadeEnabled}
          />
          <Separator />
          <SnapPickerRow
            icon="time"
            label="Crossfade duration"
            sublabel="How long the fade-over lasts"
            options={CROSSFADE_OPTIONS}
            value={crossfadeMs}
            disabled={!crossfadeEnabled}
            formatOption={(ms) => `${ms / 1000}s`}
            onChange={setCrossfadeMs}
          />
          <Separator />
          <ToggleRow
            icon="moon"
            label="Sleep timer: stop after current track"
            sublabel="Use end-of-track mode by default when arming the sleep timer"
            value={sleepTimerEndOfTrack}
            onChange={setSleepTimerEndOfTrack}
          />
          <Separator />
          <View style={[rowStyles.container, { alignItems: 'flex-start' }]}>
            <Ionicons
              name="information-circle-outline"
              size={20}
              color={colors.textTertiary}
              style={rowStyles.icon}
            />
            <View style={{ flex: 1 }}>
              <Text style={[rowStyles.label, { color: colors.textPrimary }]}>Audio focus &amp; ducking</Text>
              <Text style={[rowStyles.sublabel, { color: colors.textSecondary }]}>
                Chakaas automatically pauses for calls and lowers volume for
                navigation prompts. Other apps requesting focus will pause us
                until they release it.
              </Text>
            </View>
          </View>
        </Section>

        {/* ── Storage ── */}
        <Section title="Storage">
          <View style={styles.statsRow}>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>
                {statsLoading ? '…' : storageStats?.totalFiles ?? 0}
              </Text>
              <Text style={styles.statLabel}>Songs</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statBox}>
              <Text style={styles.statValue}>
                {statsLoading
                  ? '…'
                  : formatBytes(storageStats?.totalSizeBytes ?? 0)}
              </Text>
              <Text style={styles.statLabel}>Total Size</Text>
            </View>
          </View>
          <Separator />
          <TapRow
            icon="folder-open"
            label="Where are my songs?"
            sublabel={
              Platform.OS === 'android'
                ? 'Visible in your Files app under Music / Chakaas'
                : 'Stored inside the app'
            }
            onPress={handleShowMusicLocation}
          />
          <Separator />
          <TapRow
            icon="sparkles"
            label="Clean Library"
            sublabel="Remove WhatsApp voices, clips & UUID files"
            onPress={handleCleanLibrary}
            destructive
          />
          <Separator />
          <TapRow
            icon="trash"
            label="Clear Artwork Cache"
            onPress={handleClearArtworkCache}
            destructive
          />
        </Section>

        {/* ── Quality notice ── */}
        <Section title="Audio">
          <View style={styles.infoBlock}>
            <Ionicons name="headset" size={20} color={colors.accent} style={rowStyles.icon} />
            <View style={{ flex: 1 }}>
              <Text style={[rowStyles.label, { color: colors.textPrimary }]}>Best available quality</Text>
              <Text style={[rowStyles.sublabel, { color: colors.textSecondary }]}>
                Every download uses the highest-quality source the provider
                offers — 320 kbps AAC when available, otherwise 160 kbps. No
                transcoding, no quality loss.
              </Text>
            </View>
          </View>
        </Section>

        {/* ── Diagnostics ── */}
        <Section title="Diagnostics">
          <TouchableOpacity
            onPress={() => setCrashLogsOpen(true)}
            activeOpacity={0.7}
            style={styles.diagRow}
          >
            <View style={styles.diagIconWrap}>
              <Ionicons name="bug" size={20} color={colors.danger} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.diagLabel}>View Crash Logs</Text>
              <Text style={styles.diagSublabel}>
                {crashCount === 0
                  ? 'No errors captured yet'
                  : `${crashCount} entr${crashCount === 1 ? 'y' : 'ies'} captured — tap to view & copy`}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
          </TouchableOpacity>
        </Section>

        {/* ── About ── */}
        <Section title="About">
          <View style={styles.aboutRow}>
            <Text style={styles.aboutAppName}>Chakaas Player</Text>
            <Text style={styles.aboutVersion}>Version {appVersion}</Text>
            <Text style={styles.aboutTagline}>Built for Bollywood music lovers</Text>
          </View>
        </Section>

        <View style={{ height: 40 }} />
      </ScrollView>

      <CrashLogsModal
        visible={crashLogsOpen}
        onClose={() => {
          setCrashLogsOpen(false);
          try {
            setCrashCount(crashSink.getEntries().length);
          } catch {
            /* ignore */
          }
        }}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function createStyles({ colors }: Theme) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.bg,
    },
    scrollContent: {
      paddingBottom: 40,
    },
    header: {
      paddingTop: Platform.OS === 'ios' ? 56 : 36,
      paddingBottom: 20,
      paddingHorizontal: 20,
    },
    headerEyebrow: {
      fontSize: 11,
      fontWeight: '800',
      letterSpacing: 2,
      color: colors.accent,
      marginBottom: 4,
    },
    headerTitle: {
      fontSize: 32,
      fontWeight: '800',
      color: colors.textPrimary,
      letterSpacing: -0.8,
    },
    statsRow: {
      flexDirection: 'row',
      paddingHorizontal: 16,
      paddingVertical: 18,
      alignItems: 'center',
    },
    statBox: {
      flex: 1,
      alignItems: 'center',
      gap: 4,
    },
    statValue: {
      fontSize: 24,
      fontWeight: '800',
      color: colors.accent,
      letterSpacing: -0.5,
    },
    statLabel: {
      fontSize: 12,
      color: colors.textSecondary,
      fontWeight: '600',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    statDivider: {
      width: StyleSheet.hairlineWidth,
      height: 36,
      backgroundColor: colors.border,
    },
    infoBlock: {
      flexDirection: 'row',
      padding: 16,
      gap: 12,
    },
    diagRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 14,
      paddingHorizontal: 16,
      gap: 14,
    },
    diagIconWrap: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: 'rgba(255,59,71,0.12)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    diagLabel: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.textPrimary,
    },
    diagSublabel: {
      fontSize: 12,
      color: colors.textSecondary,
      marginTop: 2,
    },
    aboutRow: {
      alignItems: 'center',
      paddingVertical: 24,
      paddingHorizontal: 16,
      gap: 6,
    },
    aboutAppName: {
      fontSize: 18,
      fontWeight: '800',
      color: colors.accent,
      letterSpacing: -0.3,
    },
    aboutVersion: {
      fontSize: 13,
      color: colors.textSecondary,
      fontWeight: '500',
    },
    aboutTagline: {
      fontSize: 14,
      color: colors.textTertiary,
      marginTop: 4,
      textAlign: 'center',
    },
  });
}
