import { getTableConfig } from 'drizzle-orm/pg-core';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../../db/migrate';
import { createTestDatabase, hasDatabase } from '../../../testing';
import { learningReviewComments, learningReviewLinks, learningReviewReminders } from './schema';

const workspace = '00000000-0000-4000-8000-000000000001';
const person = '00000000-0000-4000-8000-000000000002';
const HASH = 'ab'.repeat(32);

describe.skipIf(!hasDatabase)('Learning review tables', () => {
  let pool: pg.Pool;
  let drop: () => Promise<void>;

  beforeAll(async () => {
    const database = await createTestDatabase();
    drop = database.drop;
    pool = new pg.Pool({ connectionString: database.url, max: 2 });
    await runMigrations(pool);
    await pool.query(
      `INSERT INTO learning_courses (workspace_id, id, draft, created_by) VALUES ($1, 'course-1', '{}', $2)`,
      [workspace, person],
    );
  });

  afterAll(async () => {
    await pool?.end();
    await drop?.();
  });

  it('are created exactly as the Drizzle definitions describe them', async () => {
    for (const table of [learningReviewLinks, learningReviewComments, learningReviewReminders]) {
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

  const addLink = (id: string, tokenHash: string, days = '30 days') =>
    pool.query(
      `INSERT INTO learning_review_links (workspace_id, id, course_id, token_hash, created_by, expires_at)
       VALUES ($1, $2, 'course-1', $3, $4, now() + $5::interval)`,
      [workspace, id, tokenHash, person, days],
    );
  const addComment = (id: string, columns: { body?: string; block?: string; question?: string }) =>
    pool.query(
      `INSERT INTO learning_review_comments
         (workspace_id, id, course_id, link_id, lesson_id, block_id, question_id, body, author_id)
       VALUES ($1, $2, 'course-1', 'link-ok', 'lesson-1', $3, $4, $5, $6)`,
      [
        workspace,
        id,
        columns.block ?? null,
        columns.question ?? null,
        columns.body ?? 'Fine.',
        person,
      ],
    );

  it('keep only a hash of each token, once, and links that end after they start', async () => {
    await addLink('link-ok', HASH);
    await expect(addLink('link-copy', HASH)).rejects.toThrow(/unique/);
    await expect(addLink('link-raw', 'Ab0-_'.repeat(8) + 'Ab0')).rejects.toThrow(
      /check constraint/,
    );
    await expect(addLink('link-past', 'cd'.repeat(32), '-1 day')).rejects.toThrow(
      /check constraint/,
    );
  });

  it('refuse empty or overlong comments, and comments on a block and a question at once', async () => {
    await addComment('comment-ok', { block: 'block-1' });
    await expect(addComment('comment-empty', { body: '' })).rejects.toThrow(/check constraint/);
    await expect(addComment('comment-long', { body: 'x'.repeat(2001) })).rejects.toThrow(
      /check constraint/,
    );
    await expect(
      addComment('comment-both', { block: 'block-1', question: 'question-1' }),
    ).rejects.toThrow(/check constraint/);
  });

  it('send each review-due reminder once', async () => {
    const remind = () =>
      pool.query(
        `INSERT INTO learning_review_reminders (workspace_id, course_id, due_on, sent_on, user_id)
         VALUES ($1, 'course-1', '2026-10-20', '2026-10-27', $2)`,
        [workspace, person],
      );
    await remind();
    await expect(remind()).rejects.toThrow(/duplicate key/);
  });

  it('go with their course', async () => {
    await pool.query(`DELETE FROM learning_courses WHERE workspace_id = $1 AND id = 'course-1'`, [
      workspace,
    ]);
    const { rows } = await pool.query(
      `SELECT (SELECT count(*) FROM learning_review_links WHERE workspace_id = $1)::int AS links,
              (SELECT count(*) FROM learning_review_comments WHERE workspace_id = $1)::int AS comments,
              (SELECT count(*) FROM learning_review_reminders WHERE workspace_id = $1)::int AS reminders`,
      [workspace],
    );
    expect(rows[0]).toEqual({ links: 0, comments: 0, reminders: 0 });
  });
});
