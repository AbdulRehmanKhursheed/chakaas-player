/**
 * BackgroundFetchHandler — registers a daily passive-analytics task that
 * runs while the app is sleeping.
 *
 * IMPORTANT: this task NEVER initiates downloads. Per product rule, every
 * download must be explicitly approved by the user via the Downloads
 * screen's "Find Songs" flow. The background task only:
 *
 *   1. Rebuilds the taste vector from the last 30 days of play history,
 *      so the next time the user opens the app, the recommendations are
 *      already fresh.
 *   2. Enriches any un-featured tracks with Spotify audio features.
 *
 * BackgroundFetch.finish() is ALWAYS called — even on error — to prevent
 * the OS from throttling or disabling the task.
 */

import BackgroundFetch from 'react-native-background-fetch';
import { rebuildTasteVector } from '@/features/recommendations/TasteVectorService';
import { enrichTracksWithSpotifyFeatures } from '@/features/recommendations/SpotifyAudioFeatures';
import { logger } from '@/utils/logger';

// ---------------------------------------------------------------------------
// Task handler
// ---------------------------------------------------------------------------

/**
 * Passive-analytics sync. Runs in the background once a day, never
 * downloads anything. Extracted so it can be reused by both the standard
 * and headless task paths.
 */
async function runSync(taskId: string): Promise<void> {
  logger.info('[BackgroundFetch] Task fired:', taskId);

  try {
    // 1. Rebuild taste vector from recent play history
    await rebuildTasteVector();

    // 2. Enrich tracks that are missing Spotify audio features
    await enrichTracksWithSpotifyFeatures();

    logger.info('[BackgroundFetch] Sync complete (analytics-only, no downloads)');
  } catch (err) {
    logger.error('[BackgroundFetch] Sync failed:', err);
  }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Configures and registers the background-fetch task.
 * Call once from the app's root entry point (e.g. App.tsx) after the store
 * and database have been initialised.
 *
 * The returned Promise resolves after configuration; any error from
 * BackgroundFetch.configure() is logged and swallowed so a failure here does
 * not crash the app.
 */
export async function configureBackgroundFetch(): Promise<void> {
  try {
    const status = await BackgroundFetch.configure(
      {
        minimumFetchInterval: 1440, // 24 hours in minutes
        stopOnTerminate: false,     // continue after app is swiped away
        startOnBoot: true,          // reschedule after device reboot
        enableHeadless: true,       // support Android headless task
        requiredNetworkType: BackgroundFetch.NETWORK_TYPE_ANY,
      },
      async (taskId) => {
        await runSync(taskId);
        // Always finish — required by both iOS and Android
        BackgroundFetch.finish(taskId);
      },
      (taskId) => {
        // Timeout handler: OS killed the task before it completed
        logger.warn('[BackgroundFetch] Timeout for task:', taskId);
        BackgroundFetch.finish(taskId);
      },
    );

    logger.info('[BackgroundFetch] Configured, status:', status);
  } catch (err) {
    logger.error('[BackgroundFetch] Configuration failed:', err);
  }
}

// ---------------------------------------------------------------------------
// Headless task (Android only)
// ---------------------------------------------------------------------------

/**
 * Headless entry-point for Android. Register this with
 * `BackgroundFetch.registerHeadlessTask(BackgroundFetchHeadlessTask)` in
 * your index.js before `AppRegistry.registerComponent`.
 */
export async function BackgroundFetchHeadlessTask(event: { taskId: string }): Promise<void> {
  await runSync(event.taskId);
  BackgroundFetch.finish(event.taskId);
}
