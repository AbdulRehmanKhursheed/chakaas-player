/**
 * Android runtime permissions helper.
 *
 * Handles the API-level split introduced in Android 13 (API 33):
 *   - API ≥ 33: READ_MEDIA_AUDIO replaces READ/WRITE_EXTERNAL_STORAGE
 *               POST_NOTIFICATIONS is a runtime permission
 *   - API < 33: READ_EXTERNAL_STORAGE + WRITE_EXTERNAL_STORAGE
 *               POST_NOTIFICATIONS does not exist (implicitly granted)
 */

import { PermissionsAndroid, Platform } from 'react-native';
import { logger } from '@/utils/logger';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Returns the Android API level, or 0 on non-Android platforms. */
function getApiLevel(): number {
  if (Platform.OS !== 'android') return 0;
  return (Platform.Version as number) ?? 0;
}

// ---------------------------------------------------------------------------
// Storage permissions
// ---------------------------------------------------------------------------

/**
 * Requests the storage permission(s) needed to read audio files.
 *
 * - API ≥ 33: requests `READ_MEDIA_AUDIO` only
 * - API < 33: requests `READ_EXTERNAL_STORAGE` and `WRITE_EXTERNAL_STORAGE`
 *
 * Returns `true` when all required permissions are granted.
 */
export async function requestStoragePermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;

  const api = getApiLevel();

  try {
    if (api >= 33) {
      const result = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.READ_MEDIA_AUDIO,
        {
          title: 'Audio Library Access',
          message: 'Chakaas Player needs access to your audio files to play music from your device.',
          buttonPositive: 'Allow',
          buttonNegative: 'Deny',
          buttonNeutral: 'Ask Later',
        },
      );
      const granted = result === PermissionsAndroid.RESULTS.GRANTED;
      logger.info('[Permissions] READ_MEDIA_AUDIO:', result);
      return granted;
    } else {
      const results = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
        PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
      ]);

      const readGranted =
        results[PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE] ===
        PermissionsAndroid.RESULTS.GRANTED;
      const writeGranted =
        results[PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE] ===
        PermissionsAndroid.RESULTS.GRANTED;

      logger.info('[Permissions] READ_EXTERNAL_STORAGE:', results[PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE]);
      logger.info('[Permissions] WRITE_EXTERNAL_STORAGE:', results[PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE]);

      return readGranted && writeGranted;
    }
  } catch (error) {
    logger.error('[Permissions] requestStoragePermission failed:', error);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Notification permissions
// ---------------------------------------------------------------------------

/**
 * Requests the `POST_NOTIFICATIONS` permission introduced in Android 13.
 *
 * On API < 33 this permission does not exist and is considered implicitly
 * granted, so the function returns `true` immediately.
 *
 * Returns `true` when the permission is granted (or not required).
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;

  const api = getApiLevel();

  if (api < 33) {
    // POST_NOTIFICATIONS doesn't exist below API 33; always considered granted
    return true;
  }

  try {
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
      {
        title: 'Notification Permission',
        message: 'Chakaas Player needs this permission to show playback controls in the notification shade.',
        buttonPositive: 'Allow',
        buttonNegative: 'Deny',
        buttonNeutral: 'Ask Later',
      },
    );
    const granted = result === PermissionsAndroid.RESULTS.GRANTED;
    logger.info('[Permissions] POST_NOTIFICATIONS:', result);
    return granted;
  } catch (error) {
    logger.error('[Permissions] requestNotificationPermission failed:', error);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Combined helper
// ---------------------------------------------------------------------------

export interface PermissionResults {
  storage: boolean;
  notifications: boolean;
}

/**
 * Requests both storage and notification permissions and returns a map of
 * individual results.
 */
export async function requestAllPermissions(): Promise<PermissionResults> {
  const [storage, notifications] = await Promise.all([
    requestStoragePermission(),
    requestNotificationPermission(),
  ]);

  logger.info('[Permissions] All results — storage:', storage, '| notifications:', notifications);

  return { storage, notifications };
}
