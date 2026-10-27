import { getTableConfig } from 'drizzle-orm/pg-core';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../../db/migrate';
import { createTestDatabase, hasDatabase } from '../../../testing';
import { learningPaths } from './schema';

describe.skipIf(!hasDatabase)('Learning path table', () => {
  let pool: pg.Pool;
  let drop: () => Promise<void>;

  beforeAll(async () => {
    const database = await createTestDatabase();
    drop = database.drop;
    pool = new pg.Pool({ connectionString: database.url, max: 2 });
    await runMigrations(pool);
  });

  afterAll(async () => {
    await pool?.end();
    await drop?.();
  });

  it('is created exactly as the Drizzle definition describes it', async () => {
    const config = getTableConfig(learningPaths);
    const { rows } = await pool.query<{
      name: string;
      type: string;
      not_null: boolean;
      has_default: boolean;
    }>(
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
    expect(inDatabase).toEqual(inDrizzle);
  });

  it('refuses bad ids, empty titles, unknown orders and the same id twice', async () => {
    const workspace = '00000000-0000-4000-8000-000000000001';
    const trainer = '00000000-0000-4000-8000-000000000002';
    const add = (id: string, title: string, order = 'sequential') =>
      pool.query(
        `INSERT INTO learning_paths (workspace_id, id, title, course_ids, course_order,
           created_by, updated_by)
         VALUES ($1, $2, $3, ARRAY['course-a', 'course-b'], $4, $5, $5)`,
        [workspace, id, title, order, trainer],
      );
    await expect(add('path/one', 'New agent basics')).rejects.toThrow(/check/);
    await expect(add('path-one', '')).rejects.toThrow(/check/);
    await expect(add('path-one', 'New agent basics', 'random')).rejects.toThrow(/check/);
    await add('path-one', 'New agent basics');
    await expect(add('path-one', 'Agent basics')).rejects.toThrow(/unique/);
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM learning_paths WHERE course_ids @> ARRAY['course-b']`,
    );
    expect(rows).toEqual([{ id: 'path-one' }]);
  });
});
