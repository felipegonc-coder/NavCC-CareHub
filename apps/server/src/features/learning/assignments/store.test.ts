import { getTableConfig } from 'drizzle-orm/pg-core';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../../db/migrate';
import { createTestApp, createTestDatabase, hasDatabase, type TestApp } from '../../../testing';
import { learningAssignmentLearners, learningAssignments } from './schema';
import { assignmentStore, type AssignmentRow, type NewAssignmentRow } from './store';

const workspace = '00000000-0000-4000-8000-000000000001';
const otherWorkspace = '00000000-0000-4000-8000-000000000002';
const trainer = '00000000-0000-4000-8000-00000000000a';
const tara = '00000000-0000-4000-8000-00000000000b';
const omar = '00000000-0000-4000-8000-00000000000c';

describe.skipIf(!hasDatabase)('Learning assignment tables', () => {
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
    for (const table of [learningAssignments, learningAssignmentLearners]) {
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

  it('refuses two kinds of due date, nobody to assign, bad days and bad course ids', async () => {
    const add = (columns: string, values: string) =>
      pool.query(
        `INSERT INTO learning_assignments (workspace_id, created_by, ${columns})
         VALUES ($1, $2, ${values})`,
        [workspace, trainer],
      );
    const refused = /check constraint/;
    await expect(
      add('course_id, group_ids, due_date, due_in_days', `'c1', ARRAY['g1'], '2026-11-30', 7`),
    ).rejects.toThrow(refused);
    await expect(add('course_id', `'c1'`)).rejects.toThrow(refused);
    await expect(add('course_id, group_ids, due_in_days', `'c1', ARRAY['g1'], 0`)).rejects.toThrow(
      refused,
    );
    await expect(add('course_id, group_ids', `'has spaces', ARRAY['g1']`)).rejects.toThrow(refused);
    await add('course_id, group_ids, due_in_days', `'c1', ARRAY['g1'], 7`);
  });
});

describe.skipIf(!hasDatabase)('assignmentStore', () => {
  let server: TestApp;

  beforeAll(async () => {
    server = await createTestApp();
  });

  afterAll(async () => {
    await server?.close();
  });

  const base: NewAssignmentRow = {
    workspaceId: workspace,
    courseId: 'safe-lifting',
    pathId: null,
    userIds: [tara],
    groupIds: [],
    dueDate: '2026-11-30',
    dueInDays: null,
    required: true,
    createdBy: trainer,
  };
  const ids = (rows: readonly AssignmentRow[]) => rows.map((row) => row.id);

  it('adds and lists assignments, oldest first, by course and for one person', async () => {
    const store = assignmentStore(server.db);
    // One statement at a time, so each gets its own created_at.
    const add = async (row: NewAssignmentRow) => {
      const [added] = await store.insert([row]);
      if (!added) throw new Error('Not added');
      return added;
    };
    const direct = await add(base);
    const group = await add({
      ...base,
      courseId: 'fire-safety',
      pathId: 'new-starters',
      userIds: [],
      groupIds: ['night-shift'],
      dueDate: null,
      dueInDays: 14,
      required: false,
    });
    const other = await add({ ...base, userIds: [omar], dueDate: null });
    await add({ ...base, workspaceId: otherWorkspace });

    expect(direct).toEqual({ ...base, id: expect.any(String), createdAt: expect.any(Date) });
    expect(group).toMatchObject({
      pathId: 'new-starters',
      groupIds: ['night-shift'],
      dueInDays: 14,
    });
    expect(ids(await store.list(workspace))).toEqual(ids([direct, group, other]));
    expect(ids(await store.list(workspace, { courseId: 'safe-lifting' }))).toEqual(
      ids([direct, other]),
    );
    expect(ids(await store.list(workspace, { userId: tara }))).toEqual(ids([direct, group]));
    expect(ids(await store.list(workspace, { userId: omar }))).toEqual(ids([group, other]));
    expect(await store.insert([])).toEqual([]);
  });

  it("keeps each person's first day, and drops it with the assignment", async () => {
    const store = assignmentStore(server.db);
    const [row] = await store.insert([{ ...base, dueDate: null, dueInDays: 7 }]);
    if (!row) throw new Error('Not added');
    const tarasDay = { assignmentId: row.id, userId: tara, since: '2026-10-27' };
    const omarsDay = { assignmentId: row.id, userId: omar, since: '2026-11-02' };
    await store.addLearners([tarasDay]);
    await store.addLearners([{ ...tarasDay, since: '2026-11-02' }, omarsDay]);
    await store.addLearners([]);
    const learners = await store.learners([row.id]);
    expect(learners.sort((a, b) => a.since.localeCompare(b.since))).toEqual([tarasDay, omarsDay]);
    expect(await store.learners([])).toEqual([]);

    expect(await store.remove(otherWorkspace, row.id)).toBe(false);
    expect(await store.remove(workspace, row.id)).toBe(true);
    expect(await store.remove(workspace, row.id)).toBe(false);
    expect(await store.learners([row.id])).toEqual([]);
  });
});
