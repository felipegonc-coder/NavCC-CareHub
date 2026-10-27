import { randomUUID } from 'node:crypto';
import { ASSISTANT_TEXTS, type AssistantPageLink } from '@carehub/extras/claude/assistant';
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
import { bindAssistantSearch } from './ask';
import { saveTurn } from './chats';
import { bindAssistantPages } from './pages';
import assistantRoutes from './routes';
import { claudeChats, claudeMessages } from './schema';

// Fictional people, pages and key only: the fake fetch below is all that ever sees the key.
const KEY = 'sk-ant-FICTIONAL-assistant-test';
const NOW = new Date('2026-10-27T18:00:00Z');
const UNIQUE = 'Zebrafinch-4471';

interface Sent {
  system: string;
  user: string;
  documents: { title: string; text: string }[];
}
const DATA = /<(CAREHUB-DATA-[0-9a-f]+) kind="document" title="([^"]*)">\n([\s\S]*?)\n<\/\1>/g;
function readSent(body: { system: string; messages: { content: string }[] }): Sent {
  const user = body.messages[0]?.content ?? '';
  const documents = Array.from(user.matchAll(DATA), (match) => ({
    title: match[2] ?? '',
    text: match[3] ?? '',
  }));
  return { system: body.system, user, documents };
}
const reply = (text: string) =>
  new Response(
    JSON.stringify({
      content: [{ type: 'text', text }],
      usage: { input_tokens: 9, output_tokens: 4 },
    }),
    { status: 200 },
  );

describe.skipIf(!hasDatabase)('assistant questions on Postgres', () => {
  let t: TestApp;
  /** Avery and Sam are Editors with Use Claude; Morgan is a Viewer without it. */
  let avery: TestUser;
  let sam: TestUser;
  let morgan: TestUser;
  let workspaceId: string;
  const pages = new Map<string, { workspaceId: string; title: string; openTo: Set<string> }>();
  const sent: Sent[] = [];
  const searched: string[][] = [];
  let found: AssistantPageLink[] = [];
  let answer = '';
  let featureOn = true;
  let switchOffWhileWriting = false;
  let reachable = true;
  let unbind: (() => void)[] = [];

  beforeAll(async () => {
    t = await createTestApp({
      routes: async (app) => {
        await app.register(assistantRoutes, { prefix: '/api/test-claude' });
      },
    });
    avery = await createUser(t.db, { name: 'Avery Lin', email: 'avery.lin@example.test' });
    sam = await createUser(t.db, { name: 'Sam Ortiz', email: 'sam.ortiz@example.test' });
    morgan = await createUser(t.db, { name: 'Morgan Lee', email: 'morgan.lee@example.test' });
  });
  beforeEach(() => {
    workspaceId = randomUUID();
    sent.length = 0;
    searched.length = 0;
    found = [];
    answer = 'Refunds take 3 working days.\n\nSources: 1';
    featureOn = true;
    switchOffWhileWriting = false;
    reachable = true;
    const members = new Map<string, ClaudeMember>(
      [avery, sam, morgan].map((user) => [user.id, { workspaceId, isAdmin: false }]),
    );
    unbind = [
      bindClaudeMembers(async (_db, userId) => members.get(userId) ?? null),
      bindAssistantPages(async (_db, pageId) => pages.get(pageId) ?? null),
      bindAssistantSearch(async (_db, _asker, words) => {
        searched.push([...words]);
        return found;
      }),
      configureClaude({
        settings: () => ({
          apiKey: KEY,
          model: 'claude-test',
          monthlyRequests: 3000,
          url: 'https://api.anthropic.com/v1/messages',
        }),
        access: {
          isSettingOn: async (_db, id, key) =>
            id === workspaceId && (key !== 'claude.assistant' || featureOn),
          canUseClaude: async (_db, _id, userId) => userId !== morgan.id,
        },
        pages: {
          canOpenPage: async (_db, id, userId, pageId) => {
            const page = pages.get(pageId);
            return page?.workspaceId === id && page.openTo.has(userId);
          },
        },
        fetch: async (_url, init) => {
          if (!reachable) throw new TypeError('fetch failed');
          sent.push(readSent(JSON.parse(String(init.body)) as Parameters<typeof readSent>[0]));
          if (switchOffWhileWriting) featureOn = false;
          return reply(answer);
        },
        sleep: async () => {},
        log: { warn: () => {} },
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

  async function newPage(title: string, text: string, ...openTo: TestUser[]) {
    const id = randomUUID();
    pages.set(id, { workspaceId, title, openTo: new Set(openTo.map((user) => user.id)) });
    await t.db.insert(pageDocs).values({ pageId: id, state: new Uint8Array(), text });
    return { id, title };
  }
  const ask = (user: TestUser, payload: object) =>
    injectAs(t.app, user, { method: 'POST', url: '/api/test-claude/assistant/ask', payload });
  const reasonOf = (response: { json(): unknown }) =>
    (response.json() as { error: { details?: { reason?: string } } }).error.details?.reason;
  const savedChats = (user: TestUser) =>
    t.db.select().from(claudeChats).where(eq(claudeChats.ownerId, user.id));

  it('This page sends the open page, and the answer lists it as its source (CL-09)', async () => {
    const policy = await newPage('Refund policy', 'Refunds take 3 working days.', avery);
    const response = await ask(avery, {
      question: 'How long do refunds take?',
      scope: 'this_page',
      pageId: policy.id,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.chat).toMatchObject({ title: 'How long do refunds take?', questions: 1 });
    expect(body.question).toMatchObject({ role: 'question', scope: 'this_page', pages: [policy] });
    expect(body.answer).toMatchObject({
      role: 'answer',
      text: 'Refunds take 3 working days.',
      sources: [policy],
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.documents).toEqual([
      { title: 'Source 1: Refund policy', text: 'Refunds take 3 working days.' },
    ]);
    expect(sent[0]?.user.startsWith('Question: How long do refunds take?')).toBe(true);
    expect(sent[0]?.system).toContain(ASSISTANT_TEXTS.notFound);
    expect(searched).toEqual([]);
    const usage = await t.db.select().from(claudeUsage).where(eq(claudeUsage.userId, avery.id));
    expect(usage).toContainEqual(expect.objectContaining({ feature: 'assistant', status: 'ok' }));
  });

  it("All pages I can open searches the question's words and sends the best passages", async () => {
    const filler = Array.from({ length: 200 }, (_, n) => `Parking note ${n}.`).join('\n');
    const policy = await newPage(
      'Refund policy',
      `${filler}\nRefunds take 3 working days.\n${filler}`,
      avery,
    );
    const payroll = await newPage('Payroll exceptions', `Refunds: ${UNIQUE}`, sam);
    const steps = await newPage('Refund steps', 'Log the refund, then close the ticket.', avery);
    found = [policy, payroll, steps];
    answer = 'Three working days, logged first.\nSources: 2, 1';
    const response = await ask(avery, {
      question: 'How long do refunds take?',
      scope: 'all_pages',
    });
    expect(response.statusCode).toBe(200);
    expect(searched).toEqual([['long', 'refunds', 'take']]);
    expect(sent[0]?.documents).toEqual([
      { title: 'Source 1: Refund policy', text: 'Refunds take 3 working days.' },
      { title: 'Source 2: Refund steps', text: 'Log the refund, then close the ticket.' },
    ]);
    expect(response.json().answer).toMatchObject({
      text: 'Three working days, logged first.',
      sources: [steps, policy],
    });
    expect(response.json().question.pages).toEqual([policy, steps]);
    expect(JSON.stringify([sent, response.json()])).not.toContain(UNIQUE);
  });

  it('No pages sends no page, and @ pages go in full, up to 40,000 characters in all', async () => {
    const first = await newPage('Handbook', 'a'.repeat(30_000), avery);
    const second = await newPage('Rota', 'b'.repeat(20_000), avery);
    answer = 'Here is a summary.';
    const plain = await ask(avery, { question: 'What is a refund?', scope: 'no_pages' });
    expect(plain.statusCode).toBe(200);
    expect(sent[0]?.documents).toEqual([]);
    expect(plain.json().answer.sources).toEqual([]);
    const withPages = await ask(avery, {
      question: 'Sum these up',
      scope: 'no_pages',
      pageIds: [first.id, second.id, first.id],
    });
    expect(withPages.statusCode).toBe(200);
    expect(sent[1]?.documents).toEqual([
      { title: 'Source 1: Handbook', text: 'a'.repeat(30_000) },
      { title: 'Source 2: Rota', text: 'b'.repeat(10_000) },
    ]);
    // No "Sources:" line: every page sent counts.
    expect(withPages.json().answer.sources).toEqual([first, second]);
    expect(searched).toEqual([]);
  });

  it("says it couldn't find it, without a request when nothing the person can open matches", async () => {
    const response = await ask(avery, {
      question: 'Where is the parking map?',
      scope: 'all_pages',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().answer).toMatchObject({ text: ASSISTANT_TEXTS.notFound, sources: [] });
    expect(sent).toEqual([]);
    const policy = await newPage('Refund policy', 'Refunds take 3 working days.', avery);
    answer = 'I couldn’t find that in the pages you can open.\nSources: 1';
    const asked = await ask(avery, {
      question: 'Who drew the map?',
      scope: 'this_page',
      pageId: policy.id,
    });
    expect(asked.json().answer).toMatchObject({ text: ASSISTANT_TEXTS.notFound, sources: [] });
  });

  it('checks access again for every question in a chat (CL-10)', async () => {
    const secret = await newPage('Payroll exceptions', `Refunds: ${UNIQUE} days.`, avery);
    answer = `Refunds take ${UNIQUE} days.\nSources: 1`;
    const first = await ask(avery, {
      question: 'How long?',
      scope: 'this_page',
      pageId: secret.id,
    });
    expect(first.json().answer.text).toContain(UNIQUE);
    const chatId = first.json().chat.id;

    pages.get(secret.id)?.openTo.delete(avery.id);
    found = [secret];
    answer = 'Ten days.';
    const again = await ask(avery, { chatId, question: 'And refunds?', scope: 'all_pages' });
    expect(again.statusCode).toBe(200);
    expect(again.json().answer).toMatchObject({ text: ASSISTANT_TEXTS.notFound, sources: [] });
    const third = await ask(avery, { chatId, question: 'In short?', scope: 'no_pages' });
    expect(third.statusCode).toBe(200);
    expect(sent).toHaveLength(2);
    expect(sent[1]?.documents).toEqual([
      {
        title: 'Earlier in this chat',
        text: [
          'Question: How long?\nAnswer: (left out)',
          `Question: And refunds?\nAnswer: ${ASSISTANT_TEXTS.notFound}`,
        ].join('\n\n'),
      },
    ]);
    expect(JSON.stringify(sent[1])).not.toContain(UNIQUE);
    const refused = await ask(avery, {
      chatId,
      question: 'Q',
      scope: 'this_page',
      pageId: secret.id,
    });
    expect(refused.statusCode).toBe(403);
    const atPage = await ask(avery, {
      chatId,
      question: 'Q',
      scope: 'no_pages',
      pageIds: [secret.id],
    });
    expect(atPage.statusCode).toBe(403);
    expect(sent).toHaveLength(2);
    const opened = await injectAs(t.app, avery, {
      method: 'GET',
      url: `/api/test-claude/assistant/chats/${chatId}`,
    });
    expect(
      JSON.stringify(
        opened
          .json()
          .messages.map((m: { pages: unknown; sources: unknown }) => [m.pages, m.sources]),
      ),
    ).not.toContain(secret.id);
  });

  it('asks in the chat it was given, and only in the person’s own chat', async () => {
    answer = 'Three days.';
    const first = await ask(avery, { question: 'How long?', scope: 'no_pages' });
    const chatId = first.json().chat.id;
    const second = await ask(avery, { chatId, question: 'Why?', scope: 'no_pages' });
    expect(second.json().chat).toMatchObject({ id: chatId, questions: 2, title: 'How long?' });
    const sams = await ask(sam, { chatId, question: 'Can I see this?', scope: 'no_pages' });
    expect(sams.statusCode).toBe(403);
    expect(sent).toHaveLength(2);
    const rows = await t.db.select().from(claudeMessages).where(eq(claudeMessages.chatId, chatId));
    expect(rows).toHaveLength(4);
  });

  it('stops at 50 questions before sending anything', async () => {
    const asker = { workspaceId, userId: avery.id };
    const turn = {
      question: 'Q',
      scope: 'no_pages' as const,
      pages: [],
      answer: 'A',
      sources: [],
      askedAt: NOW,
      answeredAt: NOW,
    };
    const { chat } = await saveTurn(t.db, asker, { ...turn, chatId: null });
    for (let n = 2; n <= 50; n += 1) await saveTurn(t.db, asker, { ...turn, chatId: chat.id });
    const response = await ask(avery, {
      chatId: chat.id,
      question: 'One more?',
      scope: 'no_pages',
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.message).toBe(ASSISTANT_TEXTS.chatFull);
    expect(sent).toEqual([]);
  });

  it('refuses without Use Claude or with the Assistant off, and drops an answer switched off mid-way (CL-04, CL-05)', async () => {
    const viewer = await ask(morgan, { question: 'How long?', scope: 'no_pages' });
    expect(viewer.statusCode).toBe(403);
    featureOn = false;
    const off = await ask(avery, { question: 'How long?', scope: 'all_pages' });
    expect(off.statusCode).toBe(409);
    expect(reasonOf(off)).toBe('switched_off');
    expect(searched).toEqual([]);
    featureOn = true;
    switchOffWhileWriting = true;
    const dropped = await ask(avery, { question: 'How long?', scope: 'no_pages' });
    expect(reasonOf(dropped)).toBe('switched_off');
    expect(sent).toHaveLength(1);
    expect(await savedChats(avery)).toEqual([]);
  });

  it("keeps nothing when Claude isn't available (CL-17)", async () => {
    reachable = false;
    const response = await ask(avery, { question: 'How long?', scope: 'no_pages' });
    expect(response.statusCode).toBe(409);
    expect(reasonOf(response)).toBe('unavailable');
    expect(await savedChats(avery)).toEqual([]);
  });
});
