import { getTableConfig } from 'drizzle-orm/pg-core';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../../db/migrate';
import { createTestDatabase, hasDatabase } from '../../../testing';
import { learningCourses, learningCourseVersions } from './schema';

describe.skipIf(!hasDatabase)('Learning course tables', () => {
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
    for (const table of [learningCourses, learningCourseVersions]) {
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

  it('refuses a course id outside the id pattern and a notify value outside the list', async () => {
    const workspace = '00000000-0000-4000-8000-000000000001';
    const person = '00000000-0000-4000-8000-000000000002';
    const addCourse = (id: string) =>
      pool.query(
        `INSERT INTO learning_courses (workspace_id, id, draft, created_by) VALUES ($1, $2, '{}', $3)`,
        [workspace, id, person],
      );
    await expect(addCourse('has spaces')).rejects.toThrow(/check constraint/);
    await addCourse('course-ok');
    await expect(
      pool.query(
        `INSERT INTO learning_course_versions
           (workspace_id, course_id, version, course, published_by, notify)
         VALUES ($1, 'course-ok', 1, '{}', $2, 'loudly')`,
        [workspace, person],
      ),
    ).rejects.toThrow(/check constraint/);
  });
});
