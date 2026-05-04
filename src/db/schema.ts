import { appSchema, tableSchema } from '@nozbe/watermelondb';

const schema = appSchema({
  version: 2,
  tables: [
    tableSchema({
      name: 'tracks',
      columns: [
        { name: 'title', type: 'string' },
        { name: 'artist', type: 'string' },
        { name: 'album', type: 'string', isOptional: true },
        { name: 'genre', type: 'string', isOptional: true },
        { name: 'duration_ms', type: 'number' },
        { name: 'file_path', type: 'string' },
        { name: 'artwork_path', type: 'string', isOptional: true },
        { name: 'youtube_id', type: 'string', isOptional: true, isIndexed: true },
        { name: 'saavn_id', type: 'string', isOptional: true, isIndexed: true },
        { name: 'spotify_id', type: 'string', isOptional: true },
        { name: 'energy', type: 'number', isOptional: true },
        { name: 'valence', type: 'number', isOptional: true },
        { name: 'danceability', type: 'number', isOptional: true },
        { name: 'tempo', type: 'number', isOptional: true },
        { name: 'acousticness', type: 'number', isOptional: true },
        { name: 'instrumentalness', type: 'number', isOptional: true },
        { name: 'added_at', type: 'number', isIndexed: true },
        { name: 'source', type: 'string' },
        { name: 'liked', type: 'boolean' },
      ],
    }),
    tableSchema({
      name: 'plays',
      columns: [
        { name: 'track_id', type: 'string', isIndexed: true },
        { name: 'played_at', type: 'number', isIndexed: true },
        { name: 'duration_played_ms', type: 'number' },
        { name: 'completion_ratio', type: 'number' },
        { name: 'was_skipped', type: 'boolean' },
      ],
    }),
    tableSchema({
      name: 'playlists',
      columns: [
        { name: 'name', type: 'string' },
        { name: 'created_at', type: 'number' },
        { name: 'artwork_path', type: 'string', isOptional: true },
      ],
    }),
    tableSchema({
      name: 'playlist_tracks',
      columns: [
        { name: 'playlist_id', type: 'string', isIndexed: true },
        { name: 'track_id', type: 'string', isIndexed: true },
        { name: 'position', type: 'number' },
      ],
    }),
  ],
});

export default schema;
