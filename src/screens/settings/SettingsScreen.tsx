import React, {
  useCallback,
  useEffect,
  useState,
} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Switch,
  ScrollView,
  StyleSheet,
  Platform,
  StatusBar,
  Alert,
  Linking,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import {
  useSettingsStore,
  type DownloadQuality,
} from '@/stores/settingsStore';
import {
  getStorageStats,
  getArtworkDir,
  getMusicDir,
} from '@/services/storage/fileSystem';
import RNBlobUtil from 'react-native-blob-util';
import { Ionicons } from '@expo/vector-icons';
import type { RootStackNavigationProp } from '@/types/navigation';

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

interface ToggleRowProps {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  sublabel?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}

function ToggleRow({ icon, label, sublabel, value, onValueChange }: ToggleRowProps) {
  return (
    <View style={rowStyles.container}>
      <Ionicons name={icon} size={20} color="#6E6E73" style={rowStyles.icon} />
      <View style={rowStyles.toggleBody}>
        <View style={{ flex: 1 }}>
          <Text style={rowStyles.label}>{label}</Text>
          {sublabel && <Text style={rowStyles.sublabel}>{sublabel}</Text>}
        </View>
        <Switch
          value={value}
          onValueChange={onValueChange}
          trackColor={{ false: '#D2D2D7', true: 'rgba(250,35,59,0.32)' }}
          thumbColor={value ? '#FA233B' : '#8E8E93'}
          ios_backgroundColor="#D2D2D7"
        />
      </View>
    </View>
  );
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
  },
  icon: {
    width: 28,
    textAlign: 'center',
    marginTop: 1,
  },
  textRowBody: {
    flex: 1,
    gap: 6,
  },
  toggleBody: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F2F2F7',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D2D2D7',
    paddingHorizontal: 10,
    gap: 8,
  },
  input: {
    flex: 1,
    height: 38,
    fontSize: 14,
    color: '#1D1D1F',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  chevron: {
    fontSize: 22,
    color: '#8E8E93',
  },
});

// ─── Quality radio group ──────────────────────────────────────────────────────

interface QualityRadioProps {
  value: DownloadQuality;
  onChange: (q: DownloadQuality) => void;
}

const QUALITY_OPTIONS: { value: DownloadQuality; label: string; hint: string }[] = [
  { value: '128k', label: '128 kbps', hint: 'Small file' },
  { value: '192k', label: '192 kbps', hint: 'Balanced' },
  { value: '256k', label: '256 kbps', hint: 'High quality' },
  { value: '320k', label: '320 kbps', hint: 'Best quality' },
];

function QualityRadio({ value, onChange }: QualityRadioProps) {
  return (
    <View style={radioStyles.container}>
      <View style={rowStyles.container}>
        <Ionicons name="headset" size={20} color="#6E6E73" style={rowStyles.icon} />
        <Text style={[rowStyles.label, { flex: 1 }]}>Audio Quality</Text>
      </View>
      <View style={radioStyles.optionsRow}>
        {QUALITY_OPTIONS.map((opt) => {
          const selected = opt.value === value;
          return (
            <TouchableOpacity
              key={opt.value}
              onPress={() => onChange(opt.value)}
              style={[radioStyles.option, selected && radioStyles.selectedOption]}
              activeOpacity={0.8}
            >
              <Text style={[radioStyles.optionLabel, selected && radioStyles.selectedLabel]}>
                {opt.label}
              </Text>
              <Text style={radioStyles.optionHint}>{opt.hint}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const radioStyles = StyleSheet.create({
  container: {
    paddingBottom: 12,
  },
  optionsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 8,
  },
  option: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#F2F2F7',
    borderWidth: 1.5,
    borderColor: '#D2D2D7',
    alignItems: 'center',
    gap: 2,
  },
  selectedOption: {
    backgroundColor: 'rgba(250,35,59,0.10)',
    borderColor: '#FA233B',
  },
  optionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6E6E73',
  },
  selectedLabel: {
    color: '#FA233B',
  },
  optionHint: {
    fontSize: 10,
    color: '#8E8E93',
  },
});

// ─── Crossfade step row ───────────────────────────────────────────────────────

const CROSSFADE_STEPS = [0, 1, 2, 3, 4, 5, 6, 8, 10, 12];

interface CrossfadeRowProps {
  value: number; // 0-12
  onChange: (v: number) => void;
}

function CrossfadeRow({ value, onChange }: CrossfadeRowProps) {
  const displayVal = Math.round(value);
  return (
    <View style={cfStyles.container}>
      <View style={[rowStyles.container, { paddingBottom: 8 }]}>
        <Ionicons name="options" size={20} color="#6E6E73" style={rowStyles.icon} />
        <Text style={[rowStyles.label, { flex: 1 }]}>Crossfade</Text>
        <Text style={cfStyles.valueLabel}>
          {displayVal === 0 ? 'Off' : `${displayVal}s`}
        </Text>
      </View>
      <View style={cfStyles.stepsRow}>
        {CROSSFADE_STEPS.map((step) => (
          <TouchableOpacity
            key={step}
            onPress={() => onChange(step)}
            style={[cfStyles.step, value === step && cfStyles.stepActive]}
            activeOpacity={0.7}
          >
            <Text style={[cfStyles.stepLabel, value === step && cfStyles.stepLabelActive]}>
              {step === 0 ? 'Off' : `${step}s`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const cfStyles = StyleSheet.create({
  container: { paddingBottom: 12 },
  valueLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FA233B',
    width: 36,
    textAlign: 'right',
  },
  stepsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    gap: 8,
  },
  step: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: '#F2F2F7',
    borderWidth: 1,
    borderColor: '#D2D2D7',
  },
  stepActive: {
    backgroundColor: 'rgba(250,35,59,0.10)',
    borderColor: '#FA233B',
  },
  stepLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#8E8E93',
  },
  stepLabelActive: {
    color: '#FA233B',
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
  const {
    downloadQuality,
    downloadOnWifiOnly,
    crossfadeDuration,
    normalizationEnabled,
    dailyPicksEnabled,
    dailyPicksTime,
    setDownloadQuality,
    setDownloadOnWifiOnly,
    setCrossfadeDuration,
    setNormalizationEnabled,
    setDailyPicksEnabled,
    setDailyPicksTime,
  } = useSettingsStore();

  const [localPicksTime, setLocalPicksTime] = useState(dailyPicksTime);

  // Storage stats
  const [storageStats, setStorageStats] = useState<{
    totalFiles: number;
    totalSizeBytes: number;
    musicDirPath: string;
  } | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  // Static version string — update as needed or inject via build config
  const appVersion = '1.0.0';

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    setStatsLoading(true);
    try {
      const stats = await getStorageStats();
      setStorageStats(stats);
    } finally {
      setStatsLoading(false);
    }
  };

  // Validate and save picks time
  const handleSavePicksTime = useCallback(() => {
    const match = localPicksTime.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
    if (!match) {
      Alert.alert('Invalid format', 'Please use HH:MM format (e.g. 03:00)');
      return;
    }
    setDailyPicksTime(localPicksTime);
  }, [localPicksTime, setDailyPicksTime]);

  // Open music folder
  const handleOpenMusicFolder = useCallback(async () => {
    const dir = await getMusicDir();
    if (Platform.OS === 'android') {
      await Linking.openURL(`content://com.android.externalstorage.documents/document/primary:Music%2FChakaas`).catch(() => {
        Alert.alert('Cannot open folder', dir);
      });
    } else {
      Alert.alert('Music Folder', dir);
    }
  }, []);

  // Clear artwork cache
  const handleClearArtworkCache = useCallback(async () => {
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

        {/* ── 1. Download ── */}
        <Section title="Download">
          <QualityRadio value={downloadQuality} onChange={setDownloadQuality} />
          <Separator />
          <ToggleRow
            icon="wifi"
            label="Wi-Fi Only"
            sublabel="Download only on Wi-Fi to save mobile data"
            value={downloadOnWifiOnly}
            onValueChange={setDownloadOnWifiOnly}
          />
        </Section>

        {/* ── 3. Playback ── */}
        <Section title="Playback">
          <CrossfadeRow
            value={crossfadeDuration}
            onChange={setCrossfadeDuration}
          />
          <Separator />
          <ToggleRow
            icon="stats-chart"
            label="Volume Normalization"
            sublabel="Equalise loudness across tracks"
            value={normalizationEnabled}
            onValueChange={setNormalizationEnabled}
          />
        </Section>

        {/* ── 4. Daily Picks ── */}
        <Section title="Daily Picks">
          <ToggleRow
            icon="sparkles"
            label="Enable Daily Picks"
            sublabel="Auto-download a fresh selection each night"
            value={dailyPicksEnabled}
            onValueChange={setDailyPicksEnabled}
          />
          {dailyPicksEnabled && (
            <>
              <Separator />
              <View style={styles.timePickerRow}>
                <Ionicons name="time" size={20} color="#6E6E73" style={rowStyles.icon} />
                <View style={{ flex: 1 }}>
                  <Text style={rowStyles.label}>Download Time</Text>
                  <Text style={rowStyles.sublabel}>24-hour format, e.g. 03:00</Text>
                </View>
                <View style={styles.timeInputContainer}>
                  <TextInput
                    style={styles.timeInput}
                    value={localPicksTime}
                    onChangeText={setLocalPicksTime}
                    onBlur={handleSavePicksTime}
                    onSubmitEditing={handleSavePicksTime}
                    placeholder="03:00"
                    placeholderTextColor="#8E8E93"
                    keyboardType="numbers-and-punctuation"
                    maxLength={5}
                    returnKeyType="done"
                  />
                </View>
              </View>
            </>
          )}
        </Section>

        {/* ── 5. Storage ── */}
        <Section title="Storage">
          {/* Stats display */}
          <View style={styles.statsRow}>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>
                {statsLoading ? '…' : storageStats?.totalFiles ?? 0}
              </Text>
              <Text style={styles.statLabel}>Files</Text>
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
            label="Open Music Folder"
            sublabel={storageStats?.musicDirPath}
            onPress={handleOpenMusicFolder}
          />
          <Separator />
          <TapRow
            icon="trash"
            label="Clear Artwork Cache"
            onPress={handleClearArtworkCache}
            destructive
          />
        </Section>

        {/* ── 6. About ── */}
        <Section title="About">
          <View style={styles.aboutRow}>
            <Text style={styles.aboutAppName}>Chakaas Player</Text>
            <Text style={styles.aboutVersion}>Version {appVersion}</Text>
            <Text style={styles.aboutTagline}>
              Built for Songs lovers
            </Text>
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
  saveButton: {
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 12,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#FA233B',
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  // Time picker
  timePickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  timeInputContainer: {
    backgroundColor: '#F2F2F7',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D2D2D7',
    paddingHorizontal: 10,
  },
  timeInput: {
    height: 38,
    width: 72,
    fontSize: 16,
    fontWeight: '600',
    color: '#FA233B',
    textAlign: 'center',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  // Storage stats
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
  // About
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
