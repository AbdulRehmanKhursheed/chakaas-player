import { getAudioFeatures, searchTrack } from '@/services/api/spotify';
import { tracksCollection, database } from '@/db';
import { Q } from '@nozbe/watermelondb';
import { logger } from '@/utils/logger';

/**
 * Enrich up to 50 library tracks (per call) that have no audio-feature data
 * by querying the Spotify Web API. Designed to be run nightly from the
 * background fetch handler.
 *
 * Pipeline per track:
 *   1. Search Spotify by "title artist" to obtain a Spotify track ID.
 *   2. Fetch audio features for that ID.
 *   3. Persist energy / valence / danceability / tempo / acousticness /
 *      instrumentalness into the WatermelonDB record.
 *
 * A 100 ms delay is inserted between track requests to respect Spotify's
 * rate limits under the Client Credentials flow.
 */
export async function enrichTracksWithSpotifyFeatures(): Promise<void> {
  try {
    // Fetch up to 50 un-enriched tracks in one DB query
    const tracks = await tracksCollection
      .query(
        Q.where('energy', Q.eq(null)),
        Q.take(50),
      )
      .fetch();

    if (!tracks.length) {
      logger.info('[SpotifyAudioFeatures] No tracks to enrich');
      return;
    }

    let enrichedCount = 0;

    for (const track of tracks) {
      try {
        // Step 1 — search Spotify
        const results = await searchTrack(`${track.title} ${track.artist}`);
        if (!results.length) continue;

        const spotifyId = results[0].id;

        // Step 2 — fetch audio features
        const features = await getAudioFeatures([spotifyId]);
        if (!features.length) continue;

        const f = features[0];

        // Step 3 — persist to DB
        await database.write(async () => {
          await track.update((t) => {
            t.spotifyId = spotifyId;
            t.energy = f.energy;
            t.valence = f.valence;
            t.danceability = f.danceability;
            t.tempo = f.tempo;
            t.acousticness = f.acousticness;
            t.instrumentalness = f.instrumentalness;
          });
        });

        enrichedCount++;
      } catch (err) {
        logger.warn('[SpotifyAudioFeatures] Failed to enrich track:', track.title, err);
      }

      // Rate-limit guard: 100 ms between Spotify requests
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
    }

    logger.info('[SpotifyAudioFeatures] Enriched', enrichedCount, 'of', tracks.length, 'tracks');
  } catch (err) {
    logger.error('[SpotifyAudioFeatures] Feature enrichment failed:', err);
  }
}
