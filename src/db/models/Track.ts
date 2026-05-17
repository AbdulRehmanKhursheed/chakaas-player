import { Model } from '@nozbe/watermelondb';
import { field, text, children, writer } from '@nozbe/watermelondb/decorators';
import type { Query } from '@nozbe/watermelondb';
import type Play from './Play';
import type PlaylistTrack from './PlaylistTrack';

/**
 * Track model.
 *
 * Note: the underlying `tracks` table still has unused columns from a
 * removed Spotify-features experiment (`spotify_id`, `energy`, `valence`,
 * `danceability`, `tempo`, `acousticness`, `instrumentalness`). They're
 * left in the schema because dropping columns from SQLite + WatermelonDB
 * mid-flight risks data loss for users who already have a local DB. The
 * model below simply doesn't expose them, so reads/writes go through the
 * fields we care about and the dead columns stay null forever.
 */
export class Track extends Model {
  static table = 'tracks';

  static associations = {
    plays: { type: 'has_many' as const, foreignKey: 'track_id' },
    playlist_tracks: { type: 'has_many' as const, foreignKey: 'track_id' },
  };

  @text('title') title!: string;
  @text('artist') artist!: string;
  @text('album') album!: string | null;
  @text('genre') genre!: string | null;
  @field('duration_ms') durationMs!: number;
  @text('file_path') filePath!: string;
  @text('artwork_path') artworkPath!: string | null;
  @text('youtube_id') youtubeId!: string | null;
  @text('saavn_id') saavnId!: string | null;
  @field('added_at') addedAt!: number;
  @text('source') source!: string;
  @field('liked') liked!: boolean;
  @field('play_count') playCount!: number;

  @children('plays') plays!: Query<Play>;
  @children('playlist_tracks') playlistTracks!: Query<PlaylistTrack>;

  @writer async like(): Promise<void> {
    await this.update((record) => {
      record.liked = true;
    });
  }

  @writer async unlike(): Promise<void> {
    await this.update((record) => {
      record.liked = false;
    });
  }
}

export default Track;
