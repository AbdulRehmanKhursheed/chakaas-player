/**
 * WatermelonDB schema migrations.
 *
 * Migrations run in order to bring an existing on-device DB up to the current
 * `appSchema.version`. Always pair a schema bump with a migration step so
 * existing user libraries survive the upgrade.
 *
 * v1 → v2: introduce `saavn_id` column on tracks. Allows storing songs
 *          downloaded from JioSaavn (the Bloomee-style Indian-music source)
 *          alongside the existing YouTube-sourced tracks. The column is
 *          optional so legacy YouTube rows continue to validate.
 *
 * v2 → v3: denormalise play counts onto `tracks.play_count`. Lets the
 *          MostPlayed / PlayCounts hooks read a single column instead of
 *          scanning every Plays row on each emit. New rows default to 0;
 *          existing rows are backfilled by `backfillPlayCounts()` on the
 *          next app launch.
 */
import {
  schemaMigrations,
  addColumns,
} from '@nozbe/watermelondb/Schema/migrations';

export default schemaMigrations({
  migrations: [
    {
      toVersion: 3,
      steps: [
        addColumns({
          table: 'tracks',
          columns: [
            { name: 'play_count', type: 'number' },
          ],
        }),
      ],
    },
    {
      toVersion: 2,
      steps: [
        addColumns({
          table: 'tracks',
          columns: [
            { name: 'saavn_id', type: 'string', isOptional: true, isIndexed: true },
          ],
        }),
      ],
    },
  ],
});
