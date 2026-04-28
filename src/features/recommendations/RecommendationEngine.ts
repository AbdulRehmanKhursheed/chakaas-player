import { tracksCollection, playsCollection } from '@/db';
import { Q } from '@nozbe/watermelondb';
import { getTasteVector } from './TasteVectorService';
import { cosineSimilarity, Vector6 } from '@/utils/cosine';
import { normalizeTempo } from '@/utils/audio';
import { Track } from '@/types/track';
import { logger } from '@/utils/logger';

// ---------------------------------------------------------------------------
// Library recommendations
// ---------------------------------------------------------------------------

/**
 * Returns tracks already in the library ranked by cosine similarity to the
 * current taste vector. Only tracks that have been enriched with audio
 * features (energy != null) are considered.
 */
export async function getRecommendedFromLibrary(limit = 20): Promise<Track[]> {
  try {
    const tasteVector = getTasteVector();
    const allTracks = await tracksCollection.query().fetch();

    const scored = allTracks
      .filter(
        (t) => t.energy !== null && t.energy !== undefined,
      )
      .map((t) => {
        const vec: Vector6 = [
          t.energy!,
          t.valence ?? 0.5,
          t.danceability ?? 0.5,
          normalizeTempo(t.tempo ?? 120),
          t.acousticness ?? 0.5,
          t.instrumentalness ?? 0.5,
        ];
        const score = cosineSimilarity(tasteVector, vec);
        return { track: t, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return scored.map((s): Track => ({
      id: s.track.id,
      title: s.track.title,
      artist: s.track.artist,
      album: s.track.album ?? '',
      genre: s.track.genre ?? '',
      duration_ms: s.track.durationMs,
      file_path: s.track.filePath,
      artwork_path: s.track.artworkPath ?? null,
      youtube_id: s.track.youtubeId ?? null,
      spotify_id: s.track.spotifyId ?? null,
      features:
        s.track.energy !== null && s.track.energy !== undefined
          ? {
              energy: s.track.energy!,
              valence: s.track.valence ?? 0.5,
              danceability: s.track.danceability ?? 0.5,
              tempo: s.track.tempo ?? 0,
              acousticness: s.track.acousticness ?? 0.5,
              instrumentalness: s.track.instrumentalness ?? 0.5,
            }
          : null,
      added_at: s.track.addedAt,
      source: s.track.source as 'youtube' | 'local',
      liked: s.track.liked,
    }));
  } catch (err) {
    logger.error('Recommendation engine error:', err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Daily pick candidates
// ---------------------------------------------------------------------------

/**
 * Returns the top 5 most-played tracks from the last 7 days (skips excluded)
 * as `{ title, artist }` search-query objects. These are used by the
 * background sync handler to find similar tracks on YouTube to auto-download.
 */
export async function getDailyPickCandidates(): Promise<
  { title: string; artist: string }[]
> {
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  const recentPlays = await playsCollection
    .query(
      Q.where('played_at', Q.gte(sevenDaysAgo)),
      Q.where('was_skipped', false),
    )
    .fetch();

  // Group by track_id and count plays
  const playCounts = new Map<string, number>();
  for (const play of recentPlays) {
    playCounts.set(play.trackId, (playCounts.get(play.trackId) ?? 0) + 1);
  }

  const topTrackIds = [...playCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id]) => id);

  const topTracks = await Promise.all(
    topTrackIds.map((id) => tracksCollection.find(id)),
  );

  return topTracks
    .filter((t): t is NonNullable<typeof t> => t !== null && t !== undefined)
    .map((t) => ({ title: t.title, artist: t.artist }));
}
