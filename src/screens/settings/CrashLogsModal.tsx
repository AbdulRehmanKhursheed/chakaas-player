/**
 * CrashLogsModal
 * ──────────────
 * Self-contained modal that renders the crashSink dump as plain text so the
 * user can long-press → Copy and paste it back to the dev. Designed to be
 * trivially wireable from SettingsScreen — but it's NOT wired here so Agent 1
 * can decide if/where it appears (e.g. tap version 5×).
 *
 * Usage:
 *   <CrashLogsModal visible={open} onClose={() => setOpen(false)} />
 */

import React, { useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  Platform,
  Alert,
  Share,
} from 'react-native';
import { crashSink } from '@/utils/crashSink';
import { useTheme, type Theme } from '@/theme';

interface Props {
  visible: boolean;
  onClose: () => void;
}

export function CrashLogsModal({ visible, onClose }: Props): React.ReactElement {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  // Recompute on each open so the dump is fresh. Using useMemo + visible as a
  // dep means we don't recompute on every render of the parent.
  const [bumpKey, setBumpKey] = useState(0);
  const dump = useMemo(() => {
    if (!visible) return '';
    return crashSink.exportAsText();
    // bumpKey is intentionally included so "Clear" can force a re-export.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, bumpKey]);

  const entryCount = useMemo(() => crashSink.getEntries().length, [visible, bumpKey]);

  const handleCopy = async (): Promise<void> => {
    // RN's built-in Share API is part of core (no native dep). The user
    // can pick any app to send the dump to — chat, email, gist, etc.
    // We renamed the button text but kept the handler name for clarity.
    try {
      await Share.share({
        message: dump,
        title: `Chakaas crash logs (${entryCount} entries)`,
      });
    } catch (err) {
      Alert.alert(
        'Share unavailable',
        'Long-press the log text and choose Copy from the system menu.',
      );
    }
  };

  const handleClear = (): void => {
    Alert.alert('Clear logs?', 'This wipes the on-device crash buffer. Cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: () => {
          crashSink.clear();
          setBumpKey((k) => k + 1);
        },
      },
    ]);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent={false}>
      <View style={styles.root}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>DIAGNOSTICS</Text>
          <Text style={styles.title}>Crash Logs</Text>
          <Text style={styles.subtitle}>{entryCount} entries • newest first</Text>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator
        >
          <View style={styles.dumpCard}>
            <Text selectable style={styles.dumpText}>
              {dump || '(no entries)'}
            </Text>
          </View>
        </ScrollView>

        <View style={styles.actions}>
          <Pressable style={[styles.btn, styles.btnSecondary]} onPress={handleClear}>
            <Text style={styles.btnSecondaryText}>Clear</Text>
          </Pressable>
          <Pressable style={[styles.btn, styles.btnPrimary]} onPress={handleCopy}>
            <Text style={styles.btnPrimaryText}>Share</Text>
          </Pressable>
          <Pressable style={[styles.btn, styles.btnGhost]} onPress={onClose}>
            <Text style={styles.btnGhostText}>Close</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function createStyles({ colors }: Theme) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.bg,
      paddingTop: Platform.OS === 'ios' ? 56 : 24,
    },
    header: {
      paddingHorizontal: 20,
      paddingBottom: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.borderAccent,
    },
    eyebrow: {
      color: colors.accent,
      fontSize: 11,
      fontWeight: '800',
      letterSpacing: 2,
      marginBottom: 3,
    },
    title: {
      color: colors.textPrimary,
      fontSize: 26,
      fontWeight: '800',
      letterSpacing: -0.6,
    },
    subtitle: {
      color: colors.textSecondary,
      fontSize: 13,
      marginTop: 3,
    },
    scroll: {
      flex: 1,
    },
    scrollContent: {
      padding: 16,
      paddingBottom: 32,
    },
    dumpCard: {
      backgroundColor: colors.bgElevated,
      borderRadius: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      padding: 14,
    },
    dumpText: {
      color: colors.textSecondary,
      fontSize: 11,
      lineHeight: 16,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    },
    actions: {
      flexDirection: 'row',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.borderAccent,
      backgroundColor: colors.bgElevated,
      gap: 8,
    },
    btn: {
      flex: 1,
      paddingVertical: 13,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    btnPrimary: {
      backgroundColor: colors.accent,
    },
    btnPrimaryText: {
      color: colors.bg,
      fontSize: 15,
      fontWeight: '800',
    },
    btnSecondary: {
      backgroundColor: colors.bgRaised,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    btnSecondaryText: {
      color: colors.textPrimary,
      fontSize: 15,
      fontWeight: '700',
    },
    btnGhost: {
      backgroundColor: 'transparent',
    },
    btnGhostText: {
      color: colors.textSecondary,
      fontSize: 15,
      fontWeight: '600',
    },
  });
}

export default CrashLogsModal;
