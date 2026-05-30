/**
 * bootRecovery
 * ────────────
 * One-shot cold-start cleanup that undoes the wreckage a NATIVE crash leaves
 * behind. JS error handlers cannot see a native crash (notifee / blob-util /
 * track-player), so when one kills the process mid-download the worker pool's
 * `finally` never runs: the Android foreground-service notification is never
 * stopped and multi-MB temp files are stranded under `CacheDir/tmp`. On the
 * next launch nothing cleans these up, so the app boots into a wedged state
 * (a stuck "Downloading…" notification, possibly a full cache).
 *
 * On a COLD start there is — by definition — no live download session, so it
 * is always safe to stop the foreground service and clear the temp dir here.
 *
 * Everything is wrapped in try/catch; this function must NEVER throw, because
 * it runs on the boot path before the UI is interactive.
 */
import notifee from '@notifee/react-native';

import { purgeTempDir } from '@/services/storage/fileSystem';

/** Mirror of DownloadNotificationService's CHANNEL_ID (kept local so this
 *  recovery path has no dependency on the download feature module). */
const DOWNLOAD_CHANNEL_ID = 'chakaas-downloads';

let _ran = false;

export async function bootRecovery(): Promise<void> {
  // Idempotent — StrictMode / Fast Refresh must not run the sweep twice.
  if (_ran) return;
  _ran = true;

  // (a) Tear down any orphaned Android foreground service + its stuck
  //     "Downloading…" notification left by a previous crashed session.
  try {
    await notifee.stopForegroundService();
  } catch {
    /* no live service (the common case) or platform without one — ignore. */
  }
  try {
    await notifee.cancelDisplayedNotifications();
  } catch {
    /* ignore — best-effort tray cleanup. */
  }
  try {
    // Also explicitly clear anything posted on the downloads channel in case
    // a notification outlived the service it was attached to.
    await notifee.cancelAllNotifications(undefined, DOWNLOAD_CHANNEL_ID);
  } catch {
    /* older notifee / platform without tag-scoped cancel — ignore. */
  }

  // (b) Purge stranded temp files from the download pipeline. purgeTempDir
  //     is itself fully guarded, but wrap defensively all the same.
  try {
    await purgeTempDir();
  } catch {
    /* ignore — purgeTempDir already swallows its own errors. */
  }
}
