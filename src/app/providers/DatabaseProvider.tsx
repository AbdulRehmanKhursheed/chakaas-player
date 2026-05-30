import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { MMKV } from 'react-native-mmkv';
import { DatabaseProvider as WatermelonDBProvider } from '@nozbe/watermelondb/react';
import { database, tracksCollection } from '@/db';

// ---------------------------------------------------------------------------
// Boot-failure counter
// ---------------------------------------------------------------------------
// Persisted in its OWN MMKV instance (mirrors crashSink's isolation strategy)
// so a corrupt general store can never block the recovery flow. Lazily
// initialised so a broken native MMKV module can't crash module load — if it's
// unavailable we simply lose the cross-launch count and fall back to the
// in-screen "Reset library" button (always available on the error screen).
const BOOT_FAIL_KEY = 'db.bootFailures.v1';
let _bootStore: MMKV | null = null;
function getBootStore(): MMKV | null {
  if (_bootStore) return _bootStore;
  try {
    _bootStore = new MMKV({ id: 'chakaas-db-boot' });
    return _bootStore;
  } catch {
    return null;
  }
}
function readBootFailures(): number {
  try {
    return getBootStore()?.getNumber(BOOT_FAIL_KEY) ?? 0;
  } catch {
    return 0;
  }
}
function writeBootFailures(n: number): void {
  try {
    getBootStore()?.set(BOOT_FAIL_KEY, n);
  } catch {
    /* counter is best-effort — ignore. */
  }
}

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
  // Surfaces the destructive "Reset library" option after repeated failures.
  const [offerReset, setOfferReset] = useState(false);
  const [resetting, setResetting] = useState(false);
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
        if (cancelledRef.current) return;
        // Healthy boot — clear the consecutive-failure counter.
        writeBootFailures(0);
        setStatus('ready');
      } catch (err) {
        if (cancelledRef.current) return;
        const message = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.error('[DatabaseProvider] init probe failed:', err);
        // Increment the cross-launch counter so a permanently corrupt SQLite
        // file (whose probe fails identically every boot) auto-surfaces the
        // destructive reset path instead of looping on "Try again".
        const failures = readBootFailures() + 1;
        writeBootFailures(failures);
        setOfferReset(failures >= 2);
        setErrorMessage(message);
        setStatus('error');
      }
    })();

    return () => {
      cancelledRef.current = true;
    };
  }, [retryToken]);

  // Destructive recovery: wipe the SQLite file via WatermelonDB's
  // unsafeResetDatabase, clear the failure counter, then re-run the probe.
  const handleReset = () => {
    Alert.alert(
      'Reset library?',
      'This permanently erases your downloaded-song database (tracks, plays, ' +
        'and playlists) so Chakaas can rebuild it from scratch. Audio files ' +
        'already on the device are not deleted. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset library',
          style: 'destructive',
          onPress: () => {
            setResetting(true);
            (async () => {
              try {
                await database.write(async () => {
                  await database.unsafeResetDatabase();
                });
                writeBootFailures(0);
                setOfferReset(false);
              } catch (err) {
                // eslint-disable-next-line no-console
                console.error('[DatabaseProvider] unsafeResetDatabase failed:', err);
                const message = err instanceof Error ? err.message : String(err);
                setErrorMessage(message);
              } finally {
                setResetting(false);
                // Re-run the probe regardless — a successful reset should boot
                // clean; a failed reset re-renders the error screen.
                setRetryToken((n) => n + 1);
              }
            })();
          },
        },
      ],
    );
  };

  if (status === 'loading') {
    return <DatabaseSplash />;
  }

  if (status === 'error') {
    return (
      <DatabaseErrorScreen
        message={errorMessage}
        offerReset={offerReset}
        resetting={resetting}
        onRetry={() => setRetryToken((n) => n + 1)}
        onReset={handleReset}
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
  /** When true, surface the destructive "Reset library" button. */
  offerReset: boolean;
  /** True while the reset is in flight (disables buttons + shows spinner). */
  resetting: boolean;
  onRetry: () => void;
  onReset: () => void;
}

function DatabaseErrorScreen({
  message,
  offerReset,
  resetting,
  onRetry,
  onReset,
}: DatabaseErrorScreenProps) {
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
      {resetting ? (
        <ActivityIndicator size="small" color="#FA233B" style={styles.spinner} />
      ) : (
        <>
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={onRetry}
            activeOpacity={0.85}
          >
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
          {offerReset ? (
            <TouchableOpacity
              style={styles.resetBtn}
              onPress={onReset}
              activeOpacity={0.85}
            >
              <Text style={styles.resetText}>Reset library</Text>
            </TouchableOpacity>
          ) : null}
        </>
      )}
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
  resetBtn: {
    marginTop: 14,
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#FA233B',
  },
  resetText: {
    color: '#FA233B',
    fontSize: 15,
    fontWeight: '700',
  },
});
