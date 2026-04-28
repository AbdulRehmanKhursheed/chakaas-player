/**
 * GlobalSheets — single mount-point for app-wide bottom sheets.
 *
 * Currently hosts the TrackContextMenu, opened from any track long-press via
 * `useUIStore.getState().openSheet('track-context', trackId)`. The sheet
 * looks up the track by id from WatermelonDB and exposes Like/Delete/queue
 * handlers in one place so individual screens don't have to reimplement them.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';
import TrackPlayer from 'react-native-track-player';
import RNBlobUtil from 'react-native-blob-util';

import { useUIStore } from '@/stores/uiStore';
import { tracksCollection, database } from '@/db';
import { TrackContextMenu } from '@/components/track/TrackContextMenu';
import { modelToTrack } from '@/utils/trackMapper';
import { usePlayerQueue } from '@/features/player/useQueue';
import type { Track } from '@/types/track';
import { logger } from '@/utils/logger';

export function GlobalSheets() {
  const activeSheet = useUIStore((s) => s.activeSheet);
  const activeSheetTrackId = useUIStore((s) => s.activeSheetTrackId);
  const closeSheet = useUIStore((s) => s.closeSheet);
  const { playNext, addTrack } = usePlayerQueue();

  const [track, setTrack] = useState<Track | null>(null);

  // Hydrate the track from DB whenever the sheet opens with a new id.
  useEffect(() => {
    let cancelled = false;
    if (activeSheet !== 'track-context' || !activeSheetTrackId) {
      setTrack(null);
      return;
    }
    (async () => {
      try {
        const model = await tracksCollection.find(activeSheetTrackId);
        if (!cancelled) setTrack(modelToTrack(model));
      } catch (err) {
        logger.warn('[GlobalSheets] track lookup failed:', err);
        if (!cancelled) setTrack(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeSheet, activeSheetTrackId]);

  // ── Handlers ───────────────────────────────────────────────────────────

  const handlePlayNext = useCallback(
    (t: Track) => {
      void playNext(t);
    },
    [playNext],
  );

  const handleAddToQueue = useCallback(
    (t: Track) => {
      void addTrack(t);
    },
    [addTrack],
  );

  const handleToggleLike = useCallback(async (t: Track) => {
    try {
      const model = await tracksCollection.find(t.id);
      await database.write(async () => {
        await model.update((rec) => {
          rec.liked = !rec.liked;
        });
      });
    } catch (err) {
      logger.error('[GlobalSheets] toggle like failed:', err);
    }
  }, []);

  const handleDelete = useCallback((t: Track) => {
    // Two-step confirm — destructive action.
    Alert.alert(
      'Delete song?',
      `"${t.title}" will be removed from your library and from disk.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              // 1. Remove from RNTP queue if present (and stop if active).
              try {
                const queue = await TrackPlayer.getQueue();
                const queueIdx = queue.findIndex((q) => q.id === t.id);
                if (queueIdx >= 0) {
                  const activeIdx = await TrackPlayer.getActiveTrackIndex();
                  if (activeIdx === queueIdx) {
                    await TrackPlayer.stop();
                  }
                  await TrackPlayer.remove(queueIdx);
                }
              } catch {
                // RNTP not initialised or queue empty — fine.
              }

              // 2. Delete files from disk (best-effort).
              for (const path of [t.file_path, t.artwork_path].filter(
                Boolean,
              ) as string[]) {
                try {
                  if (await RNBlobUtil.fs.exists(path)) {
                    await RNBlobUtil.fs.unlink(path);
                  }
                } catch (err) {
                  logger.warn('[GlobalSheets] file delete failed:', path, err);
                }
              }

              // 3. Remove DB record.
              const model = await tracksCollection.find(t.id);
              await database.write(async () => {
                await model.destroyPermanently();
              });

              logger.info(`[GlobalSheets] Deleted "${t.title}".`);
            } catch (err) {
              logger.error('[GlobalSheets] delete failed:', err);
              Alert.alert('Could not delete', String(err));
            }
          },
        },
      ],
    );
  }, []);

  const isVisible = activeSheet === 'track-context' && track != null;

  return (
    <TrackContextMenu
      track={track}
      isVisible={isVisible}
      onClose={closeSheet}
      onPlayNext={handlePlayNext}
      onAddToQueue={handleAddToQueue}
      onToggleLike={handleToggleLike}
      onDelete={handleDelete}
    />
  );
}
