import React from 'react';
import {
  DevSettings,
  NativeModules,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { useDownloadStore } from '@/stores/downloadStore';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
  /** Bumped each time the user taps "Try to recover" so children fully remount. */
  resetKey: number;
}

/**
 * ErrorBoundary — top-level crash catcher.
 *
 * Renders a branded recovery screen on any uncaught render-tree error and
 * offers two recovery actions:
 *   • Try to recover — clears the error and bumps a `resetKey` so the entire
 *     subtree remounts (more aggressive than a simple setState reset).
 *   • Reload App     — invokes `DevSettings.reload()` when available (always
 *     true in development; available in release builds too via the React Native
 *     core module) for a full JS bundle reload.
 *
 * The full error and stack are kept on-screen for the user to relay to support.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, errorInfo: null, resetKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[Chakaas] Render error:', error, info.componentStack);
    this.setState({ errorInfo: info });
  }

  private handleRetry = () => {
    // Flush the in-memory download queue before remounting. A poisoned queue
    // item (one whose pipeline crashed the render tree) would otherwise be
    // re-picked the instant the subtree comes back, re-triggering the crash.
    try {
      useDownloadStore.setState({ queue: [] });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[Chakaas] clearing download queue on recover failed:', err);
    }
    this.setState((prev) => ({
      error: null,
      errorInfo: null,
      resetKey: prev.resetKey + 1,
    }));
  };

  private handleReload = () => {
    // DevSettings.reload() is the canonical "reload JS" entry point. It is
    // present in both dev and release builds because it ships with React
    // Native core. We still guard the call so an unusual host shell can't
    // crash the recovery screen if the module is missing.
    try {
      if (typeof DevSettings?.reload === 'function') {
        DevSettings.reload();
        return;
      }
      const native = (NativeModules as { DevSettings?: { reload?: () => void } }).DevSettings;
      native?.reload?.();
    } catch (err) {
      // Last resort — just clear the error so the user isn't stuck.
      // eslint-disable-next-line no-console
      console.warn('[Chakaas] DevSettings.reload() failed:', err);
      this.handleRetry();
    }
  };

  render() {
    if (this.state.error) {
      return (
        <ScrollView style={styles.root} contentContainerStyle={styles.content}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.subtitle}>
            Chakaas ran into an unexpected error. Try to recover, or fully
            reload the app if the issue persists.
          </Text>

          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={this.handleRetry}
            activeOpacity={0.85}
          >
            <Text style={styles.primaryText}>Try to recover</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={this.handleReload}
            activeOpacity={0.85}
          >
            <Text style={styles.secondaryText}>Reload app</Text>
          </TouchableOpacity>

          <Text style={styles.heading}>Error</Text>
          <Text style={styles.body}>
            {this.state.error.name}: {this.state.error.message}
          </Text>
          {this.state.error.stack ? (
            <View>
              <Text style={styles.heading}>Stack</Text>
              <Text style={styles.body}>{this.state.error.stack}</Text>
            </View>
          ) : null}
          {this.state.errorInfo?.componentStack ? (
            <View>
              <Text style={styles.heading}>Component stack</Text>
              <Text style={styles.body}>
                {this.state.errorInfo.componentStack}
              </Text>
            </View>
          ) : null}

          <Text style={styles.platform}>
            Chakaas Player · {Platform.OS} {String(Platform.Version)}
          </Text>

          <View style={styles.bottomSpacer} />
        </ScrollView>
      );
    }

    // Bumping `resetKey` forces a full remount of the subtree so any stale
    // state inside descendants is wiped along with the boundary itself.
    return (
      <React.Fragment key={this.state.resetKey}>
        {this.props.children}
      </React.Fragment>
    );
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F5F5F7' },
  content: { padding: 24, paddingTop: 64 },
  title: { color: '#FA233B', fontSize: 22, fontWeight: '700', marginBottom: 8 },
  subtitle: { color: '#6E6E73', fontSize: 14, marginBottom: 28, lineHeight: 20 },
  primaryBtn: {
    backgroundColor: '#FA233B',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryText: { color: '#FFF', fontSize: 15, fontWeight: '700' },
  secondaryBtn: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 32,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E5EA',
  },
  secondaryText: { color: '#1D1D1F', fontSize: 15, fontWeight: '600' },
  heading: {
    color: '#FA233B',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 16,
    marginBottom: 6,
  },
  body: {
    color: '#3A3A3C',
    fontSize: 12,
    fontFamily: 'monospace',
    lineHeight: 18,
  },
  platform: {
    color: '#8E8E93',
    fontSize: 11,
    marginTop: 24,
    textAlign: 'center',
  },
  bottomSpacer: { height: 40 },
});
