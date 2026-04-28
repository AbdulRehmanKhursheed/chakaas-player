import { Database } from '@nozbe/watermelondb';
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite';
import schema from './schema';
import { Track } from './models/Track';
import { Play } from './models/Play';
import { Playlist } from './models/Playlist';
import { PlaylistTrack } from './models/PlaylistTrack';

const adapter = new SQLiteAdapter({
  schema,
  migrations: undefined,
  jsi: true, // JSI driver works on both architectures on Android
  onSetUpError: (error) => {
    console.error('WatermelonDB setup error:', error);
  },
});

export const database = new Database({
  adapter,
  modelClasses: [Track, Play, Playlist, PlaylistTrack],
});

export const tracksCollection = database.get<Track>('tracks');
export const playsCollection = database.get<Play>('plays');
export const playlistsCollection = database.get<Playlist>('playlists');
export const playlistTracksCollection = database.get<PlaylistTrack>('playlist_tracks');
