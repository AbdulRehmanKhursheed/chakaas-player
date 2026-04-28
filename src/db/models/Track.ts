import { Model } from '@nozbe/watermelondb';
import { field, text, children, writer } from '@nozbe/watermelondb/decorators';
import type { Query } from '@nozbe/watermelondb';
import type Play from './Play';
import type PlaylistTrack from './PlaylistTrack';

export type AudioFeatures = {
  energy: number;
  valence: number;
  danceability: number;
  tempo: number;
  acousticness: number;
  instrumentalness: number;
};

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
  @text('spotify_id') spotifyId!: string | null;
  @field('energy') energy!: number | null;
  @field('valence') valence!: number | null;
  @field('danceability') danceability!: number | null;
  @field('tempo') tempo!: number | null;
  @field('acousticness') acousticness!: number | null;
  @field('instrumentalness') instrumentalness!: number | null;
  @field('added_at') addedAt!: number;
  @text('source') source!: string;
  @field('liked') liked!: boolean;

  @children('plays') plays!: Query<Play>;
  @children('playlist_tracks') playlistTracks!: Query<PlaylistTrack>;

  get features(): AudioFeatures | null {
    if (this.energy === null || this.energy === undefined) {
      return null;
    }
    return {
      energy: this.energy,
      valence: this.valence ?? 0,
      danceability: this.danceability ?? 0,
      tempo: this.tempo ?? 0,
      acousticness: this.acousticness ?? 0,
      instrumentalness: this.instrumentalness ?? 0,
    };
  }

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
