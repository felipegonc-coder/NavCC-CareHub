import { randomUUID } from 'node:crypto';
import type {
  ClaudeFieldAudience,
  ClaudeFieldInput,
  ClaudeFieldSetup,
  ClaudeFieldValue,
} from '@carehub/extras/claude/fields';
import { eq, sql } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, runMigrations, type DatabaseConnection, type Db } from '../../../db';
import { createTestDatabase, createUser, hasDatabase, type TestUser } from '../../../testing';
import { claudeFieldFills, claudeFieldQueue, claudeUsage } from '../schema';
import { ClaudeError } from './errors';
import { fieldErrorReason, fillClaudeFields, planClaudeFieldFill } from './fields';
import { bindClaudeFieldHost, type ClaudeField } from './fields-host';
import { claudeFieldProgress, claudeFieldRowChanged, runClaudeFieldQueue } from './fields-queue';
import { configureClaude } from './runtime';
import { CLAUDE_MESSAGES_URL } from './settings';

// Fictional people, rows and key only.
const KEY = 'sk-ant-FICTIONAL-test-key-0009';
const START = new Date('2026-10-27T18:00:00Z');
const MINUTE = 60_000;
const NAMES: Record<string, string> = {
  'property-request': 'Request',
  'property-status': 'Status',
  'property-salary': 'Salary',
  'property-orders': 'Orders',
};

const answer = (text: string) =>
  new Response(
    JSON.stringify({
      content: [{ type: 'text', text }],
      usage: { input_tokens: 40, output_tokens: 12 },
    }),
    { status: 200 },
  );

/** 'filled', 'queued', or the reason it was refused. */
async function outcome(request: Promise<{ status: string }>): Promise<string> {
  try {
    return (await request).status;
  } catch (error) {
    if (error instanceof ClaudeError) return error.reason;
    const reason = fieldErrorReason(error);
    if (reason) return reason;
    throw error;
  }
}

interface FakeRow {
  id: string;
  values: Record<string, string>;
  content: string;
  editors: string[];
  value?: ClaudeFieldValue | undefined;
}

interface Setup {
  setup?: Partial<ClaudeFieldSetup>;
  see?: ClaudeFieldAudience;
  inputs?: ClaudeFieldInput[];
  off?: string[];
  noClaude?: string[];
  replies?: Response[];
}

describe.skipIf(!hasDatabase)('Claude fields', () => {
  let connection: DatabaseConnection;
  let db: Db;
  let drop: () => Promise<void>;
  const restores: Array<() => void> = [];
  const clock = { now: START };

  beforeAll(async () => {
    const database = await createTestDatabase();
    drop = database.drop;
    connection = createDatabase(database.url);
    db = connection.db;
    await runMigrations(connection.pool);
  });

  afterEach(async () => {
    while (restores.length > 0) restores.pop()?.();
    clock.now = START;
    await db.delete(claudeFieldQueue);
  });

  afterAll(async () => {
    await connection?.close();
    await drop?.();
  });

  /**
   * A workspace with everything on, a Tickets database whose Summary field uses Request and
   * Status, and Claude answering "A fictional summary." unless the test says otherwise.
   */
  async function setUp(options: Setup = {}) {
    const workspaceId = randomUUID();
    const databaseId = randomUUID();
    const propertyId = 'property-summary';
    const avery = await createUser(db, { name: 'Avery Lin' });
    const morgan = await createUser(db, { name: 'Morgan Diaz' });
    const rows = new Map<string, FakeRow>();
    const bodies: Array<Record<string, unknown>> = [];
    const logs: string[] = [];
    const replies = [...(options.replies ?? [])];
    let inFlight = 0;
    const most = { inFlight: 0 };
    const hooks: { duringFetch?: (() => Promise<void>) | undefined } = {};

    const field = (): ClaudeField => ({
      workspaceId,
      databaseId,
      propertyId,
      setup: {
        kind: 'summary',
        instructions: '',
        uses: ['property-request', 'property-status'],
        usesPageContent: false,
        fill: 'by_hand',
        ...options.setup,
      },
      ownerId: morgan.id,
      see: options.see ?? null,
      inputs: options.inputs ?? [
        { id: 'property-request', type: 'text', see: null },
        { id: 'property-status', type: 'status', see: null },
      ],
    });

    restores.push(
      configureClaude({
        settings: () => ({
          apiKey: KEY,
          model: 'claude-test',
          monthlyRequests: 3000,
          url: CLAUDE_MESSAGES_URL,
        }),
        access: {
          isSettingOn: async (_db, id, key) => id === workspaceId && !options.off?.includes(key),
          canUseClaude: async (_db, id, userId) =>
            id === workspaceId && !options.noClaude?.includes(userId),
        },
        fetch: async (_url, init) => {
          bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
          inFlight += 1;
          most.inFlight = Math.max(most.inFlight, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 25));
          await hooks.duringFetch?.();
          inFlight -= 1;
          return replies.shift() ?? answer('A fictional summary.');
        },
        sleep: async () => {},
        log: { warn: (details, message) => logs.push(`${message} ${JSON.stringify(details)}`) },
        now: () => clock.now,
      }),
      bindClaudeFieldHost({
        field: async (_db, id, property) =>
          id === databaseId && property === propertyId ? field() : null,
        autoFields: async (_db, id) =>
          id === databaseId && field().setup.fill === 'auto' ? [field()] : [],
        fillableRows: async (_db, input) =>
          [...rows.values()]
            .filter((row) => row.editors.includes(input.userId))
            .filter((row) =>
              input.rowIds === 'all'
                ? true
                : input.rowIds === 'empty'
                  ? !row.value?.text
                  : input.rowIds.includes(row.id),
            )
            .map((row) => row.id)
            .slice(0, input.limit),
        readRowText: async (_db, input) => {
          const row = rows.get(input.rowId);
          if (!row?.editors.includes(input.userId)) return null;
          return {
            properties: input.propertyIds.map((id) => ({
              name: NAMES[id] ?? id,
              text: row.values[id] ?? '',
            })),
            ...(input.content ? { content: row.content } : {}),
          };
        },
        saveFill: async (_db, input) => {
          const row = rows.get(input.rowId);
          if (!row) throw new Error('No such row.');
          const old: ClaudeFieldValue = row.value ?? {
            text: '',
            filledAt: null,
            filledFor: null,
            status: 'filled',
          };
          row.value = input.value ?? { ...old, status: 'failed' };
        },
      }),
    );

    function addRow(editors: TestUser[] = [avery, morgan]): FakeRow {
      const row: FakeRow = {
        id: randomUUID(),
        values: {
          'property-request': 'Customer asks for a refund for order 1042.',
          'property-status': 'Open',
          'property-salary': 'FICTIONAL-SALARY-58000',
          'property-orders': 'FICTIONAL-ORDER-1043',
        },
        content: 'Called back on Oct 26. FICTIONAL-CONTENT-NOTE',
        editors: editors.map((person) => person.id),
      };
      rows.set(row.id, row);
      return row;
    }

    const target = { databaseId, propertyId };
    return {
      workspaceId,
      databaseId,
      avery,
      morgan,
      rows,
      bodies,
      logs,
      most,
      hooks,
      addRow,
      target,
    };
  }

  it('fills one row now, sending only the properties it uses', async () => {
    const t = await setUp();
    const row = t.addRow();
    const result = await fillClaudeFields(db, {
      userId: t.avery.id,
      ...t.target,
      rowIds: [row.id],
    });

    const value = {
      text: 'A fictional summary.',
      filledAt: START.toISOString(),
      filledFor: t.avery.id,
      status: 'filled',
    };
    expect(result).toEqual({ status: 'filled', rowId: row.id, value });
    expect(row.value).toEqual(value);
    expect(t.bodies).toHaveLength(1);
    const sent = JSON.stringify(t.bodies[0]);
    expect(sent).toContain('Customer asks for a refund for order 1042.');
    expect(sent).toContain('Open');
    for (const other of ['FICTIONAL-ORDER-1043', 'FICTIONAL-SALARY-58000', 'FICTIONAL-CONTENT']) {
      expect(sent).not.toContain(other);
    }
    expect(t.bodies[0]?.max_tokens).toBe(600);

    const usage = await db
      .select()
      .from(claudeUsage)
      .where(eq(claudeUsage.workspaceId, t.workspaceId));
    expect(usage.map((r) => [r.feature, r.userId, r.status])).toEqual([
      ['fields', t.avery.id, 'ok'],
    ]);
    const fills = await db
      .select()
      .from(claudeFieldFills)
      .where(eq(claudeFieldFills.databaseId, t.databaseId));
    expect(fills.map((r) => [r.userId, r.auto, r.status])).toEqual([[t.avery.id, false, 'ok']]);
  });

  it('sends the page content only when the field uses it', async () => {
    const t = await setUp({ setup: { kind: 'key_points', usesPageContent: true } });
    const row = t.addRow();
    const points = '- Wants a refund\n- Order 1042\n- Called back\n- Open\n- Urgent\n- Extra';
    const replies = [answer(points)];
    restores.push(
      configureClaude({
        fetch: async (_url, init) => {
          t.bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
          return replies.shift() ?? answer('Fine.');
        },
      }),
    );
    const result = await fillClaudeFields(db, {
      userId: t.avery.id,
      ...t.target,
      rowIds: [row.id],
    });
    expect(JSON.stringify(t.bodies[0])).toContain('FICTIONAL-CONTENT-NOTE');
    expect(result.status === 'filled' && result.value.text).toBe(
      '• Wants a refund\n• Order 1042\n• Called back\n• Open\n• Urgent',
    );
  });

  it('sends nothing when Claude fields are off, without claude.use or Can edit', async () => {
    const base = await setUp();
    const cases: Array<[Setup, string]> = [
      [{ off: ['claude.fields'] }, 'switched_off'],
      [{ off: ['claude.navApproved'] }, 'not_approved'],
      [{ noClaude: [] }, 'no_permission'],
    ];
    for (const [options, reason] of cases) {
      const t = await setUp(options);
      if (options.noClaude) options.noClaude.push(t.avery.id);
      const row = t.addRow();
      const fill = fillClaudeFields(db, { userId: t.avery.id, ...t.target, rowIds: [row.id] });
      expect(await outcome(fill)).toBe(reason);
      expect(t.bodies).toHaveLength(0);
      expect(row.value).toBeUndefined();
    }

    const t = await setUp();
    const row = t.addRow([t.morgan]);
    const fill = fillClaudeFields(db, { userId: t.avery.id, ...t.target, rowIds: [row.id] });
    expect(await outcome(fill)).toBe('no_permission');
    const elsewhere = { databaseId: base.databaseId, propertyId: 'property-status' };
    const notAField = fillClaudeFields(db, { userId: t.avery.id, ...elsewhere, rowIds: [row.id] });
    expect(await outcome(notAField)).toBe('no_permission');
    expect(t.bodies).toHaveLength(0);
  });

  it("refuses inputs from other rows, or that some people who see the field can't see", async () => {
    const hr: ClaudeFieldAudience = [{ type: 'group', id: 'group-hr' }];
    const cases: Array<[Setup, string]> = [
      [{ inputs: [{ id: 'property-orders', type: 'relation', see: null }] }, 'unusable_input'],
      [{ inputs: [{ id: 'property-salary', type: 'number', see: hr }] }, 'hidden_input'],
    ];
    for (const [options, reason] of cases) {
      const t = await setUp(options);
      const row = t.addRow();
      const fill = fillClaudeFields(db, { userId: t.avery.id, ...t.target, rowIds: [row.id] });
      expect(await outcome(fill)).toBe(reason);
      expect(t.bodies).toHaveLength(0);
    }
    const t = await setUp({
      see: hr,
      inputs: [{ id: 'property-salary', type: 'number', see: hr }],
    });
    const row = t.addRow();
    const fill = fillClaudeFields(db, { userId: t.avery.id, ...t.target, rowIds: [row.id] });
    expect(await outcome(fill)).toBe('filled');
  });

  it('keeps the old value and marks it failed when Claude fails', async () => {
    const failing = () => new Response('{}', { status: 503 });
    const t = await setUp();
    const row = t.addRow();
    const fill = () => fillClaudeFields(db, { userId: t.avery.id, ...t.target, rowIds: [row.id] });
    await fill();
    restores.push(configureClaude({ fetch: async () => failing() }));
    expect(await outcome(fill())).toBe('unavailable');
    expect(row.value).toEqual({
      text: 'A fictional summary.',
      filledAt: START.toISOString(),
      filledFor: t.avery.id,
      status: 'failed',
    });
    const fills = await db
      .select()
      .from(claudeFieldFills)
      .where(eq(claudeFieldFills.databaseId, t.databaseId));
    expect(fills.map((r) => r.status).sort()).toEqual(['failed', 'ok']);
    const everything = JSON.stringify([t.logs, row.value, fills]);
    expect(everything).not.toContain(KEY);
    expect(everything).not.toContain('order 1042');
  });

  it("stops at each database's hourly cap", async () => {
    const t = await setUp();
    const row = t.addRow();
    const old = (minutes: number) => ({
      workspaceId: t.workspaceId,
      databaseId: t.databaseId,
      propertyId: 'property-summary',
      userId: t.morgan.id,
      auto: false,
      status: 'ok' as const,
      createdAt: new Date(START.getTime() - minutes * MINUTE),
    });
    await db
      .insert(claudeFieldFills)
      .values([...Array.from({ length: 299 }, () => old(30)), old(61)]);
    const fill = () => fillClaudeFields(db, { userId: t.avery.id, ...t.target, rowIds: [row.id] });
    expect(await outcome(fill())).toBe('filled');
    expect(await outcome(fill())).toBe('database_hour');
    expect(t.bodies).toHaveLength(1);

    // Half an hour later, the older requests are more than an hour old.
    clock.now = new Date(START.getTime() + 31 * MINUTE);
    expect(await outcome(fill())).toBe('filled');
  });

  it('asks before filling more than one row, then fills them in the background, 5 at a time', async () => {
    const t = await setUp();
    const rows = Array.from({ length: 12 }, () => t.addRow());
    t.addRow([t.morgan]);
    const all = { userId: t.avery.id, ...t.target, rowIds: 'all' as const };
    expect(await planClaudeFieldFill(db, all)).toEqual({ rows: 12, monthlyRequests: 3000 });

    for (const confirmedRows of [undefined, 11]) {
      const error = await fillClaudeFields(db, { ...all, confirmedRows }).catch((e: unknown) => e);
      expect(fieldErrorReason(error)).toBe('rows_changed');
      expect((error as { details: unknown }).details).toEqual({ reason: 'rows_changed', rows: 12 });
    }
    expect(await fillClaudeFields(db, { ...all, confirmedRows: 12 })).toEqual({
      status: 'queued',
      rows: 12,
    });
    const progress = { userId: t.avery.id, ...t.target };
    expect(await claudeFieldProgress(db, progress)).toEqual({ waiting: 12 });
    expect(t.bodies).toHaveLength(0);

    expect(await runClaudeFieldQueue(db)).toBe(12);
    expect(t.bodies).toHaveLength(12);
    expect(t.most.inFlight).toBeGreaterThan(1);
    expect(t.most.inFlight).toBeLessThanOrEqual(5);
    for (const row of rows) expect(row.value?.filledFor).toBe(t.avery.id);
    expect(await claudeFieldProgress(db, progress)).toEqual({ waiting: 0 });
    const empty = { ...all, rowIds: 'empty' as const };
    expect(await planClaudeFieldFill(db, empty)).toEqual({ rows: 0, monthlyRequests: 3000 });
  });

  it("waits at each database's hourly cap in the background", async () => {
    const t = await setUp();
    const first = t.addRow();
    const second = t.addRow();
    await db.insert(claudeFieldFills).values(
      Array.from({ length: 300 }, () => ({
        workspaceId: t.workspaceId,
        databaseId: t.databaseId,
        propertyId: 'property-summary',
        userId: t.morgan.id,
        auto: true,
        status: 'ok' as const,
        createdAt: new Date(START.getTime() - 30 * MINUTE),
      })),
    );
    const two = {
      userId: t.avery.id,
      ...t.target,
      rowIds: [first.id, second.id],
      confirmedRows: 2,
    };
    expect(await outcome(fillClaudeFields(db, two))).toBe('queued');
    expect(await runClaudeFieldQueue(db)).toBe(2);
    expect(t.bodies).toHaveLength(0);
    const waiting = await db.select().from(claudeFieldQueue);
    expect(waiting.map((entry) => [entry.attempts, entry.dueAt > START])).toEqual([
      [0, true],
      [0, true],
    ]);

    // Half an hour later, the older requests are more than an hour old.
    clock.now = new Date(START.getTime() + 31 * MINUTE);
    expect(await runClaudeFieldQueue(db)).toBe(2);
    expect(t.bodies).toHaveLength(2);
    expect(await db.select().from(claudeFieldQueue)).toHaveLength(0);
  });

  it('fills automatically 2 minutes after the last change, with the owner’s access', async () => {
    const t = await setUp({ setup: { fill: 'auto' } });
    const row = t.addRow();
    const change = { databaseId: t.databaseId, rowId: row.id, source: 'user' };
    await claudeFieldRowChanged(db, { ...change, propertyIds: ['property-salary'] });
    await claudeFieldRowChanged(db, {
      ...change,
      propertyIds: ['property-request'],
      source: 'import',
    });
    expect(await db.select().from(claudeFieldQueue)).toHaveLength(0);

    await claudeFieldRowChanged(db, { ...change, propertyIds: ['property-request'] });
    clock.now = new Date(START.getTime() + MINUTE);
    await claudeFieldRowChanged(db, { ...change, propertyIds: ['property-status'] });
    clock.now = new Date(START.getTime() + 2.5 * MINUTE);
    expect(await runClaudeFieldQueue(db)).toBe(0);

    clock.now = new Date(START.getTime() + 3 * MINUTE);
    expect(await runClaudeFieldQueue(db)).toBe(1);
    expect(row.value).toEqual({
      text: 'A fictional summary.',
      filledAt: clock.now.toISOString(),
      filledFor: null,
      status: 'filled',
    });
    const usage = await db
      .select()
      .from(claudeUsage)
      .where(eq(claudeUsage.workspaceId, t.workspaceId));
    expect(usage.map((r) => r.userId)).toEqual([t.morgan.id]);
    expect(await db.select().from(claudeFieldQueue)).toHaveLength(0);
  });

  it('refills automatically after a By-hand fill that was filling during a change', async () => {
    const t = await setUp({ setup: { fill: 'auto' } });
    const row = t.addRow();
    t.addRow();
    const all = { userId: t.avery.id, ...t.target, rowIds: 'all' as const, confirmedRows: 2 };
    expect(await fillClaudeFields(db, all)).toEqual({ status: 'queued', rows: 2 });
    t.hooks.duringFetch = async () => {
      t.hooks.duringFetch = undefined;
      clock.now = new Date(START.getTime() + MINUTE);
      const change = { databaseId: t.databaseId, rowId: row.id, propertyIds: ['property-request'] };
      await claudeFieldRowChanged(db, { ...change, source: 'user' });
    };
    expect(await runClaudeFieldQueue(db)).toBe(2);
    expect(row.value?.filledFor).toBe(t.avery.id);
    const waiting = await db.select().from(claudeFieldQueue);
    expect(waiting.map((entry) => [entry.rowId, entry.auto, entry.requestedBy])).toEqual([
      [row.id, true, null],
    ]);
    expect(waiting[0]?.dueAt).toEqual(new Date(START.getTime() + 3 * MINUTE));
    expect(await claudeFieldProgress(db, { userId: t.avery.id, ...t.target })).toEqual({
      waiting: 0,
    });

    clock.now = new Date(START.getTime() + 3 * MINUTE);
    expect(await runClaudeFieldQueue(db)).toBe(1);
    expect(row.value?.filledFor).toBeNull();
  });

  it('fills nothing automatically with Claude fields off, or for a field By hand', async () => {
    for (const options of [{ off: ['claude.fields'] }, { setup: { fill: 'by_hand' as const } }]) {
      const t = await setUp({ setup: { fill: 'auto' }, ...options });
      const row = t.addRow();
      const change = { databaseId: t.databaseId, rowId: row.id, source: 'user' };
      await claudeFieldRowChanged(db, { ...change, propertyIds: ['property-request'] });
      expect(await db.select().from(claudeFieldQueue)).toHaveLength(0);
    }
  });

  it('keeps the migration and the Drizzle tables the same', async () => {
    for (const table of [claudeFieldFills, claudeFieldQueue]) {
      const config = getTableConfig(table);
      const { rows } = await db.execute<{
        name: string;
        type: string;
        not_null: boolean;
        has_default: boolean;
      }>(
        sql`SELECT attname AS name, format_type(atttypid, atttypmod) AS type,
                   attnotnull AS not_null, atthasdef AS has_default
            FROM pg_attribute
            WHERE attrelid = ${config.name}::regclass AND attnum > 0 AND NOT attisdropped`,
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
    }
  });
});
