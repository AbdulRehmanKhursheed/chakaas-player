import { recommendationStorage, getJSON, setJSON } from '@/services/storage/mmkv';
import { playsCollection, tracksCollection } from '@/db';
import { Q } from '@nozbe/watermelondb';
import { normalizeVector, lerpVector, Vector6 } from '@/utils/cosine';
import { normalizeTempo } from '@/utils/audio';
import { logger } from '@/utils/logger';

const TASTE_VECTOR_KEY = 'taste_vector';
const DEFAULT_VECTOR: Vector6 = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5];

export function getTasteVector(): Vector6 {
  return getJSON<Vector6>(recommendationStorage, TASTE_VECTOR_KEY) ?? DEFAULT_VECTOR;
}

export function saveTasteVector(v: Vector6): void {
  setJSON(recommendationStorage, TASTE_VECTOR_KEY, v);
}

// Called after a play event is logged — updates taste vector using exponential
// moving average.
// weight: positive for completed plays, negative for skips.
export async function updateTasteVectorFromPlay(
  trackId: string,
  completionRatio: number,
  wasSkipped: boolean,
): Promise<void> {
  try {
    const tracks = await tracksCollection.query(Q.where('id', trackId)).fetch();
    if (!tracks.length) return;
    const track = tracks[0];

    if (track.energy === null || track.energy === undefined) return; // no audio features

    const trackVector: Vector6 = [
      track.energy,
      track.valence ?? 0.5,
      track.danceability ?? 0.5,
      normalizeTempo(track.tempo ?? 120),
      track.acousticness ?? 0.5,
      track.instrumentalness ?? 0.5,
    ];

    const current = getTasteVector();

    // Weight: completed play = +1.0, partial = +completionRatio, skip = -0.3
    const baseWeight = wasSkipped ? -0.3 : completionRatio;
    const learningRate = 0.05; // 5 % per play event
    const effectiveRate = learningRate * Math.abs(baseWeight);

    let updated: Vector6;
    if (baseWeight < 0) {
      // Move taste vector AWAY from the skipped track
      updated = lerpVector(current, trackVector, -effectiveRate) as Vector6;
    } else {
      updated = lerpVector(current, trackVector, effectiveRate) as Vector6;
    }

    saveTasteVector(normalizeVector(updated));
  } catch (err) {
    logger.error('Failed to update taste vector:', err);
  }
}

// Rebuild taste vector from scratch using the last 30 days of plays (for
// nightly recalculation).
export async function rebuildTasteVector(): Promise<void> {
  try {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const plays = await playsCollection
      .query(
        Q.where('played_at', Q.gte(thirtyDaysAgo)),
        Q.sortBy('played_at', Q.desc),
      )
      .fetch();

    if (!plays.length) return;

    const weightedSum: Vector6 = [0, 0, 0, 0, 0, 0];
    let totalWeight = 0;
    const now = Date.now();

    for (const play of plays) {
      const track = await tracksCollection.find(play.trackId);
      if (!track || track.energy === null || track.energy === undefined) continue;

      // Exponential time decay — more recent plays matter more.
      // Half-life: 7 days.
      const ageMs = now - play.playedAt;
      const decayFactor = Math.exp(-ageMs / (7 * 24 * 60 * 60 * 1000));
      const playWeight = play.wasSkipped ? -0.2 : play.completionRatio;
      const weight = Math.max(0, playWeight * decayFactor);

      const vec: Vector6 = [
        track.energy,
        track.valence ?? 0.5,
        track.danceability ?? 0.5,
        normalizeTempo(track.tempo ?? 120),
        track.acousticness ?? 0.5,
        track.instrumentalness ?? 0.5,
      ];

      for (let i = 0; i < 6; i++) {
        weightedSum[i] += vec[i] * weight;
      }
      totalWeight += weight;
    }

    if (totalWeight === 0) return;

    const averaged = weightedSum.map(x => x / totalWeight) as Vector6;
    saveTasteVector(normalizeVector(averaged));
    logger.info('Taste vector rebuilt from', plays.length, 'plays');
  } catch (err) {
    logger.error('Failed to rebuild taste vector:', err);
  }
}
