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
 */
import {
  schemaMigrations,
  addColumns,
} from '@nozbe/watermelondb/Schema/migrations';

export default schemaMigrations({
  migrations: [
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
