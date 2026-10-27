import type { QuestionBank } from '@carehub/learning';
import { getTableConfig } from 'drizzle-orm/pg-core';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../../db/migrate';
import { createTestApp, createTestDatabase, hasDatabase, type TestApp } from '../../../testing';
import type { LearningSeed, SeedContext } from '../seed';
import { learningBanks } from './schema';
import { sampleBanks, seedBanks } from './seed';
import { bankStore } from './store';

// Fictional data only.
const workspace = '00000000-0000-4000-8000-000000000001';
const otherWorkspace = '00000000-0000-4000-8000-000000000002';
const seedWorkspace = '00000000-0000-4000-8000-000000000003';
const trainer = '00000000-0000-4000-8000-00000000000a';

const bank = (id: string, title: string, description?: string): QuestionBank => ({
  formatVersion: 1,
  id,
  title,
  ...(description ? { description } : {}),
  questions: [
    {
      id: 'q1',
      type: 'true_false',
      prompt: [{ runs: [{ text: 'Urgent calls go to the duty lead.' }] }],
      points: 1,
      answer: true,
    },
  ],
});

describe.skipIf(!hasDatabase)('Learning bank table', () => {
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
    const config = getTableConfig(learningBanks);
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

  it('refuses bad ids, a bank that is not an object and revision 0', async () => {
    const add = (id: string, value: string, revision = 1) =>
      pool.query(
        `INSERT INTO learning_banks (workspace_id, id, bank, revision, created_by)
         VALUES ($1, $2, $3::jsonb, $4, $5)`,
        [workspace, id, value, revision, trainer],
      );
    const refused = /check constraint/;
    await expect(add('has spaces', '{}')).rejects.toThrow(refused);
    await expect(add('bank-1', '[]')).rejects.toThrow(refused);
    await expect(add('bank-1', '{}', 0)).rejects.toThrow(refused);
  });
});

describe.skipIf(!hasDatabase)('bankStore', () => {
  let server: TestApp;

  beforeAll(async () => {
    server = await createTestApp();
  });

  afterAll(async () => {
    await server?.close();
  });

  it('adds, lists, saves with a revision and removes banks, one workspace at a time', async () => {
    const store = bankStore(server.db);
    const wound = bank('bank-wound', 'Wound care');
    const allergies = bank('bank-allergies', 'allergies', 'Fictional reactions.');
    const add = (workspaceId: string, value: QuestionBank) =>
      store.insert({ workspaceId, id: value.id, bank: value, createdBy: trainer });

    expect(await add(workspace, wound)).toMatchObject({
      id: 'bank-wound',
      bank: wound,
      revision: 1,
    });
    expect(await add(workspace, wound)).toBe(undefined);
    await add(workspace, allergies);
    await add(otherWorkspace, bank('bank-other', 'Other workspace'));

    const list = await store.list(workspace);
    expect(
      list.map(({ id, title, description, questionCount }) => ({
        id,
        title,
        description,
        questionCount,
      })),
    ).toEqual([
      {
        id: 'bank-allergies',
        title: 'allergies',
        description: 'Fictional reactions.',
        questionCount: 1,
      },
      { id: 'bank-wound', title: 'Wound care', description: null, questionCount: 1 },
    ]);
    expect(list[0]?.updatedAt).toBeInstanceOf(Date);
    expect(await store.getMany(workspace, ['bank-wound', 'bank-other', 'bank-gone'])).toEqual([
      wound,
    ]);
    expect(await store.getMany(workspace, [])).toEqual([]);

    const edited = { ...wound, title: 'Wound care basics' };
    expect(await store.update(workspace, 'bank-wound', edited, 1)).toEqual({ revision: 2 });
    expect(await store.update(workspace, 'bank-wound', edited, 1)).toBe(undefined);
    expect(await store.update(otherWorkspace, 'bank-wound', edited, 2)).toBe(undefined);
    expect(await store.get(workspace, 'bank-wound')).toMatchObject({ bank: edited, revision: 2 });
    expect(await store.get(otherWorkspace, 'bank-wound')).toBe(undefined);

    expect(await store.remove(otherWorkspace, 'bank-wound')).toBe(false);
    expect(await store.remove(workspace, 'bank-wound')).toBe(true);
    expect(await store.remove(workspace, 'bank-wound')).toBe(false);
  });

  it('seeds the banks the sample courses draw from, once', async () => {
    const logs: string[] = [];
    const ctx = {
      db: server.db,
      workspaceId: seedWorkspace,
      log: (message: string) => logs.push(message),
    } as unknown as SeedContext;
    const learning: LearningSeed = { trainer: { id: trainer, roleId: 'role-trainer' } };
    await seedBanks(ctx, learning);
    await seedBanks(ctx, learning);
    expect(logs).toEqual(['Learning: added 1 question bank.', 'Learning: added 0 question banks.']);
    const ids = sampleBanks().map((sample) => sample.id);
    expect(await bankStore(server.db).getMany(seedWorkspace, ids)).toEqual(sampleBanks());
  });
});
