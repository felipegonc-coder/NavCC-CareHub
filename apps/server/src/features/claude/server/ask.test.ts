import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createDatabase, runMigrations, type DatabaseConnection, type Db } from '../../../db';
import { createTestDatabase, createUser, hasDatabase } from '../../../testing';
import { claudeUsage } from '../schema';
import { askClaude, askClaudeJson, isClaudeFeatureOn, MAX_TOKENS, PERSON_REQUESTS } from './ask';
import { ClaudeError } from './errors';
import { MAX_REQUEST_CHARS } from './prompt';
import { configureClaude } from './runtime';
import { CLAUDE_MESSAGES_URL } from './settings';

// Fictional people, pages and key only.
const KEY = 'sk-ant-FICTIONAL-test-key-0002';

const answer = (text: string, inputTokens = 10, outputTokens = 3) =>
  new Response(
    JSON.stringify({
      content: [{ type: 'text', text }],
      usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    }),
    { status: 200 },
  );

/** 'sent', or the reason the request was refused or failed. */
async function outcome(request: Promise<unknown>): Promise<string> {
  try {
    await request;
    return 'sent';
  } catch (error) {
    if (error instanceof ClaudeError) return error.reason;
    throw error;
  }
}

interface Setup {
  apiKey?: string | undefined;
  off?: readonly string[];
  canUse?: boolean;
  monthlyRequests?: number;
  replies?: Response[];
}

describe.skipIf(!hasDatabase)('askClaude', () => {
  let connection: DatabaseConnection;
  let db: Db;
  let drop: () => Promise<void>;
  const restores: Array<() => void> = [];

  beforeAll(async () => {
    const database = await createTestDatabase();
    drop = database.drop;
    connection = createDatabase(database.url);
    db = connection.db;
    await runMigrations(connection.pool);
  });

  afterEach(() => {
    while (restores.length > 0) restores.pop()?.();
  });

  afterAll(async () => {
    await connection?.close();
    await drop?.();
  });

  /** A workspace where everything is on and Claude answers "Fine.", unless the test says otherwise. */
  function setUp(options: Setup = {}) {
    const workspaceId = randomUUID();
    const bodies: Array<Record<string, unknown>> = [];
    const replies = [...(options.replies ?? [])];
    restores.push(
      configureClaude({
        settings: () => ({
          apiKey: 'apiKey' in options ? options.apiKey : KEY,
          model: 'claude-test',
          monthlyRequests: options.monthlyRequests ?? 3000,
          url: CLAUDE_MESSAGES_URL,
        }),
        access: {
          isSettingOn: async (_db, id, key) => id === workspaceId && !options.off?.includes(key),
          canUseClaude: async () => options.canUse ?? true,
        },
        fetch: async (_url, init) => {
          bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
          return replies.shift() ?? answer('Fine.');
        },
        sleep: async () => {},
        log: { warn: () => {} },
      }),
    );
    return { workspaceId, bodies };
  }

  const request = (workspaceId: string, userId: string) => ({
    workspaceId,
    userId,
    feature: 'writing_help' as const,
    system: 'Help with writing.',
    instruction: 'Shorten this.',
    selection: 'A long sentence about the fictional weekly huddle.',
  });

  const usageOf = (workspaceId: string) =>
    db.select().from(claudeUsage).where(eq(claudeUsage.workspaceId, workspaceId));

  it('sends nothing unless the key, the approval, the switch and claude.use all hold', async () => {
    const sam = await createUser(db, { name: 'Sam Rivera' });
    const cases: Array<[Setup, string]> = [
      [{ apiKey: undefined }, 'not_set_up'],
      [{ off: ['claude.workspaceApproved'] }, 'not_approved'],
      [{ off: ['claude.writing_help'] }, 'switched_off'],
      [{ canUse: false }, 'no_permission'],
    ];
    for (const [options, reason] of cases) {
      const { workspaceId, bodies } = setUp(options);
      expect(await outcome(askClaude(db, request(workspaceId, sam.id)))).toBe(reason);
      expect(bodies).toHaveLength(0);
      expect(await usageOf(workspaceId)).toEqual([]);
      expect(await isClaudeFeatureOn(db, workspaceId, 'writing_help')).toBe(
        reason === 'no_permission',
      );
      restores.pop()?.();
    }
  });

  it('sends one request and logs its use without any text', async () => {
    const sam = await createUser(db, { name: 'Sam Rivera' });
    const { workspaceId, bodies } = setUp({ replies: [answer('Shorter.', 40, 7)] });
    const documents = [{ title: 'Weekly huddle', text: 'Agenda: fictional items' }];
    const result = await askClaude(db, { ...request(workspaceId, sam.id), documents });
    expect(result).toEqual({ text: 'Shorter.' });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.max_tokens).toBe(MAX_TOKENS);
    const rows = await usageOf(workspaceId);
    expect(rows).toMatchObject([
      { userId: sam.id, feature: 'writing_help', status: 'ok', inputTokens: 40, outputTokens: 7 },
    ]);
    const stored = JSON.stringify(rows);
    for (const text of ['Shorten', 'weekly huddle', 'Weekly huddle', 'Agenda', 'Shorter.', KEY]) {
      expect(stored).not.toContain(text);
    }
  });

  it('keeps max_tokens at or under the server limit', async () => {
    const sam = await createUser(db);
    const { workspaceId, bodies } = setUp();
    await askClaude(db, { ...request(workspaceId, sam.id), maxTokens: 100_000 });
    await askClaude(db, { ...request(workspaceId, sam.id), maxTokens: 100 });
    expect(bodies.map((body) => body.max_tokens)).toEqual([MAX_TOKENS, 100]);
  });

  it('stops at the monthly cap, counting only this month', async () => {
    const sam = await createUser(db);
    const { workspaceId, bodies } = setUp({ monthlyRequests: 2 });
    const lastMonth = new Date(Date.now() - 40 * 24 * 60 * 60_000);
    await db.insert(claudeUsage).values({
      workspaceId,
      userId: sam.id,
      feature: 'assistant',
      status: 'ok',
      createdAt: lastMonth,
    });
    const ask = () => outcome(askClaude(db, request(workspaceId, sam.id)));
    expect([await ask(), await ask(), await ask()]).toEqual(['sent', 'sent', 'monthly_cap']);
    expect(bodies).toHaveLength(2);
  });

  it('limits each person across workspaces, without stopping anyone else', async () => {
    const sam = await createUser(db);
    const riley = await createUser(db);
    const { workspaceId, bodies } = setUp();
    const elsewhere = randomUUID();
    await db.insert(claudeUsage).values(
      Array.from({ length: PERSON_REQUESTS }, () => ({
        workspaceId: elsewhere,
        userId: sam.id,
        feature: 'assistant' as const,
        status: 'ok' as const,
        createdAt: new Date(),
      })),
    );
    expect(await outcome(askClaude(db, request(workspaceId, sam.id)))).toBe('user_rate_limit');
    expect(await outcome(askClaude(db, request(workspaceId, riley.id)))).toBe('sent');
    expect(bodies).toHaveLength(1);
  });

  it('refuses too much text before sending anything', async () => {
    const sam = await createUser(db);
    const { workspaceId, bodies } = setUp();
    const long = { ...request(workspaceId, sam.id), selection: 'x'.repeat(MAX_REQUEST_CHARS) };
    expect(await outcome(askClaude(db, long))).toBe('too_long');
    expect(bodies).toHaveLength(0);
  });

  it('logs failed requests too, so they count toward the caps', async () => {
    const sam = await createUser(db);
    const down = () => new Response('{}', { status: 503 });
    const { workspaceId } = setUp({ replies: [down(), down(), down()] });
    expect(await outcome(askClaude(db, request(workspaceId, sam.id)))).toBe('unavailable');
    expect(await usageOf(workspaceId)).toMatchObject([{ status: 'unavailable', inputTokens: 0 }]);
  });

  it("checks JSON answers with the caller's schema", async () => {
    const sam = await createUser(db);
    const { workspaceId, bodies } = setUp({
      replies: [
        answer('```json\n{"title": "Huddle", "tags": ["team"]}\n```'),
        answer('{"title": 3}'),
        answer('Sure! Here it is.'),
      ],
    });
    const schema = z.object({ title: z.string(), tags: z.array(z.string()) });
    const ask = () => askClaudeJson(db, { ...request(workspaceId, sam.id), schema });
    expect(await ask()).toEqual({ data: { title: 'Huddle', tags: ['team'] } });
    expect([await outcome(ask()), await outcome(ask())]).toEqual(['bad_output', 'bad_output']);
    expect(JSON.stringify(bodies[0]?.messages)).toContain('Answer with one JSON value');
    const statuses = (await usageOf(workspaceId)).map((row) => row.status).sort();
    expect(statuses).toEqual(['bad_output', 'bad_output', 'ok']);
  });

  it('has a usage table exactly as the Drizzle definition describes it', async () => {
    const config = getTableConfig(claudeUsage);
    const { rows } = await connection.pool.query<{
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
    await expect(
      connection.pool.query(
        `INSERT INTO claude_usage (workspace_id, feature, status) VALUES ($1, 'telepathy', 'ok')`,
        [randomUUID()],
      ),
    ).rejects.toThrow();
  });
});
