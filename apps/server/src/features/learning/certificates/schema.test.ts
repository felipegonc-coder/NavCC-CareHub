import { getTableConfig } from 'drizzle-orm/pg-core';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../../db/migrate';
import { createTestDatabase, hasDatabase } from '../../../testing';
import { learningCertificateNotices, learningCertificates } from './schema';

describe.skipIf(!hasDatabase)('Learning certificate tables', () => {
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
    for (const table of [learningCertificates, learningCertificateNotices]) {
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

  it('refuses bad codes, two certificates for one finish and unknown notices', async () => {
    const workspace = '00000000-0000-4000-8000-000000000001';
    const learner = '00000000-0000-4000-8000-000000000002';
    const add = (code: string, completedAt: string, expiresOn: string | null) =>
      pool.query<{ id: string }>(
        `INSERT INTO learning_certificates (workspace_id, code, learner_id, learner_name, course_id,
           course_title, course_version, completed_at, issued_on, expires_on)
         VALUES ($1, $2, $3, 'Test Person', 'course-a', 'Hold etiquette', 1, $4, '2026-10-27', $5)
         RETURNING id`,
        [workspace, code, learner, completedAt, expiresOn],
      );
    await expect(add('7kq2-m9xd-4tb8', '2026-10-27T10:00:00Z', null)).rejects.toThrow(/check/);
    await expect(add('7KQ2-M9XD-4TB8', '2026-10-27T10:00:00Z', '2026-10-27')).rejects.toThrow(
      /check/,
    );
    const { rows } = await add('7KQ2-M9XD-4TB8', '2026-10-27T10:00:00Z', '2027-10-27');
    await expect(add('7KQ2-M9XD-4TB9', '2026-10-27T10:00:00Z', null)).rejects.toThrow(/unique/);
    await expect(add('7KQ2-M9XD-4TB8', '2026-10-28T10:00:00Z', null)).rejects.toThrow(/unique/);
    await expect(
      pool.query(
        `INSERT INTO learning_certificate_notices (certificate_id, kind, sent_on)
         VALUES ($1, 'reminder', '2026-10-27')`,
        [rows[0]?.id],
      ),
    ).rejects.toThrow(/check constraint/);
  });
});
