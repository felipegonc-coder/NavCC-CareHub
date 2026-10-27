import { randomUUID } from 'node:crypto';
import type {
  ChatListResponse,
  ChatResponse,
  HistoryResponse,
  MessageResponse,
  NewChatResponse,
  PeopleListResponse,
  UnreadResponse,
} from '@carehub/team-chat';
import { and, eq } from 'drizzle-orm';
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
import { workspaceMembers } from '../workspaces';
import type { MessageCreatedEvent } from './events';
import { msgMembers, msgMessages } from './schema';

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

describe.skipIf(!hasDatabase)('/api/messages: chats and messages', () => {
  let testApp: TestApp;
  let app: FastifyInstance;
  let avery: TestUser;
  let sam: TestUser;
  let riley: TestUser;
  /** Admin of the workspace, in none of the chats below. */
  let jordan: TestUser;
  let morgan: TestUser;
  /** Outside the workspace. */
  let casey: TestUser;
  const announced: MessageCreatedEvent[] = [];

  beforeAll(async () => {
    testApp = await createTestApp();
    app = testApp.app;
    const { db } = testApp;
    avery = await createUser(db, { name: 'Avery Lin' });
    sam = await createUser(db, { name: 'Sam Ortiz' });
    riley = await createUser(db, { name: 'Riley Chen' });
    jordan = await createUser(db, { name: 'Jordan Patel', role: 'admin' });
    morgan = await createUser(db, { name: 'Morgan Lee', kind: 'guest' });
    casey = await createUser(db, { name: 'Casey Nguyen', role: null });
    app.events.on('messages.message.created', (event) => {
      announced.push(event);
    });
  });

  afterAll(async () => {
    await testApp?.close();
  });

  const call = (user: { id: string }, method: Method, url: string, payload?: object) =>
    injectAs(app, user, { method, url: `/api/messages${url}`, payload });

  async function startChat(user: TestUser, userIds: string[], extra: object = {}) {
    const response = await call(user, 'POST', '/chats', { userIds, ...extra });
    return { status: response.statusCode, body: response.json<NewChatResponse>() };
  }

  async function send(user: TestUser, chatId: string, text: string, clientId = randomUUID()) {
    const response = await call(user, 'POST', `/chats/${chatId}/messages`, { clientId, text });
    return { status: response.statusCode, body: response.json<MessageResponse>() };
  }

  const directChat = async (user: TestUser, other: TestUser) =>
    (await startChat(user, [other.id])).body.chatId;

  it('opens one direct chat per pair, whoever starts it', async () => {
    const first = await startChat(avery, [sam.id]);
    expect(first.status).toBe(201);
    expect(first.body.existing).toBe(false);
    expect(await startChat(sam, [avery.id])).toEqual({
      status: 200,
      body: { chatId: first.body.chatId, existing: true },
    });
    // Both at once still make one chat.
    const both = await Promise.all([startChat(avery, [riley.id]), startChat(riley, [avery.id])]);
    expect(new Set(both.map(({ body }) => body.chatId)).size).toBe(1);
    expect(both.map(({ status }) => status).sort()).toEqual([200, 201]);
  });

  it('lists the chat for both people, with its latest message and their names', async () => {
    const chatId = await directChat(avery, sam);
    const sent = await send(avery, chatId, 'Morning, Sam');
    expect(sent.status).toBe(201);
    const { message } = sent.body;
    expect(message).toMatchObject({
      chatId,
      kind: 'message',
      senderId: avery.id,
      text: 'Morning, Sam',
      editedAt: null,
      deletedAt: null,
    });
    expect(sent.body.people[avery.id]).toEqual({ name: 'Avery Lin' });

    const list = (await call(sam, 'GET', '/chats')).json<ChatListResponse>();
    const chat = list.chats.find(({ id }) => id === chatId);
    expect(chat).toMatchObject({
      type: 'direct',
      name: null,
      lastSeq: message.seq,
      lastReadSeq: 0,
      unread: 1,
      mentions: 0,
      muted: false,
    });
    expect(chat?.members.map(({ userId }) => userId).sort()).toEqual([avery.id, sam.id].sort());
    expect(chat?.lastMessage).toMatchObject({ id: message.id, clientId: null });
    expect(list.people[avery.id]).toEqual({ name: 'Avery Lin' });

    // The sender has read their own message, and sees its clientId.
    const own = (await call(avery, 'GET', `/chats/${chatId}`)).json<ChatResponse>();
    expect(own.chat).toMatchObject({ lastReadSeq: message.seq, unread: 0 });
    expect(own.chat.lastMessage?.clientId).toBe(message.clientId);
    expect(own.people[sam.id]).toEqual({ name: 'Sam Ortiz' });
  });

  it('pages history: the latest first, older with before, newer with after (MS-11)', async () => {
    const chatId = await directChat(avery, riley);
    const seqs: number[] = [];
    for (const n of [1, 2, 3, 4, 5]) {
      seqs.push((await send(avery, chatId, `Note ${n}`)).body.message.seq);
    }
    const page = async (query: string) =>
      (await call(riley, 'GET', `/chats/${chatId}/messages?${query}`)).json<HistoryResponse>();
    const texts = (history: HistoryResponse) => history.messages.map(({ text }) => text);

    const latest = await page('limit=2');
    expect(texts(latest)).toEqual(['Note 4', 'Note 5']);
    expect(latest.hasMore).toBe(true);
    expect(latest.people[avery.id]).toEqual({ name: 'Avery Lin' });
    const older = await page(`limit=2&before=${seqs[3]}`);
    expect(texts(older)).toEqual(['Note 2', 'Note 3']);
    expect(older.hasMore).toBe(true);
    const oldest = await page(`limit=2&before=${seqs[1]}`);
    expect(texts(oldest)).toEqual(['Note 1']);
    expect(oldest.hasMore).toBe(false);
    const newer = await page(`after=${seqs[2]}`);
    expect(texts(newer)).toEqual(['Note 4', 'Note 5']);
    expect(newer.hasMore).toBe(false);

    for (const query of ['before=3&after=1', 'limit=51', 'before=0']) {
      const response = await call(riley, 'GET', `/chats/${chatId}/messages?${query}`);
      expect(response.statusCode).toBe(400);
    }
  });

  it('answers a resend (same clientId) with the first message, announced once (MS-08)', async () => {
    const chatId = await directChat(avery, sam);
    const clientId = randomUUID();
    const first = await send(avery, chatId, 'On my way', clientId);
    const again = await send(avery, chatId, 'On my way', clientId);
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.body.message).toEqual(first.body.message);

    await app.events.settled();
    expect(announced.filter(({ messageId }) => messageId === first.body.message.id)).toEqual([
      {
        workspaceId: avery.workspaceId,
        chatId,
        messageId: first.body.message.id,
        senderId: avery.id,
        recipientIds: [sam.id],
      },
    ]);

    // A clientId belongs to one message, in one chat.
    expect((await send(avery, await directChat(avery, riley), 'On my way', clientId)).status).toBe(
      409,
    );
  });

  it('checks the 4,000-character limit and empty messages on the server too (MS-14)', async () => {
    const chatId = await directChat(avery, sam);
    expect((await send(avery, chatId, 'a'.repeat(4001))).status).toBe(400);
    expect((await send(avery, chatId, ' \n\n ')).status).toBe(400);
    expect((await send(avery, chatId, 'a'.repeat(4000))).status).toBe(201);
    const response = await call(avery, 'POST', `/chats/${chatId}/messages`, { text: 'Hello' });
    expect(response.statusCode).toBe(400);
  });

  it('shows a chat only to the people in it, admins included (MS-10)', async () => {
    const chatId = await directChat(avery, sam);
    const { message } = (await send(avery, chatId, 'Just between us')).body;
    for (const outsider of [riley, jordan]) {
      expect((await call(outsider, 'GET', `/chats/${chatId}`)).statusCode).toBe(403);
      expect((await call(outsider, 'GET', `/chats/${chatId}/messages`)).statusCode).toBe(403);
      const hello = { clientId: randomUUID(), text: 'Hello' };
      expect((await call(outsider, 'POST', `/chats/${chatId}/messages`, hello)).statusCode).toBe(
        403,
      );
      const edit = { text: 'Changed' };
      expect((await call(outsider, 'PATCH', `/messages/${message.id}`, edit)).statusCode).toBe(403);
      const list = (await call(outsider, 'GET', '/chats')).json<ChatListResponse>();
      expect(list.chats.map(({ id }) => id)).not.toContain(chatId);
    }
    expect((await call(avery, 'GET', `/chats/${randomUUID()}`)).statusCode).toBe(404);
    expect((await call(avery, 'GET', '/chats/not-a-chat')).statusCode).toBe(404);
    expect((await call(avery, 'DELETE', `/messages/${randomUUID()}`)).statusCode).toBe(404);
  });

  it('lets only the sender edit or delete a message, and deleting erases it (MS-05)', async () => {
    const chatId = await directChat(avery, sam);
    const { message } = (await send(avery, chatId, `Swap shifts on Friday, <@${sam.id}>?`)).body;
    expect(message.mentions).toEqual([sam.id]);
    const url = `/messages/${message.id}`;
    expect((await call(sam, 'PATCH', url, { text: 'Changed' })).statusCode).toBe(403);
    expect((await call(sam, 'DELETE', url)).statusCode).toBe(403);

    const edited = await call(avery, 'PATCH', url, { text: 'Swap shifts on Saturday?' });
    expect(edited.statusCode).toBe(200);
    const after = edited.json<MessageResponse>().message;
    expect(after).toMatchObject({ id: message.id, text: 'Swap shifts on Saturday?', mentions: [] });
    expect(after.editedAt).not.toBeNull();

    expect((await call(avery, 'DELETE', url)).statusCode).toBe(204);
    expect((await call(avery, 'DELETE', url)).statusCode).toBe(204);
    expect((await call(avery, 'PATCH', url, { text: 'Back again' })).statusCode).toBe(409);
    const [row] = await testApp.db.select().from(msgMessages).where(eq(msgMessages.id, message.id));
    expect(row).toMatchObject({ text: '', mentions: [], pageIds: [] });
    expect(row?.deletedAt).toBeInstanceOf(Date);
    const history = (await call(sam, 'GET', `/chats/${chatId}/messages`)).json<HistoryResponse>();
    const shown = history.messages.find(({ id }) => id === message.id);
    expect(shown).toMatchObject({ text: '', deletedAt: expect.any(String) });
  });

  it('starts groups with a "started" line; the same people reopen it unless startNew', async () => {
    const first = await startChat(avery, [sam.id, riley.id], { name: 'Weekend rota' });
    expect(first.status).toBe(201);
    const { chatId } = first.body;
    const { chat, people } = (await call(sam, 'GET', `/chats/${chatId}`)).json<ChatResponse>();
    expect(chat).toMatchObject({
      type: 'group',
      name: 'Weekend rota',
      startedBy: avery.id,
      lastSeq: 1,
      lastReadSeq: 0,
    });
    expect(chat.members).toHaveLength(3);
    expect(chat.members.filter((member) => member.canRemoveOthers)).toEqual([
      expect.objectContaining({ userId: avery.id }),
    ]);
    expect(chat.lastMessage).toMatchObject({
      seq: 1,
      kind: 'system',
      senderId: null,
      system: { kind: 'started', actorId: avery.id },
    });
    expect(people[riley.id]).toEqual({ name: 'Riley Chen' });
    const starter = (await call(avery, 'GET', `/chats/${chatId}`)).json<ChatResponse>();
    expect(starter.chat.lastReadSeq).toBe(1);

    // "Open existing chat", whoever picks the same people.
    expect(await startChat(sam, [avery.id, riley.id])).toEqual({
      status: 200,
      body: { chatId, existing: true },
    });
    const fresh = await startChat(sam, [avery.id, riley.id], { startNew: true });
    expect(fresh.status).toBe(201);
    expect(fresh.body.chatId).not.toBe(chatId);
    expect((await startChat(avery, [sam.id, riley.id], { name: 'x'.repeat(101) })).status).toBe(
      400,
    );
  });

  it('counts unread messages and @mentions for the list and the badge (MS-06)', async () => {
    const badge = async (user: TestUser) =>
      (await call(user, 'GET', '/unread')).json<UnreadResponse>().count;
    const before = await badge(sam);
    const { chatId } = (await startChat(avery, [sam.id, riley.id], { startNew: true })).body;
    await send(avery, chatId, 'The rota draft is up');
    await send(avery, chatId, `<@${sam.id}> can you check Tuesday?`);
    await send(riley, chatId, 'Tuesday works for me');
    const unread = (await call(sam, 'GET', '/chats?unread=true')).json<ChatListResponse>();
    expect(unread.chats.find(({ id }) => id === chatId)).toMatchObject({ unread: 3, mentions: 1 });
    expect(unread.chats.filter((chat) => chat.unread === 0)).toEqual([]);
    expect(await badge(sam)).toBe(before + 3);
    const latest = (await call(sam, 'GET', '/chats?limit=1')).json<ChatListResponse>();
    expect(latest.chats.map(({ id }) => id)).toEqual([chatId]);

    // Muted: only the @mention counts.
    await testApp.db
      .update(msgMembers)
      .set({ muted: true })
      .where(and(eq(msgMembers.chatId, chatId), eq(msgMembers.userId, sam.id)));
    expect(await badge(sam)).toBe(before + 1);
    const home = (await call(sam, 'GET', '/chats?unread=true')).json<ChatListResponse>();
    expect(home.chats.find(({ id }) => id === chatId)).toMatchObject({ muted: true, mentions: 1 });
    await testApp.db
      .update(msgMembers)
      .set({ lastReadSeq: 4 })
      .where(and(eq(msgMembers.chatId, chatId), eq(msgMembers.userId, sam.id)));
    const after = (await call(sam, 'GET', '/chats?unread=true')).json<ChatListResponse>();
    expect(after.chats.map(({ id }) => id)).not.toContain(chatId);
  });

  it('lists the people you can message: members, not guests, outsiders or yourself', async () => {
    const answer = await call(avery, 'GET', '/people');
    expect(answer.statusCode).toBe(200);
    const { people } = answer.json<PeopleListResponse>();
    const ids = people.map(({ id }) => id);
    expect(ids).toEqual(expect.arrayContaining([sam.id, riley.id, jordan.id]));
    for (const id of [avery.id, morgan.id, casey.id]) expect(ids).not.toContain(id);
    expect(people.find(({ id }) => id === sam.id)).toMatchObject({ name: 'Sam Ortiz' });
    for (const user of [morgan, casey]) {
      expect((await call(user, 'GET', '/people')).statusCode).toBe(403);
    }
  });

  it("keeps guests and outsiders out, and they can't be messaged (RP-D2)", async () => {
    for (const user of [morgan, casey]) {
      expect((await call(user, 'GET', '/chats')).statusCode).toBe(403);
      expect((await startChat(user, [avery.id])).status).toBe(403);
    }
    for (const userIds of [[morgan.id], [casey.id], [sam.id, morgan.id], [randomUUID()], []]) {
      expect((await startChat(avery, userIds)).status).toBe(400);
    }
    expect((await startChat(avery, [avery.id])).status).toBe(400);
  });

  // Last: it removes Riley from the workspace.
  it('marks people removed from the workspace; their direct chats take no new messages', async () => {
    const chatId = await directChat(avery, riley);
    await testApp.db
      .update(workspaceMembers)
      .set({ removedAt: new Date() })
      .where(eq(workspaceMembers.userId, riley.id));
    const list = (await call(avery, 'GET', '/chats')).json<ChatListResponse>();
    expect(list.chats.map(({ id }) => id)).toContain(chatId);
    expect(list.viewerId).toBe(avery.id);
    expect(list.people[riley.id]).toEqual({ name: 'Riley Chen', removed: true });
    const { people } = (await call(avery, 'GET', '/people')).json<PeopleListResponse>();
    expect(people.map(({ id }) => id)).not.toContain(riley.id);
    expect((await send(avery, chatId, 'Are you there?')).status).toBe(409);
    expect((await call(avery, 'GET', `/chats/${chatId}/messages`)).statusCode).toBe(200);
  });
});
