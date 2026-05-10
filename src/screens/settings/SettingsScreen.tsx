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
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import {
  getStorageStats,
  getArtworkDir,
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
