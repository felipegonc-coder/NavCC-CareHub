import { randomUUID } from 'node:crypto';
import { DEFAULT_TIME_ZONE } from '@carehub/shared';
import type { MessageResponse, MessageSearchResponse, NewChatResponse } from '@carehub/team-chat';
import { todayIn } from '@carehub/team-time';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestApp,
  createUser,
  hasDatabase,
  injectAs,
  type TestApp,
  type TestUser,
} from '../../testing';
import { messageIndex } from './search';

describe('messageIndex', () => {
  const names: Record<string, { name: string }> = { 'u-avery': { name: 'Avery Lin' } };

  it('indexes mentions by name, and notes links and page cards for the Has filter', () => {
    const index = messageIndex(
      {
        text: 'Thanks <@u-avery>, see https://example.org/qa',
        mentions: ['u-avery'],
        pageIds: ['p1'],
      },
      (userId) => names[userId],
    );
    expect(index.search).toContain("'avery':2");
    expect(index.search).not.toContain('u-avery');
    expect(index.has).toEqual(['link', 'pageCard']);
  });
});

describe.skipIf(!hasDatabase)('/api/messages/search', () => {
  let testApp: TestApp;
  let app: FastifyInstance;
  let avery: TestUser;
  let sam: TestUser;
  let riley: TestUser;
  let direct: string;
  let group: string;

  const call = (
    user: { id: string },
    method: 'POST' | 'PATCH' | 'DELETE',
    url: string,
    payload?: object,
  ) => injectAs(app, user, { method, url: `/api/messages${url}`, payload });

  async function send(user: TestUser, chatId: string, text: string) {
    const response = await call(user, 'POST', `/chats/${chatId}/messages`, {
      clientId: randomUUID(),
      text,
    });
    expect(response.statusCode).toBe(201);
    return response.json<MessageResponse>().message;
  }

  async function search(user: TestUser, body: object) {
    const response = await call(user, 'POST', '/search', body);
    expect(response.statusCode).toBe(200);
    return response.json<MessageSearchResponse>();
  }

  const texts = (answer: MessageSearchResponse) => answer.results.map((message) => message.text);
  const nothing = { results: [], hasMore: false, people: {} };

  beforeAll(async () => {
    testApp = await createTestApp();
    app = testApp.app;
    avery = await createUser(testApp.db, { name: 'Avery Lin' });
    sam = await createUser(testApp.db, { name: 'Sam Ortiz' });
    riley = await createUser(testApp.db, { name: 'Riley Chen' });
    const start = async (userIds: string[], name?: string) =>
      (await call(avery, 'POST', '/chats', { userIds, name })).json<NewChatResponse>().chatId;
    direct = await start([sam.id]);
    group = await start([sam.id, riley.id], 'Weekend rota');
    await send(avery, direct, 'Can you check the schedule for Résumé day?');
    await send(sam, direct, `Thanks <@${avery.id}>, the "QA form" is done: https://example.org/qa`);
    await send(riley, group, 'Schedule swap on Friday');
  });

  afterAll(async () => {
    await testApp?.close();
  });

  it('finds words and their starts, ignoring case and accents, newest first', async () => {
    expect(texts(await search(avery, { q: 'SCHED' }))).toEqual([
      'Schedule swap on Friday',
      'Can you check the schedule for Résumé day?',
    ]);
    expect(texts(await search(avery, { q: 'resume' }))).toEqual([
      'Can you check the schedule for Résumé day?',
    ]);
  });

  it('finds exact phrases, and mentions by name', async () => {
    expect((await search(sam, { q: '"qa form"' })).results).toHaveLength(1);
    expect((await search(sam, { q: '"form qa"' })).results).toEqual([]);
    const byName = await search(sam, { q: 'avery' });
    expect(byName.results).toHaveLength(1);
    expect(byName.people[avery.id]?.name).toBe('Avery Lin');
  });

  it('filters by who sent it, the chat and what it has', async () => {
    expect(texts(await search(avery, { q: 'schedule', fromUserId: riley.id }))).toEqual([
      'Schedule swap on Friday',
    ]);
    expect((await search(avery, { q: 'schedule', chatId: direct })).results).toHaveLength(1);
    expect((await search(avery, { has: 'link' })).results).toHaveLength(1);
    expect(await search(avery, { q: 'schedule', chatId: 'not-a-chat' })).toEqual(nothing);
  });

  it("filters by day, in the person's time zone", async () => {
    const today = todayIn(DEFAULT_TIME_ZONE);
    expect(
      (await search(avery, { q: 'schedule', date: { op: 'on', date: today } })).results,
    ).toHaveLength(2);
    expect(
      (await search(avery, { q: 'schedule', date: { op: 'before', date: today } })).results,
    ).toEqual([]);
    expect(
      (await search(avery, { q: 'schedule', date: { op: 'after', date: today } })).results,
    ).toEqual([]);
    const between = { op: 'between', from: today, to: today };
    expect((await search(avery, { q: 'schedule', date: between })).results).toHaveLength(2);
  });

  it('finds nothing without words or filters', async () => {
    expect(await search(avery, { q: '  ' })).toEqual(nothing);
    expect(await search(avery, {})).toEqual(nothing);
  });

  it('finds an edited message by its new words, and never a deleted one', async () => {
    const message = await send(avery, direct, 'Temporary pineapple note');
    expect((await search(sam, { q: 'pineapple' })).results).toHaveLength(1);
    await call(avery, 'PATCH', `/messages/${message.id}`, { text: 'Temporary mango note' });
    expect((await search(sam, { q: 'pineapple' })).results).toEqual([]);
    expect((await search(sam, { q: 'mango' })).results).toHaveLength(1);
    await call(avery, 'DELETE', `/messages/${message.id}`);
    expect((await search(sam, { q: 'mango' })).results).toEqual([]);
  });

  it('only searches chats the person is in now', async () => {
    // Riley was never in the direct chat.
    expect(texts(await search(riley, { q: 'schedule' }))).toEqual(['Schedule swap on Friday']);
    await call(riley, 'DELETE', `/chats/${group}/members/${riley.id}`);
    expect((await search(riley, { q: 'schedule' })).results).toEqual([]);
  });
});
