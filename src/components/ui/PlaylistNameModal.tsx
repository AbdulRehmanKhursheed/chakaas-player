/**
 * PlaylistNameModal — controlled, cross-platform replacement for the iOS-only
 * `Alert.prompt` (which silently no-ops on Android).
 *
 * Visible state and the create handler are owned by the parent screen.
 * Empty/whitespace input keeps the modal open and surfaces an inline error.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Pressable,
  Platform,
  ActivityIndicator,
  KeyboardAvoidingView,
  BackHandler,
} from 'react-native';

// ─── Props ───────────────────────────────────────────────────────────────────

interface PlaylistNameModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (name: string) => Promise<void> | void;
  initialName?: string;
  title?: string;
  placeholder?: string;
  submitLabel?: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function PlaylistNameModal({
  visible,
  onClose,
  onSubmit,
  initialName,
  title = 'New Playlist',
  placeholder = 'Playlist name',
  submitLabel = 'Create',
}: PlaylistNameModalProps) {
  const [name, setName] = useState<string>(initialName ?? '');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const inputRef = useRef<TextInput>(null);

  // Reset state when the modal is opened
  useEffect(() => {
    if (visible) {
      setName(initialName ?? '');
      setError(null);
      setSubmitting(false);
      const t = setTimeout(() => inputRef.current?.focus(), 120);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [visible, initialName]);

  // Android hardware back: close the modal (the Modal's onRequestClose also
  // fires, but this guards against custom navigation interceptors).
  useEffect(() => {
    if (!visible || Platform.OS !== 'android') return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (submitting) return true;
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, submitting, onClose]);

  const handleSubmit = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Please enter a name.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit(trimmed);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create playlist.');
    } finally {
      setSubmitting(false);
    }
  }, [name, onSubmit, onClose]);

  const handleBackdropPress = useCallback(() => {
    if (submitting) return;
    onClose();
  }, [submitting, onClose]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        style={styles.root}
        // `padding` on iOS lifts the card above the keyboard correctly.
        // On Android, with `statusBarTranslucent` the Modal sits over the
        // system bar so we need an explicit `height` strategy plus a small
        // vertical offset, otherwise the card stays anchored under the
        // keyboard and the input becomes invisible.
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
      >
        <Pressable style={styles.backdrop} onPress={handleBackdropPress} />
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          <TextInput
            ref={inputRef}
            style={[styles.input, error ? styles.inputError : null]}
            value={name}
            onChangeText={(text) => {
              setName(text);
              if (error) setError(null);
            }}
            placeholder={placeholder}
            placeholderTextColor="#8E8E93"
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={() => void handleSubmit()}
            editable={!submitting}
            maxLength={80}
          />
          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <View style={styles.actions}>
            <TouchableOpacity
              onPress={onClose}
              disabled={submitting}
              activeOpacity={0.7}
              style={[styles.button, styles.buttonGhost]}
            >
              <Text style={styles.buttonGhostText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => void handleSubmit()}
              disabled={submitting}
              activeOpacity={0.85}
              style={[styles.button, styles.buttonPrimary]}
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.buttonPrimaryText}>{submitLabel}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  card: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.18,
        shadowRadius: 24,
      },
      android: { elevation: 12 },
    }),
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1D1D1F',
    letterSpacing: -0.2,
    marginBottom: 14,
  },
  input: {
    height: 46,
    borderRadius: 12,
    backgroundColor: '#F2F2F7',
    paddingHorizontal: 14,
    fontSize: 15,
    color: '#1D1D1F',
    borderWidth: 1,
    borderColor: 'rgba(60,60,67,0.10)',
  },
  inputError: {
    borderColor: '#FF3B30',
  },
  errorText: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: '500',
    color: '#FF3B30',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 18,
  },
  button: {
    minWidth: 92,
    height: 40,
    paddingHorizontal: 14,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonGhost: {
    backgroundColor: 'transparent',
  },
  buttonGhostText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6E6E73',
  },
  buttonPrimary: {
    backgroundColor: '#FA233B',
  },
  buttonPrimaryText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.1,
  },
});
