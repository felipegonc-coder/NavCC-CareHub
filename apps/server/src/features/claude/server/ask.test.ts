import { randomUUID } from 'node:crypto';
import { CLAUDE_APPROVAL_KEY, claudeSwitchKey } from '@carehub/extras/claude';
import { eq } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createDatabase, runMigrations, type DatabaseConnection, type Db } from '../../../db';
import { createTestDatabase, createUser, hasDatabase } from '../../../testing';
import { claudeUsage } from '../schema';
import {
  askClaude,
  askClaudeJson,
  claudeFeaturesOn,
  isClaudeFeatureOn,
  MAX_TOKENS,
  PERSON_IN_FLIGHT,
  PERSON_REQUESTS,
} from './ask';
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

/** Waits, a little at a time, until `check` holds. */
async function until(check: () => boolean): Promise<void> {
  const giveUp = Date.now() + 4_000;
  while (!check()) {
    if (Date.now() > giveUp) throw new Error('Gave up waiting.');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** A promise that stays open until `open()`, so requests can be held at Claude. */
function gate() {
  let open = () => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

interface Setup {
  apiKey?: string | undefined;
  off?: readonly string[];
  canUse?: boolean;
  monthlyRequests?: number;
  replies?: Response[];
  /** Claude doesn't answer until this settles. */
  held?: Promise<void>;
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
        db,
        access: {
          settingsOn: async (_db, id, keys) =>
            new Set(id === workspaceId ? keys.filter((key) => !options.off?.includes(key)) : []),
          canUseClaude: async () => options.canUse ?? true,
        },
        fetch: async (_url, init) => {
          bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
          await options.held;
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

  it('sends nothing unless the key, the OK, the switch and claude.use all hold', async () => {
    const sam = await createUser(db, { name: 'Sam Rivera' });
    const cases: Array<[Setup, string]> = [
      [{ apiKey: undefined }, 'not_set_up'],
      [{ off: ['claude.navApproved'] }, 'not_approved'],
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
    expect(await usageOf(workspaceId)).toMatchObject([
      { status: 'unavailable', inputTokens: 0, outputTokens: 0 },
    ]);
  });

  it('holds the monthly cap when many people ask at the same moment', async () => {
    const people = await Promise.all(Array.from({ length: 10 }, () => createUser(db)));
    const { workspaceId, bodies } = setUp({ monthlyRequests: 4 });
    const outcomes = await Promise.all(
      people.map((person) => outcome(askClaude(db, request(workspaceId, person.id)))),
    );
    expect(outcomes.filter((result) => result === 'sent')).toHaveLength(4);
    expect(outcomes.filter((result) => result === 'monthly_cap')).toHaveLength(6);
    expect(bodies).toHaveLength(4);
    expect(await usageOf(workspaceId)).toHaveLength(4);
  });

  it("holds each person's limit when their requests arrive at the same moment", async () => {
    const sam = await createUser(db);
    const { workspaceId, bodies } = setUp();
    await db.insert(claudeUsage).values(
      Array.from({ length: PERSON_REQUESTS - 1 }, () => ({
        workspaceId: randomUUID(),
        userId: sam.id,
        feature: 'assistant' as const,
        status: 'ok' as const,
        createdAt: new Date(),
      })),
    );
    const outcomes = await Promise.all(
      [1, 2, 3].map(() => outcome(askClaude(db, request(workspaceId, sam.id)))),
    );
    expect(outcomes.sort()).toEqual(['sent', 'user_rate_limit', 'user_rate_limit']);
    expect(bodies).toHaveLength(1);
  });

  it('lets each person wait on only a few requests at once', async () => {
    const sam = await createUser(db);
    const riley = await createUser(db);
    const claude = gate();
    const { workspaceId, bodies } = setUp({ held: claude.opened });
    const settled: string[] = [];
    const asking = Array.from({ length: PERSON_IN_FLIGHT + 3 }, () =>
      outcome(askClaude(db, request(workspaceId, sam.id))).then((result) => {
        settled.push(result);
        return result;
      }),
    );
    await until(() => bodies.length === PERSON_IN_FLIGHT && settled.length === 3);
    expect(settled).toEqual(['user_rate_limit', 'user_rate_limit', 'user_rate_limit']);
    const waiting = await usageOf(workspaceId);
    expect(waiting.map((row) => row.status)).toEqual(
      Array.from({ length: PERSON_IN_FLIGHT }, () => 'pending'),
    );
    const rileyAsks = outcome(askClaude(db, request(workspaceId, riley.id)));
    await until(() => bodies.length === PERSON_IN_FLIGHT + 1);

    claude.open();
    expect(await rileyAsks).toBe('sent');
    const outcomes = await Promise.all(asking);
    expect(outcomes.filter((result) => result === 'sent')).toHaveLength(PERSON_IN_FLIGHT);
    expect(await outcome(askClaude(db, request(workspaceId, sam.id)))).toBe('sent');
    const rows = await usageOf(workspaceId);
    expect(rows).toHaveLength(PERSON_IN_FLIGHT + 2);
    expect(rows.every((row) => row.status === 'ok' && row.inputTokens === 10)).toBe(true);
  });

  it("keeps the usage row when the caller's transaction rolls back", async () => {
    const sam = await createUser(db);
    const { workspaceId } = setUp();
    const rolledBack = new Error('The caller changed its mind.');
    await expect(
      db.transaction(async (tx) => {
        await askClaude(tx, request(workspaceId, sam.id));
        throw rolledBack;
      }),
    ).rejects.toBe(rolledBack);
    expect(await usageOf(workspaceId)).toMatchObject([{ status: 'ok', inputTokens: 10 }]);
  });

  it("sends nothing until the app's database is bound", async () => {
    const sam = await createUser(db);
    const { workspaceId, bodies } = setUp();
    restores.push(configureClaude({ db: undefined }));
    expect(await outcome(askClaude(db, request(workspaceId, sam.id)))).toBe('unavailable');
    expect(bodies).toHaveLength(0);
    expect(await usageOf(workspaceId)).toEqual([]);
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

describe('claudeFeaturesOn', () => {
  it("reads the workspace's settings once for every feature", async () => {
    let reads = 0;
    const restore = configureClaude({
      settings: () => ({
        apiKey: KEY,
        model: 'claude-test',
        monthlyRequests: 3000,
        url: CLAUDE_MESSAGES_URL,
      }),
      access: {
        settingsOn: async () => {
          reads += 1;
          return new Set([CLAUDE_APPROVAL_KEY, claudeSwitchKey('writing_help')]);
        },
        canUseClaude: async () => true,
      },
    });
    try {
      const on = await claudeFeaturesOn({} as Db, randomUUID());
      expect(reads).toBe(1);
      expect(Object.entries(on).filter(([, isOn]) => isOn)).toEqual([['writing_help', true]]);
    } finally {
      restore();
    }
  });
});
