import { Model } from '@nozbe/watermelondb';
import { field, text, children } from '@nozbe/watermelondb/decorators';
import type { Query } from '@nozbe/watermelondb';
import type PlaylistTrack from './PlaylistTrack';

export class Playlist extends Model {
  static table = 'playlists';

  static associations = {
    playlist_tracks: { type: 'has_many' as const, foreignKey: 'playlist_id' },
  };

  @text('name') name!: string;
  @field('created_at') createdAt!: number;
  @text('artwork_path') artworkPath!: string | null;

  @children('playlist_tracks') playlistTracks!: Query<PlaylistTrack>;
}

export default Playlist;
