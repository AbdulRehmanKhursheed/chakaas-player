/**
 * DownloadNotificationService
 *
 * Manages all @notifee/react-native interactions for the download pipeline:
 *
 *  - Creates and maintains the "Downloads" notification channel (LOW importance,
 *    no sound / vibration — persistent progress bars must not disturb the user).
 *  - Starts an Android Foreground Service tied to a persistent progress
 *    notification so that the OS keeps the JS thread alive even when the screen
 *    is off or the app is removed from the recent-apps tray.
 *  - Updates the foreground notification in-place as each download progresses.
 *  - Posts a brief "Done" or "Failed" notification once the session ends.
 *  - Exposes a foreground-event listener so the UI thread can respond to the
 *    "Cancel" / "Cancel All" action buttons inside the notification.
 *
 * Design notes
 * ────────────
 *  • The foreground notification ID is a stable string constant. notifee
 *    updates an existing notification instead of posting a new one whenever the
 *    same `id` is reused, so there is never more than one foreground notification
 *    in the tray at a time.
 *  • `_channelCreated` is an in-process singleton guard. The channel survives
 *    across app sessions (Android persists channels), so after the first call per
 *    process the guard prevents redundant IPC round-trips to the OS.
 *  • `onBackgroundEvent` must be registered at module scope (before the Metro
 *    bundle finishes evaluating) according to the notifee docs for Android
 *    background events. The DownloadManagerClass constructor does this.
 *  • `onForegroundEvent` returns an unsubscribe function; callers should invoke
 *    it when the component/manager that registered it unmounts or shuts down.
 */

import notifee, {
  AndroidImportance,
  AndroidCategory,
  AndroidVisibility,
  EventType,
  type Event,
} from '@notifee/react-native';
import { logger } from '@/utils/logger';

// ── Constants ──────────────────────────────────────────────────────────────

/** Notification channel that carries all download-related notifications. */
const CHANNEL_ID = 'chakaas-downloads';
const CHANNEL_NAME = 'Downloads';

/**
 * Stable ID for the foreground-service notification.
 * Using the same ID causes notifee to *update* the existing notification in
 * place rather than posting a new one — critical for smooth progress updates.
 */
const FOREGROUND_NOTIFICATION_ID = 'chakaas-dl-foreground';

/**
 * Stable ID for the rolling "downloads failed" notification. All failures
 * during a session share this ID so that 12 failures don't produce 12 toasts
 * in the tray — they collapse into a single rolling notification with a
 * running count.
 */
const ERROR_NOTIFICATION_ID = 'chakaas-dl-errors';

/** Max recent titles preserved in the rolling error notification body. */
const ERROR_TITLE_BUFFER = 3;

// ── Module-level state ─────────────────────────────────────────────────────

/** Guards against redundant channel-creation calls within the same process. */
let _channelCreated = false;

/** Count of errors seen since the last `resetErrorNotificationState()`. */
let _errorCount = 0;
/** Rolling buffer of the most recent failed titles, oldest first. */
let _recentErrorTitles: string[] = [];

/**
 * Resets the rolling error-notification state. Called by DownloadManager at
 * the start of each new pool run so that the "N downloads failed" count is
 * scoped to the current session.
 */
export function resetErrorNotificationState(): void {
  _errorCount = 0;
  _recentErrorTitles = [];
}

// ── Channel management ─────────────────────────────────────────────────────

/**
 * Creates the downloads notification channel the first time it is called per
 * process. Subsequent calls are instant no-ops (channel already exists on
 * Android and in our in-process cache).
 *
 * Channel settings:
 *  - LOW importance  → no heads-up pop-over, no sound, no vibration
 *  - badge: false    → ongoing downloads don't pollute the launcher badge count
 */
export async function ensureNotificationChannel(): Promise<void> {
  if (_channelCreated) return;

  await notifee.createChannel({
    id: CHANNEL_ID,
    name: CHANNEL_NAME,
    importance: AndroidImportance.LOW,
    sound: '',        // empty string = silent
    vibration: false,
    badge: false,
  });

  _channelCreated = true;
  logger.info('[DownloadNotificationService] Notification channel ready.');
}

// ── Foreground service lifecycle ───────────────────────────────────────────

/**
 * Displays the persistent foreground-service notification and starts the
 * Android Foreground Service, which prevents the OS from killing the JS
 * thread while downloads are in progress.
 *
 * Must be called once before the first download starts.  Subsequent calls
 * update the notification in place (same `id`).
 *
 * @param title  Human-readable title of the first track being downloaded.
 */
export async function startDownloadForegroundService(title: string): Promise<void> {
  await ensureNotificationChannel();

  await notifee.displayNotification({
    id: FOREGROUND_NOTIFICATION_ID,
    title: 'Chakaas — Downloading',
    body: `Starting: ${title}`,
    android: {
      channelId: CHANNEL_ID,
      // Binding this notification to a foreground service keeps the process
      // alive and must be set every time the notification is displayed/updated.
      asForegroundService: true,
      // `ongoing: true` prevents the user from swiping the notification away.
      ongoing: true,
      // Suppress the alert sound on subsequent updates (progress changes).
      onlyAlertOnce: true,
      importance: AndroidImportance.LOW,
      smallIcon: 'ic_launcher',
      category: AndroidCategory.SERVICE,
      visibility: AndroidVisibility.PUBLIC,
      progress: {
        max: 100,
        current: 0,
        indeterminate: false,
      },
      actions: [
        {
          title: 'Cancel All',
          pressAction: { id: 'cancel-all' },
        },
      ],
    },
  });

  logger.info(`[DownloadNotificationService] Foreground service started for "${title}".`);
}

/**
 * Updates the foreground-service notification with the current download's
 * progress percentage and queue depth.
 *
 * This function is called frequently (every ~200 ms during the raw download
 * phase and each FFmpeg statistics tick during conversion), so it must be
 * fast. notifee batches notification updates on Android, so calling this
 * frequently does not flood the notification shade.
 *
 * @param title       Track title currently being processed.
 * @param artist      Track artist currently being processed.
 * @param progress    Overall progress percentage for this item, 0–100.
 * @param queueLength Number of items currently active or still queued
 *                    (including the current item).
 */
export async function updateDownloadProgress(
  title: string,
  artist: string,
  progress: number,
  queueLength: number,
): Promise<void> {
  // Build the body line: "Artist - Title (42%)  •  3 more in queue"
  const queueSuffix =
    queueLength > 1 ? `  •  ${queueLength - 1} more in queue` : '';
  const body = `${artist} – ${title} (${Math.round(progress)}%)${queueSuffix}`;

  await notifee.displayNotification({
    id: FOREGROUND_NOTIFICATION_ID,
    title: 'Chakaas — Downloading',
    body,
    android: {
      channelId: CHANNEL_ID,
      asForegroundService: true,
      ongoing: true,
      onlyAlertOnce: true,
      importance: AndroidImportance.LOW,
      smallIcon: 'ic_launcher',
      category: AndroidCategory.SERVICE,
      visibility: AndroidVisibility.PUBLIC,
      progress: {
        max: 100,
        current: Math.round(progress),
        indeterminate: false,
      },
      actions: [
        {
          title: 'Cancel',
          pressAction: { id: 'cancel-current' },
        },
        {
          title: 'Cancel All',
          pressAction: { id: 'cancel-all' },
        },
      ],
    },
  });
}

/**
 * Stops the Android Foreground Service and dismisses the persistent progress
 * notification. If any tracks were completed this session, posts a brief
 * "Downloads complete" summary notification (dismissible, not ongoing).
 *
 * @param completedCount Number of tracks successfully added to the library
 *                       during this download session.
 */
export async function stopDownloadForegroundService(
  completedCount: number,
): Promise<void> {
  // Tear down the foreground service. This also removes the persistent
  // notification bound to it.
  await notifee.stopForegroundService();

  if (completedCount > 0) {
    await ensureNotificationChannel();
    await notifee.displayNotification({
      title: 'Downloads Complete',
      body: `${completedCount} song${completedCount !== 1 ? 's' : ''} added to your library`,
      android: {
        channelId: CHANNEL_ID,
        importance: AndroidImportance.DEFAULT,
        smallIcon: 'ic_launcher',
      },
    });
  }

  logger.info(
    `[DownloadNotificationService] Foreground service stopped. ` +
    `Completed this session: ${completedCount}.`,
  );
}

// ── Error notification ─────────────────────────────────────────────────────

/**
 * Posts (or updates) the rolling error notification for a track that failed
 * to download. All errors during a session share a single notification ID,
 * collapsing into a single tray entry that reads e.g.:
 *
 *     "3 downloads failed — tap to view"
 *     Song A, Song B, Song C
 *
 * The notification is not ongoing and can be dismissed by the user.
 *
 * @param title   Track title that failed.
 * @param reason  Human-readable failure reason (used only for the first error
 *                so that a single-track failure still shows a useful message).
 */
export async function showDownloadError(
  title: string,
  reason: string,
): Promise<void> {
  await ensureNotificationChannel();

  _errorCount += 1;
  _recentErrorTitles.push(title);
  if (_recentErrorTitles.length > ERROR_TITLE_BUFFER) {
    _recentErrorTitles = _recentErrorTitles.slice(-ERROR_TITLE_BUFFER);
  }

  let displayTitle: string;
  let displayBody: string;
  if (_errorCount === 1) {
    displayTitle = 'Download Failed';
    displayBody = `${title}: ${reason}`;
  } else {
    displayTitle = `${_errorCount} downloads failed — tap to view`;
    displayBody = _recentErrorTitles.join(', ');
  }

  await notifee.displayNotification({
    id: ERROR_NOTIFICATION_ID,
    title: displayTitle,
    body: displayBody,
    android: {
      channelId: CHANNEL_ID,
      importance: AndroidImportance.DEFAULT,
      smallIcon: 'ic_launcher',
      onlyAlertOnce: true,
    },
  });

  logger.warn(
    `[DownloadNotificationService] Error notification (count=${_errorCount}): "${title}" — ${reason}`,
  );
}

// ── Foreground event listener ──────────────────────────────────────────────

/**
 * Registers a foreground-event handler that fires when the user taps the
 * "Cancel" or "Cancel All" action buttons on the download notification while
 * the app is in the foreground.
 *
 * Returns the unsubscribe function returned by `notifee.onForegroundEvent`.
 * Callers should invoke the returned function when the manager shuts down to
 * prevent memory leaks.
 *
 * Note: Background events (app killed / screen off) are handled separately in
 * `DownloadManagerClass` via `notifee.onBackgroundEvent`, which must be
 * registered at module scope before any async work begins.
 *
 * @param onCancelCurrent  Callback invoked when the user taps "Cancel".
 * @param onCancelAll      Callback invoked when the user taps "Cancel All".
 * @returns Unsubscribe function — call when done.
 */
export function registerForegroundEventHandler(
  onCancelCurrent: () => void,
  onCancelAll: () => void,
): () => void {
  return notifee.onForegroundEvent(({ type, detail }: Event) => {
    if (type === EventType.ACTION_PRESS) {
      const actionId = detail.pressAction?.id;
      logger.info(`[DownloadNotificationService] Foreground action pressed: ${actionId}`);
      if (actionId === 'cancel-current') onCancelCurrent();
      if (actionId === 'cancel-all') onCancelAll();
    }
  });
}
