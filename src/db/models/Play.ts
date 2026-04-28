import { Model } from '@nozbe/watermelondb';
import { field, relation } from '@nozbe/watermelondb/decorators';
import type { Relation } from '@nozbe/watermelondb';
import type Track from './Track';

export class Play extends Model {
  static table = 'plays';

  static associations = {
    tracks: { type: 'belongs_to' as const, key: 'track_id' },
  };

  @field('track_id') trackId!: string;
  @field('played_at') playedAt!: number;
  @field('duration_played_ms') durationPlayedMs!: number;
  @field('completion_ratio') completionRatio!: number;
  @field('was_skipped') wasSkipped!: boolean;

  @relation('tracks', 'track_id') track!: Relation<Track>;
}

export default Play;
