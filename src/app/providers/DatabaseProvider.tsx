import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { DatabaseProvider as WatermelonDBProvider } from '@nozbe/watermelondb/react';
import { database, tracksCollection } from '@/db';

// ---------------------------------------------------------------------------
// DatabaseProvider
// ---------------------------------------------------------------------------

/**
 * Wraps the application in WatermelonDB's React context so that any component
 * inside the tree can consume database collections via `useDatabase()` or the
 * `withDatabase` / `withObservables` HOCs.
 *
 * The `database` singleton is imported from `@/db` (configured with the SQLite
 * JSI adapter for New Architecture performance). Construction of the adapter
 * is synchronous, but the first real query has to wait for the SQLite file
 * to open and migrations to run. Until that completes we keep a branded
 * loader on screen instead of flashing an empty white frame to the user.
 *
 * If the probe query fails we surface the error in a recoverable screen
 * rather than leaving the rest of the app to render against a half-broken
 * database (which would yield mysterious "table not found" crashes deeper in
 * the tree).
 */
type DbStatus = 'loading' | 'ready' | 'error';

export function DatabaseProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<DbStatus>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    setStatus('loading');
    setErrorMessage(null);

    // Issue a single tiny query to force the JSI adapter to finish setting
    // up. WatermelonDB lazily opens the SQLite file on first query, so this
    // is also the first opportunity for migrations / schema errors to fire.
    (async () => {
      try {
        await tracksCollection.query().fetchCount();
        if (!cancelledRef.current) setStatus('ready');
      } catch (err) {
        if (cancelledRef.current) return;
        const message = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.error('[DatabaseProvider] init probe failed:', err);
        setErrorMessage(message);
        setStatus('error');
      }
    })();

    return () => {
      cancelledRef.current = true;
    };
  }, [retryToken]);

  if (status === 'loading') {
    return <DatabaseSplash />;
  }

  if (status === 'error') {
    return (
      <DatabaseErrorScreen
        message={errorMessage}
        onRetry={() => setRetryToken((n) => n + 1)}
      />
    );
  }

  return (
    <WatermelonDBProvider database={database}>{children}</WatermelonDBProvider>
  );
}

// ---------------------------------------------------------------------------
// Branded loading splash — shown while the SQLite adapter opens the DB.
// ---------------------------------------------------------------------------

function DatabaseSplash() {
  return (
    <View style={styles.splashRoot}>
      <Image
        source={require('../../../assets/icon.png')}
        style={styles.logo}
        resizeMode="contain"
      />
      <ActivityIndicator
        size="small"
        color="#FA233B"
        style={styles.spinner}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Branded error screen — surfaced when the DB probe query throws.
// ---------------------------------------------------------------------------

interface DatabaseErrorScreenProps {
  message: string | null;
  onRetry: () => void;
}

function DatabaseErrorScreen({ message, onRetry }: DatabaseErrorScreenProps) {
  return (
    <View style={styles.errorRoot}>
      <Image
        source={require('../../../assets/icon.png')}
        style={styles.logo}
        resizeMode="contain"
      />
      <Text style={styles.errorTitle}>Library unavailable</Text>
      <Text style={styles.errorBody}>
        Chakaas couldn&apos;t open your music library on this device.
      </Text>
      {message ? <Text style={styles.errorDetail}>{message}</Text> : null}
      <TouchableOpacity
        style={styles.retryBtn}
        onPress={onRetry}
        activeOpacity={0.85}
      >
        <Text style={styles.retryText}>Try again</Text>
      </TouchableOpacity>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  splashRoot: {
    flex: 1,
    backgroundColor: '#F5F5F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    width: 96,
    height: 96,
    marginBottom: 28,
  },
  spinner: {
    transform: [{ scale: 1.1 }],
  },

  errorRoot: {
    flex: 1,
    backgroundColor: '#F5F5F7',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  errorTitle: {
    color: '#1D1D1F',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
  },
  errorBody: {
    color: '#3A3A3C',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 12,
  },
  errorDetail: {
    color: '#8E8E93',
    fontSize: 12,
    fontFamily: 'monospace',
    textAlign: 'center',
    marginBottom: 24,
  },
  retryBtn: {
    backgroundColor: '#FA233B',
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 24,
  },
  retryText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
});
