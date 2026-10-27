import { getTableConfig } from 'drizzle-orm/pg-core';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../../db/migrate';
import { createTestDatabase, hasDatabase } from '../../../testing';
import { learningProgress, learningProgressChanges, learningProgressEvents } from './schema';

describe.skipIf(!hasDatabase)('Learning progress tables', () => {
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

  it('are created exactly as the Drizzle definitions describe them', async () => {
    for (const table of [learningProgress, learningProgressEvents, learningProgressChanges]) {
      const config = getTableConfig(table);
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
      expect(inDatabase, config.name).toEqual(inDrizzle);
    }
  });

  it('refuses a status, score or change kind outside the lists', async () => {
    const workspace = '00000000-0000-4000-8000-000000000001';
    const learner = '00000000-0000-4000-8000-000000000002';
    const addRow = (courseId: string, status: string, score: number | null) =>
      pool.query(
        `INSERT INTO learning_progress (workspace_id, learner_id, course_id, version, status, score)
         VALUES ($1, $2, $3, 1, $4, $5)`,
        [workspace, learner, courseId, status, score],
      );
    await expect(addRow('course-a', 'finished', null)).rejects.toThrow(/check constraint/);
    await expect(addRow('course-a', 'passed', 101)).rejects.toThrow(/check constraint/);
    await addRow('course-a', 'passed', 91.5);
    await expect(
      pool.query(
        `INSERT INTO learning_progress_changes (workspace_id, learner_id, course_id, kind, run)
         VALUES ($1, $2, 'course-a', 'undo', 1)`,
        [workspace, learner],
      ),
    ).rejects.toThrow(/check constraint/);
  });
});
