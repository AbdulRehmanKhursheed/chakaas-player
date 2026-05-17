import React, {
  useCallback,
  useEffect,
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
import { cleanupVoiceNotesAndClips } from '@/db/cleanup';

// ─── Section wrapper ──────────────────────────────────────────────────────────

interface SectionProps {
  title: string;
  children: React.ReactNode;
}

function Section({ title, children }: SectionProps) {
  return (
    <View style={sectionStyles.container}>
      <Text style={sectionStyles.title}>{title}</Text>
      <View style={sectionStyles.card}>{children}</View>
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
    color: '#6E6E73',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  card: {
    marginHorizontal: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#F2F2F7',
  },
});

// ─── Row components ───────────────────────────────────────────────────────────

function Separator() {
  return <View style={rowStyles.separator} />;
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
  return (
    <TouchableOpacity
      style={rowStyles.container}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={20} color={destructive ? '#FF3B30' : '#6E6E73'} style={rowStyles.icon} />
      <View style={rowStyles.tapBody}>
        <View style={{ flex: 1 }}>
          <Text style={[rowStyles.label, destructive && rowStyles.destructiveLabel]}>
            {label}
          </Text>
          {sublabel && <Text style={rowStyles.sublabel}>{sublabel}</Text>}
        </View>
        {detail && <Text style={rowStyles.detail}>{detail}</Text>}
        <Text style={rowStyles.chevron}>›</Text>
      </View>
    </TouchableOpacity>
  );
}

const rowStyles = StyleSheet.create({
  separator: {
    height: 1,
    backgroundColor: '#F2F2F7',
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
    color: '#1D1D1F',
  },
  sublabel: {
    fontSize: 12,
    color: '#8E8E93',
    marginTop: 2,
  },
  destructiveLabel: {
    color: '#E74C3C',
  },
  detail: {
    fontSize: 14,
    color: '#8E8E93',
    marginRight: 4,
  },
  chevron: {
    fontSize: 22,
    color: '#8E8E93',
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
  return (
    <View style={rowStyles.container}>
      <Ionicons name={icon} size={20} color="#6E6E73" style={rowStyles.icon} />
      <View style={{ flex: 1 }}>
        <Text style={rowStyles.label}>{label}</Text>
        {sublabel && <Text style={rowStyles.sublabel}>{sublabel}</Text>}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: '#E5E5EA', true: '#FA233B' }}
        thumbColor={Platform.OS === 'android' ? '#FFFFFF' : undefined}
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
  return (
    <View style={[rowStyles.container, { flexDirection: 'column', alignItems: 'stretch' }]}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <Ionicons name={icon} size={20} color="#6E6E73" style={rowStyles.icon} />
        <View style={{ flex: 1 }}>
          <Text style={[rowStyles.label, disabled && { color: '#C7C7CC' }]}>
            {label}
          </Text>
          {sublabel && <Text style={rowStyles.sublabel}>{sublabel}</Text>}
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
                active && pickerStyles.pillActive,
                pressed && { opacity: 0.7 },
                disabled && { opacity: 0.4 },
              ]}
            >
              <Text style={[pickerStyles.pillText, active && pickerStyles.pillTextActive]}>
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
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#F2F2F7',
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  pillActive: {
    backgroundColor: '#FA233B',
    borderColor: '#FA233B',
  },
  pillText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1D1D1F',
  },
  pillTextActive: {
    color: '#FFFFFF',
  },
});

const CROSSFADE_OPTIONS = [1000, 2000, 4000, 6000, 8000, 12000];

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

  const [storageStats, setStorageStats] = useState<{
    totalFiles: number;
    totalSizeBytes: number;
    musicDirPath: string;
  } | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  const appVersion = '1.0.0';

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
      <StatusBar barStyle="dark-content" backgroundColor="#F5F5F7" />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Header ── */}
        <View style={styles.header}>
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
              color="#6E6E73"
              style={rowStyles.icon}
            />
            <View style={{ flex: 1 }}>
              <Text style={rowStyles.label}>Audio focus &amp; ducking</Text>
              <Text style={rowStyles.sublabel}>
                Chakaas automatically pauses for calls and lowers volume for
                navigation prompts. Other apps requesting focus will pause us
                until they release it.
              </Text>
            </View>
          </View>
        </Section>

        {/* ── Appearance ── */}
        <Section title="Appearance">
          <ToggleRow
            icon="color-palette"
            label="Album color theming"
            sublabel="Tint the Now Playing screen and Mini Player using the current artwork. When off, the UI uses the static gold accent."
            value={albumColorThemingEnabled}
            onChange={setAlbumColorThemingEnabled}
          />
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
            <Ionicons name="headset" size={20} color="#6E6E73" style={rowStyles.icon} />
            <View style={{ flex: 1 }}>
              <Text style={rowStyles.label}>Best available quality</Text>
              <Text style={rowStyles.sublabel}>
                Every download uses the highest-quality source the provider
                offers — 320 kbps AAC when available, otherwise 160 kbps. No
                transcoding, no quality loss.
              </Text>
            </View>
          </View>
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
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F5F5F7',
  },
  scrollContent: {
    paddingBottom: 40,
  },
  header: {
    paddingTop: Platform.OS === 'ios' ? 56 : 36,
    paddingBottom: 20,
    paddingHorizontal: 20,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#1D1D1F',
    letterSpacing: -0.5,
  },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  statBox: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  statValue: {
    fontSize: 22,
    fontWeight: '800',
    color: '#1D1D1F',
    letterSpacing: -0.5,
  },
  statLabel: {
    fontSize: 12,
    color: '#8E8E93',
    fontWeight: '500',
  },
  statDivider: {
    width: 1,
    height: 36,
    backgroundColor: '#D2D2D7',
  },
  infoBlock: {
    flexDirection: 'row',
    padding: 16,
    gap: 12,
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
    color: '#FA233B',
    letterSpacing: -0.3,
  },
  aboutVersion: {
    fontSize: 13,
    color: '#8E8E93',
    fontWeight: '500',
  },
  aboutTagline: {
    fontSize: 14,
    color: '#6E6E73',
    marginTop: 4,
    textAlign: 'center',
  },
});
