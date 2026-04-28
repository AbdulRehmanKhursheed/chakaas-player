import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[Chakaas] Fatal render error:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <ScrollView style={styles.root} contentContainerStyle={styles.content}>
          <Text style={styles.title}>Chakaas crashed on startup</Text>
          <Text style={styles.subtitle}>
            Send this screen to the dev so it can be fixed.
          </Text>
          <Text style={styles.heading}>Error</Text>
          <Text style={styles.body}>
            {this.state.error.name}: {this.state.error.message}
          </Text>
          {this.state.error.stack ? (
            <>
              <Text style={styles.heading}>Stack</Text>
              <Text style={styles.body}>{this.state.error.stack}</Text>
            </>
          ) : null}
        </ScrollView>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F5F5F7' },
  content: { padding: 24, paddingTop: 64 },
  title: { color: '#FA233B', fontSize: 22, fontWeight: '700', marginBottom: 8 },
  subtitle: { color: '#999', fontSize: 14, marginBottom: 24 },
  heading: {
    color: '#FA233B',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 16,
    marginBottom: 6,
  },
  body: {
    color: '#E0E0E0',
    fontSize: 12,
    fontFamily: 'monospace',
    lineHeight: 18,
  },
});
