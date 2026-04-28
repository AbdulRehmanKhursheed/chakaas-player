import { Model } from '@nozbe/watermelondb';
import { field, relation } from '@nozbe/watermelondb/decorators';
import type { Relation } from '@nozbe/watermelondb';
import type Playlist from './Playlist';
import type Track from './Track';

export class PlaylistTrack extends Model {
  static table = 'playlist_tracks';

  static associations = {
    playlists: { type: 'belongs_to' as const, key: 'playlist_id' },
    tracks: { type: 'belongs_to' as const, key: 'track_id' },
  };

  @field('playlist_id') playlistId!: string;
  @field('track_id') trackId!: string;
  @field('position') position!: number;

  @relation('playlists', 'playlist_id') playlist!: Relation<Playlist>;
  @relation('tracks', 'track_id') track!: Relation<Track>;
}

export default PlaylistTrack;
