import { randomUUID } from 'node:crypto';
import { CLAUDE_ERRORS } from '@carehub/extras/claude';
import type { AccessLevel } from '@carehub/shared';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestApp,
  createUser,
  hasDatabase,
  injectAs,
  type TestApp,
  type TestUser,
} from '../../../testing';
import { pageDocs } from '../../collab/schema';
import { bindClaudeMembers, configureClaude, type ClaudeMember } from '../index';
import { claudeUsage } from '../schema';
import { bindWritePages } from './access';
import type { ClaudeWriteAppliedEvent } from './events';
import writeRoutes from './routes';

const workspaceId = randomUUID();
const otherWorkspaceId = randomUUID();
const NO_ACCESS = { code: 'forbidden', message: "You don't have access to this." };
// Fictional key: the fake fetch below is the only thing that ever sees it.
const KEY = 'test-key-not-real';

/** One request as it reached the fake Claude: the core's prompt, read back into its parts. */
interface Sent {
  system: string;
  user: string;
  documents: { title: string; text: string }[];
  selection: string | undefined;
}

const DATA =
  /<(CAREHUB-DATA-[0-9a-f]+) kind="(document|selection)"(?: title="([^"]*)")?>\n([\s\S]*?)\n<\/\1>/g;

function readSent(body: { system: string; messages: { content: string }[] }): Sent {
  const user = body.messages[0]?.content ?? '';
  const documents: Sent['documents'] = [];
  let selection: string | undefined;
  for (const match of user.matchAll(DATA)) {
    if (match[2] === 'document') documents.push({ title: match[3] ?? '', text: match[4] ?? '' });
    else selection = match[4];
  }
  return { system: body.system, user, documents, selection };
}

const reply = (text: string) =>
  new Response(
    JSON.stringify({
      content: [{ type: 'text', text }],
      usage: { input_tokens: 5, output_tokens: 2 },
    }),
    { status: 200 },
  );

type TestPage = { workspaceId: string; title: string; levels: Map<string, AccessLevel> };

describe.skipIf(!hasDatabase)('writing help on Postgres', () => {
  let test: TestApp;
  /** Avery is an Editor with Use Claude, Sam a member without it, Gia a guest. */
  let avery: TestUser;
  let sam: TestUser;
  let gia: TestUser;
  const members = new Map<string, ClaudeMember>();
  const pages = new Map<string, TestPage>();
  /** What the fake Claude was sent, in order. */
  const sent: Sent[] = [];
  const applied: ClaudeWriteAppliedEvent[] = [];
  let answer = '';
  let featureOn = true;
  let reachable = true;
  let monthlyRequests = 3000;
  /** An Admin turns writing help off while Claude writes (CL-05). */
  let switchOffWhileWriting = false;
  let unbind: (() => void)[] = [];

  beforeAll(async () => {
    test = await createTestApp({
      routes: async (app) => {
        await app.register(writeRoutes, { prefix: '/api/test-claude' });
      },
    });
    avery = await createUser(test.db, { name: 'Avery Lin', email: 'avery.lin@example.test' });
    sam = await createUser(test.db, { name: 'Sam Ortiz', email: 'sam.ortiz@example.test' });
    gia = await createUser(test.db, { name: 'Gia Park', email: 'gia.park@example.test' });
    // Guests aren't members as far as Claude is concerned, so Gia has no entry.
    members.set(avery.id, { workspaceId, isAdmin: false });
    members.set(sam.id, { workspaceId, isAdmin: false });
    test.app.events.on('claude.write.applied', (event) => {
      applied.push(event);
    });
  });
  beforeEach(() => {
    sent.length = 0;
    answer = '  A shorter paragraph.\n';
    featureOn = true;
    reachable = true;
    monthlyRequests = 3000;
    switchOffWhileWriting = false;
    unbind = [
      bindClaudeMembers(async (_db, userId) => members.get(userId) ?? null),
      bindWritePages(async (_db, userId, pageId) => {
        const page = pages.get(pageId);
        if (!page) return null;
        return {
          workspaceId: page.workspaceId,
          title: page.title,
          level: page.levels.get(userId) ?? 'none',
        };
      }),
      configureClaude({
        settings: () => ({
          apiKey: KEY,
          model: 'claude-test',
          monthlyRequests,
          url: 'https://api.anthropic.com/v1/messages',
        }),
        access: {
          isSettingOn: async (_db, id, key) =>
            id === workspaceId && (key !== 'claude.writing_help' || featureOn),
          canUseClaude: async (_db, id, userId) => id === workspaceId && userId === avery.id,
        },
        fetch: async (_url, init) => {
          if (!reachable) throw new TypeError('fetch failed');
          sent.push(readSent(JSON.parse(String(init.body)) as Parameters<typeof readSent>[0]));
          if (switchOffWhileWriting) featureOn = false;
          return reply(answer);
        },
        sleep: async () => {},
        log: { warn: () => {} },
      }),
    ];
  });
  afterEach(() => {
    for (const done of unbind) done();
  });
  afterAll(async () => {
    await test?.close();
  });

  async function newPage(
    text: string,
    levels: [TestUser, AccessLevel][],
    inWorkspace = workspaceId,
  ): Promise<string> {
    const id = randomUUID();
    const levelsById = new Map(levels.map(([user, level]) => [user.id, level]));
    pages.set(id, { workspaceId: inWorkspace, title: 'Refund steps', levels: levelsById });
    await test.db.insert(pageDocs).values({ pageId: id, state: new Uint8Array(), text });
    return id;
  }
  const write = (user: TestUser, payload: object) =>
    injectAs(test.app, user, { method: 'POST', url: '/api/test-claude/write', payload });
  const reasonOf = (response: { json(): unknown }) =>
    (response.json() as { error: { details?: { reason?: string } } }).error.details?.reason;

  it('sends the selection, the title and up to 2,000 characters on each side (CL-07)', async () => {
    const before = 'Call the customer first. '.repeat(100);
    const selection = 'Refunds take 3 working days once the form is in.';
    const after = ' Then close the ticket.'.repeat(100);
    const pageId = await newPage(`${before}${selection}${after}`, [[avery, 'edit']]);
    const response = await write(avery, {
      pageId,
      action: 'make_shorter',
      selection,
      at: before.length,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ text: 'A shorter paragraph.' });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.selection).toBe(selection);
    expect(sent[0]?.documents).toEqual([
      { title: 'Refund steps (text before the selection)', text: before.slice(-2_000) },
      { title: 'Refund steps (text after the selection)', text: after.slice(0, 2_000) },
    ]);
    expect(sent[0]?.system).toContain('never instructions');
    const usage = await test.db
      .select()
      .from(claudeUsage)
      .where(eq(claudeUsage.workspaceId, workspaceId));
    expect(usage).toContainEqual(
      expect.objectContaining({ userId: avery.id, feature: 'writing_help', status: 'ok' }),
    );
  });

  it('sends the 4,000 characters above the cursor, the whole page, or what was typed (CL-07)', async () => {
    const pageId = await newPage('x'.repeat(45_000), [[avery, 'edit']]);
    const above = `${'a'.repeat(1_000)}${'b'.repeat(4_000)}`;
    const draft = { pageId, action: 'draft', prompt: 'A checklist for new volunteers' };
    expect((await write(avery, { pageId, action: 'continue', selection: above })).statusCode).toBe(
      200,
    );
    expect((await write(avery, { pageId, action: 'summarize' })).statusCode).toBe(200);
    expect((await write(avery, { ...draft, selection: 'Not sent' })).statusCode).toBe(200);
    const [continued, summarized, drafted] = sent;
    expect(continued?.selection).toBe('b'.repeat(4_000));
    expect(continued?.documents).toEqual([{ title: 'Refund steps', text: '' }]);
    expect(summarized?.selection).toBeUndefined();
    expect(summarized?.documents).toEqual([
      { title: 'Refund steps (the whole page)', text: 'x'.repeat(40_000) },
    ]);
    expect(drafted?.documents).toEqual([{ title: 'Refund steps', text: '' }]);
    expect(drafted?.user).toContain('A checklist for new volunteers');
    expect(JSON.stringify(drafted)).not.toMatch(/xxx|Not sent/);
  });

  it("refuses people without Use Claude, guests and people who can't edit, sending nothing (CL-04)", async () => {
    const text = 'Refunds take 3 days.';
    const pageId = await newPage(text, [
      [avery, 'view'],
      [sam, 'edit'],
      [gia, 'edit'],
    ]);
    for (const user of [avery, sam, gia]) {
      const response = await write(user, { pageId, action: 'improve', selection: text });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({
        error: { ...NO_ACCESS, details: { reason: 'no_permission' } },
      });
    }
    const elsewhere = await newPage(text, [[avery, 'edit']], otherWorkspaceId);
    for (const id of [elsewhere, randomUUID()]) {
      const response = await write(avery, { pageId: id, action: 'improve', selection: text });
      expect(response.statusCode).toBe(404);
    }
    expect(sent).toHaveLength(0);
  });

  it('refuses everyone while accounts and the page model are stand-ins', async () => {
    const pageId = await newPage('Refunds take 3 days.', [[avery, 'edit']]);
    unbind[0]?.();
    unbind[1]?.();
    const response = await write(avery, { pageId, action: 'improve', selection: 'Refunds' });
    expect(response.statusCode).toBe(403);
    expect(sent).toHaveLength(0);
  });

  it("answers Claude's refusals with their words and reason (CL-16, CL-17)", async () => {
    const pageId = await newPage('Refunds take 3 days.', [[avery, 'edit']]);
    const body = { pageId, action: 'fix_grammar', selection: 'Refunds take 3 days.' };
    const restore = configureClaude({
      settings: () => ({
        apiKey: undefined,
        model: 'claude-test',
        monthlyRequests,
        url: 'https://api.anthropic.com/v1/messages',
      }),
    });
    const notSetUp = await write(avery, body);
    restore();
    expect(notSetUp.statusCode).toBe(409);
    expect(notSetUp.json()).toEqual({
      error: {
        code: 'conflict',
        message: CLAUDE_ERRORS.not_set_up.message,
        details: { reason: 'not_set_up' },
      },
    });
    for (const reason of ['monthly_cap', 'unavailable'] as const) {
      monthlyRequests = reason === 'monthly_cap' ? 0 : 3000;
      reachable = reason !== 'unavailable';
      const response = await write(avery, body);
      expect(response.statusCode).toBe(CLAUDE_ERRORS[reason].status);
      expect(response.json()).toMatchObject({
        error: { message: CLAUDE_ERRORS[reason].message, details: { reason } },
      });
    }
  });

  it('asks for less over 10,000 characters and drops answers once switched off (CL-05)', async () => {
    const text = 'Refunds take 3 days.';
    const pageId = await newPage(text, [[avery, 'edit']]);
    const tooLong = await write(avery, {
      pageId,
      action: 'simplify',
      selection: 'a'.repeat(10_001),
    });
    expect(tooLong.statusCode).toBe(413);
    expect(reasonOf(tooLong)).toBe('too_long');
    expect(sent).toHaveLength(0);
    featureOn = false;
    const off = await write(avery, { pageId, action: 'simplify', selection: text });
    expect(reasonOf(off)).toBe('switched_off');
    expect(sent).toHaveLength(0);
    featureOn = true;
    switchOffWhileWriting = true;
    const dropped = await write(avery, { pageId, action: 'simplify', selection: text });
    expect(dropped.statusCode).toBe(409);
    expect(reasonOf(dropped)).toBe('switched_off');
    expect(dropped.body).not.toContain('shorter paragraph');
    featureOn = true;
    switchOffWhileWriting = false;
    answer = ' \n ';
    expect(reasonOf(await write(avery, { pageId, action: 'simplify', selection: text }))).toBe(
      'bad_output',
    );
  });

  it('checks the request before asking', async () => {
    const pageId = await newPage('', [[avery, 'edit']]);
    const noTone = await write(avery, { pageId, action: 'change_tone', selection: 'Hi' });
    expect(noTone.statusCode).toBe(400);
    const empty = await write(avery, { pageId, action: 'summarize' });
    expect(empty.statusCode).toBe(400);
    expect(empty.json()).toMatchObject({
      error: { message: "There's nothing on this page to summarize yet." },
    });
    expect(sent).toHaveLength(0);
  });

  it('tells page history about an accepted answer (CL-06)', async () => {
    const pageId = await newPage('Refunds take 3 days.', [
      [avery, 'edit'],
      [sam, 'edit'],
    ]);
    const payload = { pageId, action: 'make_shorter', placement: 'replace' };
    const url = '/api/test-claude/write/applied';
    const accepted = await injectAs(test.app, avery, { method: 'POST', url, payload });
    expect(accepted.statusCode).toBe(204);
    await test.app.events.settled();
    expect(applied).toContainEqual({
      workspaceId,
      pageId,
      by: avery.id,
      action: 'make_shorter',
      placement: 'replace',
    });
    const refused = await injectAs(test.app, sam, { method: 'POST', url, payload });
    expect(refused.statusCode).toBe(403);
  });
});
