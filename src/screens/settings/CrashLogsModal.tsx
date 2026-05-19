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
  // Clipboard ships separately in modern RN; we import lazily below so missing
  // module never breaks the modal render.
} from 'react-native';
import { crashSink } from '@/utils/crashSink';

interface Props {
  visible: boolean;
  onClose: () => void;
}

export function CrashLogsModal({ visible, onClose }: Props): React.ReactElement {
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
    try {
      // Lazy require so apps without @react-native-clipboard/clipboard
      // installed still render the modal (they just see the Copy button no-op).
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const ClipboardMod = require('@react-native-clipboard/clipboard');
      const Clipboard = ClipboardMod?.default ?? ClipboardMod;
      if (Clipboard?.setString) {
        Clipboard.setString(dump);
        Alert.alert('Copied', `${entryCount} log entries copied to clipboard.`);
        return;
      }
    } catch {
      /* fall through to RN-builtin */
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const RN = require('react-native');
      if (RN.Clipboard?.setString) {
        RN.Clipboard.setString(dump);
        Alert.alert('Copied', `${entryCount} log entries copied to clipboard.`);
        return;
      }
    } catch {
      /* ignore */
    }
    Alert.alert(
      'Clipboard unavailable',
      'Long-press the log text and choose Copy from the system menu.',
    );
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
          <Text style={styles.title}>Crash Logs</Text>
          <Text style={styles.subtitle}>{entryCount} entries • newest first</Text>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator
        >
          <Text selectable style={styles.dumpText}>
            {dump || '(no entries)'}
          </Text>
        </ScrollView>

        <View style={styles.actions}>
          <Pressable style={[styles.btn, styles.btnSecondary]} onPress={handleClear}>
            <Text style={styles.btnSecondaryText}>Clear</Text>
          </Pressable>
          <Pressable style={[styles.btn, styles.btnPrimary]} onPress={handleCopy}>
            <Text style={styles.btnPrimaryText}>Copy</Text>
          </Pressable>
          <Pressable style={[styles.btn, styles.btnGhost]} onPress={onClose}>
            <Text style={styles.btnGhostText}>Close</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F5F5F7',
    paddingTop: Platform.OS === 'ios' ? 56 : 24,
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#D1D1D6',
  },
  title: {
    color: '#1C1C1E',
    fontSize: 22,
    fontWeight: '700',
  },
  subtitle: {
    color: '#6E6E73',
    fontSize: 13,
    marginTop: 2,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  dumpText: {
    color: '#1C1C1E',
    fontSize: 11,
    lineHeight: 16,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  actions: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#D1D1D6',
    backgroundColor: '#FFFFFF',
    gap: 8,
  },
  btn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimary: {
    backgroundColor: '#FA233B',
  },
  btnPrimaryText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  btnSecondary: {
    backgroundColor: '#E5E5EA',
  },
  btnSecondaryText: {
    color: '#1C1C1E',
    fontSize: 15,
    fontWeight: '600',
  },
  btnGhost: {
    backgroundColor: 'transparent',
  },
  btnGhostText: {
    color: '#6E6E73',
    fontSize: 15,
    fontWeight: '500',
  },
});

export default CrashLogsModal;
