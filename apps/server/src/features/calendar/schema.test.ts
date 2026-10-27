import { getTableConfig } from 'drizzle-orm/pg-core';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { runMigrations } from '../../db';
import { createTestDatabase, hasDatabase } from '../../testing';
import { calEventPeople, calEvents, calLayers } from './schema';

type Column = { name: string; type: string; not_null: boolean; has_default: boolean };

describe.skipIf(!hasDatabase)('calendar tables', () => {
  it('are created exactly as the Drizzle definitions describe them', async () => {
    const database = await createTestDatabase();
    const pool = new pg.Pool({ connectionString: database.url, max: 2 });
    try {
      const applied = await runMigrations(pool);
      expect(applied).toContain('202610271200_calendar_events.sql');
      expect(applied).toContain('202610271300_calendar_layers.sql');
      for (const table of [calEvents, calEventPeople, calLayers]) {
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
    } finally {
      await pool.end();
      await database.drop();
    }
  });
});
