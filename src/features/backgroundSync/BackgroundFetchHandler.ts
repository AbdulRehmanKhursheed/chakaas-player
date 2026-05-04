/**
 * BackgroundFetchHandler — daily passive maintenance task.
 *
 * Runs roughly once a day while the app is asleep. Per product rule it does
 * NOT download anything — every download is user-approved through the
 * Downloads screen. The task simply applies time-decay to the artist
 * affinity scores so old listening fades out and recent listening
 * dominates the Discover ranking.
 *
 * `BackgroundFetch.finish()` is always called even on error so the OS
 * doesn't throttle or disable us.
 */

import BackgroundFetch from 'react-native-background-fetch';
import { decayAllScores } from '@/features/recommendations/artistAffinity';
import { logger } from '@/utils/logger';

async function runSync(taskId: string): Promise<void> {
  logger.info('[BackgroundFetch] Task fired:', taskId);
  try {
    decayAllScores();
    logger.info('[BackgroundFetch] Daily affinity decay applied.');
  } catch (err) {
    logger.error('[BackgroundFetch] Sync failed:', err);
  }
}

export async function configureBackgroundFetch(): Promise<void> {
  try {
    const status = await BackgroundFetch.configure(
      {
        minimumFetchInterval: 1440, // 24 hours in minutes
        stopOnTerminate: false,
        startOnBoot: true,
        enableHeadless: true,
        requiredNetworkType: BackgroundFetch.NETWORK_TYPE_ANY,
      },
      async (taskId) => {
        await runSync(taskId);
        BackgroundFetch.finish(taskId);
      },
      (taskId) => {
        logger.warn('[BackgroundFetch] Timeout for task:', taskId);
        BackgroundFetch.finish(taskId);
      },
    );

    logger.info('[BackgroundFetch] Configured, status:', status);
  } catch (err) {
    logger.error('[BackgroundFetch] Configuration failed:', err);
  }
}

export async function BackgroundFetchHeadlessTask(event: { taskId: string }): Promise<void> {
  await runSync(event.taskId);
  BackgroundFetch.finish(event.taskId);
}
