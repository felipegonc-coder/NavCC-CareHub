import { randomUUID } from 'node:crypto';
import { ASSISTANT_TEXTS, type AssistantPageLink } from '@carehub/extras/claude/assistant';
import { eq, inArray, sql } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestApp,
  createUser,
  hasDatabase,
  injectAs,
  type TestApp,
  type TestUser,
} from '../../../testing';
import { users } from '../../auth/schema';
import { bindClaudeMembers, configureClaude, type ClaudeMember } from '../index';
import { setWorkspaceSetting } from '../server/workspace-settings';
import { removeAllExpiredChats, saveTurn, type Turn } from './chats';
import assistantRoutes from './routes';
import { claudeChats, claudeMessages } from './schema';

// Fictional people and pages only.
const NOW = new Date('2026-10-27T18:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const NO_ACCESS = { code: 'forbidden', message: "You don't have access to this." };

describe.skipIf(!hasDatabase)('assistant chats on Postgres', () => {
  let t: TestApp;
  /** Avery and Sam are Editors, Ari an Admin, Morgan a Viewer without Use Claude. */
  let avery: TestUser;
  let sam: TestUser;
  let ari: TestUser;
  let morgan: TestUser;
  let workspaceId: string;
  const members = new Map<string, ClaudeMember>();
  /** Who can open which page. */
  const canOpen = new Map<string, Set<string>>();
  let unbind: (() => void)[] = [];

  beforeAll(async () => {
    t = await createTestApp({
      routes: async (app) => {
        // Its own prefix, so it never clashes with /api/claude once claude/routes.ts registers it.
        await app.register(assistantRoutes, { prefix: '/api/test-claude' });
      },
    });
    avery = await createUser(t.db, { name: 'Avery Lin', email: 'avery.lin@example.test' });
    sam = await createUser(t.db, { name: 'Sam Ortiz', email: 'sam.ortiz@example.test' });
    ari = await createUser(t.db, { name: 'Ari Admin', email: 'ari.admin@example.test' });
    morgan = await createUser(t.db, { name: 'Morgan Viewer', email: 'morgan@example.test' });
  });
  beforeEach(() => {
    workspaceId = randomUUID();
    members.clear();
    for (const user of [avery, sam, morgan]) members.set(user.id, { workspaceId, isAdmin: false });
    members.set(ari.id, { workspaceId, isAdmin: true });
    canOpen.clear();
    unbind = [
      bindClaudeMembers(async (_db, userId) => members.get(userId) ?? null),
      configureClaude({
        access: {
          isSettingOn: async () => true,
          canUseClaude: async (_db, _id, userId) => userId !== morgan.id,
        },
        pages: {
          canOpenPage: async (_db, id, userId, pageId) =>
            id === workspaceId && (canOpen.get(userId)?.has(pageId) ?? false),
        },
        now: () => NOW,
      }),
    ];
  });
  afterEach(() => {
    for (const done of unbind) done();
  });
  afterAll(async () => {
    await t?.close();
  });

  const page = (title: string, ...openTo: TestUser[]): AssistantPageLink => {
    const id = randomUUID();
    for (const user of openTo) canOpen.set(user.id, (canOpen.get(user.id) ?? new Set()).add(id));
    return { id, title };
  };
  const ask = (user: TestUser, turn: Partial<Turn> = {}) =>
    saveTurn(
      t.db,
      { workspaceId, userId: user.id },
      {
        chatId: null,
        question: 'How long do refunds take?',
        scope: 'no_pages',
        pages: [],
        answer: 'Refunds take 3 working days.',
        sources: [],
        askedAt: NOW,
        answeredAt: NOW,
        ...turn,
      },
    );
  const as = (user: TestUser, method: string, url: string, payload?: object) =>
    injectAs(t.app, user, { method, url: `/api/test-claude/assistant${url}`, payload });

  it("lists only the person's own chats in this workspace, last used first", async () => {
    const older = await ask(avery, { answeredAt: new Date(NOW.getTime() - DAY_MS) });
    const newer = await ask(avery, { question: 'Who signs off\non a refund?' });
    await ask(sam);
    const response = await as(avery, 'GET', '/chats');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      chats: [
        {
          id: newer.chat.id,
          title: 'Who signs off',
          questions: 1,
          createdAt: NOW.toISOString(),
          updatedAt: NOW.toISOString(),
        },
        expect.objectContaining({ id: older.chat.id, title: 'How long do refunds take?' }),
      ],
    });
    members.set(avery.id, { workspaceId: randomUUID(), isAdmin: false });
    expect((await as(avery, 'GET', '/chats')).json()).toEqual({ chats: [] });
  });

  it('lets nobody else list, open, rename or delete a chat, Admins included (CL-11)', async () => {
    const { chat } = await ask(avery);
    for (const user of [ari, sam]) {
      for (const [method, payload] of [
        ['GET'],
        ['PATCH', { title: 'Mine now' }],
        ['DELETE'],
      ] as const) {
        const response = await as(user, method, `/chats/${chat.id}`, payload);
        expect(response.statusCode).toBe(403);
        expect(response.json().error).toMatchObject(NO_ACCESS);
      }
      expect((await as(user, 'GET', '/chats')).json()).toEqual({ chats: [] });
    }
    const [still] = await t.db.select().from(claudeChats).where(eq(claudeChats.id, chat.id));
    expect(still?.title).toBe('How long do refunds take?');

    // Without Use Claude, outside the workspace, or signed out.
    expect((await as(morgan, 'GET', '/chats')).json().error).toMatchObject(NO_ACCESS);
    members.delete(sam.id);
    expect((await as(sam, 'GET', '/chats')).statusCode).toBe(403);
    const signedOut = await t.app.inject({
      method: 'GET',
      url: '/api/test-claude/assistant/chats',
    });
    expect(signedOut.statusCode).toBe(401);
    expect((await as(avery, 'GET', `/chats/${randomUUID()}`)).statusCode).toBe(404);
    expect((await as(avery, 'GET', '/chats/not-an-id')).statusCode).toBe(400);
    members.set(avery.id, { workspaceId: randomUUID(), isAdmin: false });
    expect((await as(avery, 'GET', `/chats/${chat.id}`)).statusCode).toBe(404);
  });

  it('opens a chat in order, showing only pages the person can still open (CL-10)', async () => {
    const policy = page('Refund policy', avery);
    const secret = page('Payroll exceptions', avery);
    const first = await ask(avery, {
      scope: 'all_pages',
      pages: [policy, secret],
      sources: [policy, secret],
    });
    await ask(avery, {
      chatId: first.chat.id,
      question: 'And for gift cards?',
      scope: 'this_page',
      pages: [policy],
      answer: "Gift cards aren't refunded.",
      sources: [policy],
    });
    canOpen.get(avery.id)?.delete(secret.id);
    const response = await as(avery, 'GET', `/chats/${first.chat.id}`);
    expect(response.statusCode).toBe(200);
    const { chat, messages } = response.json();
    expect(chat).toMatchObject({ id: first.chat.id, questions: 2 });
    expect(messages.map((m: { role: string; text: string }) => [m.role, m.text])).toEqual([
      ['question', 'How long do refunds take?'],
      ['answer', 'Refunds take 3 working days.'],
      ['question', 'And for gift cards?'],
      ['answer', "Gift cards aren't refunded."],
    ]);
    expect(messages[0]).toMatchObject({ scope: 'all_pages', pages: [policy], sources: [] });
    expect(messages[1]).toMatchObject({ scope: null, pages: [], sources: [policy] });
    expect(JSON.stringify(messages)).not.toContain('Payroll');
  });

  it('renames a chat and deletes it for good, with its messages', async () => {
    const { chat } = await ask(avery);
    const renamed = await as(avery, 'PATCH', `/chats/${chat.id}`, { title: '  Refund timing ' });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().chat).toMatchObject({ id: chat.id, title: 'Refund timing' });
    expect((await as(avery, 'PATCH', `/chats/${chat.id}`, { title: ' ' })).statusCode).toBe(400);
    const long = { title: 'x'.repeat(81) };
    expect((await as(avery, 'PATCH', `/chats/${chat.id}`, long)).statusCode).toBe(400);

    expect((await as(avery, 'DELETE', `/chats/${chat.id}`)).statusCode).toBe(204);
    expect((await as(avery, 'GET', `/chats/${chat.id}`)).statusCode).toBe(404);
    const left = await t.db.select().from(claudeMessages).where(eq(claudeMessages.chatId, chat.id));
    expect(left).toEqual([]);
  });

  it('remembers 50 questions in a chat, then asks for a new one', async () => {
    const { chat } = await ask(avery);
    for (let n = 2; n <= 50; n += 1)
      await ask(avery, { chatId: chat.id, question: `Question ${n}` });
    await expect(ask(avery, { chatId: chat.id })).rejects.toMatchObject({
      statusCode: 409,
      message: ASSISTANT_TEXTS.chatFull,
    });
    const turns = await t.db
      .select()
      .from(claudeMessages)
      .where(eq(claudeMessages.chatId, chat.id));
    expect(turns).toHaveLength(100);
    await expect(ask(avery, { chatId: randomUUID() })).rejects.toMatchObject({ statusCode: 404 });
  });

  it('keeps chats until deleted, or for the days an Admin chose (CL-D3)', async () => {
    const old = await ask(avery, { answeredAt: new Date(NOW.getTime() - 31 * DAY_MS) });
    const recent = await ask(avery, { answeredAt: new Date(NOW.getTime() - 29 * DAY_MS) });
    const listed = async () =>
      (await as(avery, 'GET', '/chats')).json().chats.map((chat: { id: string }) => chat.id);
    expect(await listed()).toEqual([recent.chat.id, old.chat.id]);
    await setWorkspaceSetting(t.db, workspaceId, 'claude.chatRetentionDays', 30, ari.id);
    expect(await listed()).toEqual([recent.chat.id]);
    const [gone] = await t.db.select().from(claudeChats).where(eq(claudeChats.id, old.chat.id));
    expect(gone).toBeUndefined();
  });

  it('removes expired chats in every workspace each hour, also when nobody asks', async () => {
    const old = await ask(avery, { answeredAt: new Date(NOW.getTime() - 31 * DAY_MS) });
    const recent = await ask(sam, { answeredAt: new Date(NOW.getTime() - 29 * DAY_MS) });
    // Another workspace keeps its chats until they're deleted (no days chosen).
    const elsewhere = await saveTurn(
      t.db,
      { workspaceId: randomUUID(), userId: avery.id },
      {
        chatId: null,
        question: 'Where is the visit checklist?',
        scope: 'no_pages',
        pages: [],
        answer: 'In Visit notes.',
        sources: [],
        askedAt: new Date(NOW.getTime() - 400 * DAY_MS),
        answeredAt: new Date(NOW.getTime() - 400 * DAY_MS),
      },
    );
    await setWorkspaceSetting(t.db, workspaceId, 'claude.chatRetentionDays', 30, ari.id);
    await removeAllExpiredChats(t.db, NOW);
    const ids = [old.chat.id, recent.chat.id, elsewhere.chat.id];
    const left = await t.db
      .select({ id: claudeChats.id })
      .from(claudeChats)
      .where(inArray(claudeChats.id, ids));
    expect(left.map((row) => row.id).sort()).toEqual([recent.chat.id, elsewhere.chat.id].sort());
  });

  it('removes chats with the account', async () => {
    const leaving = await createUser(t.db, { name: 'Rey Leaving', email: 'rey@example.test' });
    members.set(leaving.id, { workspaceId, isAdmin: false });
    const { chat } = await ask(leaving);
    await t.db.delete(users).where(eq(users.id, leaving.id));
    const rows = await t.db.select().from(claudeChats).where(eq(claudeChats.id, chat.id));
    expect(rows).toEqual([]);
  });

  it('has tables exactly as the Drizzle definitions describe them', async () => {
    for (const table of [claudeChats, claudeMessages]) {
      const config = getTableConfig(table);
      const { rows } = await t.db.execute<{
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
