import { getTableConfig } from 'drizzle-orm/pg-core';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { runMigrations } from '../../db';
import { createTestDatabase, hasDatabase } from '../../testing';
import { calEventPeople, calEvents, calLayers, calSettings } from './schema';

type Column = { name: string; type: string; not_null: boolean; has_default: boolean };

describe.skipIf(!hasDatabase)('calendar tables', () => {
  it('are created exactly as the Drizzle definitions describe them', async () => {
    const database = await createTestDatabase();
    const pool = new pg.Pool({ connectionString: database.url, max: 2 });
    try {
      const applied = await runMigrations(pool);
      expect(applied).toContain('202610271200_calendar_events.sql');
      expect(applied).toContain('202610271300_calendar_layers.sql');
      expect(applied).toContain('202610271400_calendar_settings.sql');
      for (const table of [calEvents, calEventPeople, calLayers, calSettings]) {
        const config = getTableConfig(table);
        const { rows } = await pool.query<Column>(
          `SELECT attname AS name, format_type(atttypid, atttypmod) AS type,
                  attnotnull AS not_null, atthasdef AS has_default
           FROM pg_attribute WHERE attrelid = $1::regclass AND attnum > 0 AND NOT attisdropped`,
          [config.name],
        );
        const inDatabase = Object.fromEntries(
          rows.map((row) => [
            row.name,
            { type: row.type, notNull: row.not_null, hasDefault: row.has_default },
          ]),
        );
        const inDrizzle = Object.fromEntries(
          config.columns.map((column) => [
            column.name,
            { type: column.getSQLType(), notNull: column.notNull, hasDefault: column.hasDefault },
          ]),
        );
        expect(inDatabase, config.name).toEqual(inDrizzle);
      }
      // A video link longer than the API takes is refused, like a long title.
      const link = `https://example.com/${'x'.repeat(2000)}`;
      await expect(
        pool.query(
          `INSERT INTO cal_events (workspace_id, organizer_id, video_url, all_day, time_zone,
             start_civil, end_civil, range_start)
           VALUES (gen_random_uuid(), gen_random_uuid(), $1, false, 'UTC', '2026-10-27T10:00',
             '2026-10-27T11:00', now())`,
          [link],
        ),
      ).rejects.toThrow(/cal_events_video_url_length/);
    } finally {
      await pool.end();
      await database.drop();
    }
  });
});
