import { randomUUID } from 'node:crypto';
import type {
  ChatListResponse,
  ChatResponse,
  HistoryResponse,
  MessageJson,
  MessageResponse,
  NewChatResponse,
  ReadResponse,
  UnreadResponse,
} from '@carehub/team-chat';
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

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

describe.skipIf(!hasDatabase)('/api/messages: read markers, mute and group changes', () => {
  let testApp: TestApp;
  let app: FastifyInstance;
  let avery: TestUser;
  let sam: TestUser;
  let riley: TestUser;
  let jordan: TestUser;
  let morgan: TestUser;

  beforeAll(async () => {
    testApp = await createTestApp();
    app = testApp.app;
    const { db } = testApp;
    avery = await createUser(db, { name: 'Avery Lin' });
    sam = await createUser(db, { name: 'Sam Ortiz' });
    riley = await createUser(db, { name: 'Riley Chen' });
    jordan = await createUser(db, { name: 'Jordan Patel' });
    morgan = await createUser(db, { name: 'Morgan Lee', kind: 'guest' });
  });

  afterAll(async () => {
    await testApp?.close();
  });

  const call = (user: { id: string }, method: Method, url: string, payload?: object) =>
    injectAs(app, user, { method, url: `/api/messages${url}`, payload });

  async function startChat(user: TestUser, userIds: string[], extra: object = {}) {
    return (await call(user, 'POST', '/chats', { userIds, ...extra })).json<NewChatResponse>()
      .chatId;
  }

  async function send(user: TestUser, chatId: string, text: string) {
    const response = await call(user, 'POST', `/chats/${chatId}/messages`, {
      clientId: randomUUID(),
      text,
    });
    return response.json<MessageResponse>().message;
  }

  const getChat = async (user: TestUser, chatId: string) =>
    (await call(user, 'GET', `/chats/${chatId}`)).json<ChatResponse>().chat;

  async function systemLines(user: TestUser, chatId: string) {
    const history = await call(user, 'GET', `/chats/${chatId}/messages`);
    return history
      .json<HistoryResponse>()
      .messages.filter((message) => message.kind === 'system')
      .map((message) => message.system);
  }

  it('moves read markers forward only, up to the latest message (MS-11)', async () => {
    const chatId = await startChat(avery, [sam.id]);
    const sent: MessageJson[] = [];
    for (const text of ['One', 'Two', 'Three']) sent.push(await send(avery, chatId, text));
    const read = async (seq: number) =>
      (await call(sam, 'POST', `/chats/${chatId}/read`, { seq })).json<ReadResponse>();

    expect(await read(sent[1]?.seq ?? 0)).toEqual({
      lastReadSeq: sent[1]?.seq,
      unread: 1,
      mentions: 0,
    });
    expect((await read(sent[0]?.seq ?? 0)).lastReadSeq).toBe(sent[1]?.seq);
    expect(await read(9999)).toEqual({ lastReadSeq: sent[2]?.seq, unread: 0, mentions: 0 });
    expect((await call(sam, 'POST', `/chats/${chatId}/read`, { seq: -1 })).statusCode).toBe(400);
    expect((await call(riley, 'POST', `/chats/${chatId}/read`, { seq: 1 })).statusCode).toBe(403);
  });

  it('marks a chat unread from the newest message by someone else', async () => {
    const chatId = await startChat(avery, [sam.id]);
    const theirs = await send(avery, chatId, 'Did the delivery come?');
    await send(sam, chatId, 'Yes, at 10');
    const marked = await call(sam, 'POST', `/chats/${chatId}/unread`);
    expect(marked.json<ReadResponse>()).toEqual({
      lastReadSeq: theirs.seq - 1,
      unread: 1,
      mentions: 0,
    });
    // Nothing from anyone else in a new chat: nothing changes.
    const quiet = await startChat(riley, [jordan.id]);
    const own = await send(riley, quiet, 'Hello');
    const unchanged = await call(riley, 'POST', `/chats/${quiet}/unread`);
    expect(unchanged.json<ReadResponse>()).toEqual({
      lastReadSeq: own.seq,
      unread: 0,
      mentions: 0,
    });
  });

  it('mutes a chat for one person: only their @mentions count then (MS-06)', async () => {
    const chatId = await startChat(riley, [avery.id]);
    const badge = async () => (await call(avery, 'GET', '/unread')).json<UnreadResponse>().count;
    const before = await badge();
    const muted = await call(avery, 'PATCH', `/chats/${chatId}`, { muted: true });
    expect(muted.json<ChatResponse>().chat.muted).toBe(true);
    expect((await getChat(riley, chatId)).muted).toBe(false);
    await send(riley, chatId, 'Quiet one');
    await send(riley, chatId, `<@${avery.id}> but this one counts`);
    expect(await badge()).toBe(before + 1);
    await call(avery, 'PATCH', `/chats/${chatId}`, { muted: false });
    expect(await badge()).toBe(before + 2);
    expect((await call(avery, 'PATCH', `/chats/${chatId}`, {})).statusCode).toBe(400);
  });

  it('renames groups with a "renamed" line; direct chats keep their names', async () => {
    const chatId = await startChat(avery, [sam.id, riley.id]);
    const rename = (user: TestUser, name: string | null) =>
      call(user, 'PATCH', `/chats/${chatId}`, { name });
    expect((await rename(sam, 'Night shift')).json<ChatResponse>().chat.name).toBe('Night shift');
    expect((await rename(sam, ' Night shift ')).statusCode).toBe(200);
    expect((await rename(riley, '   ')).json<ChatResponse>().chat.name).toBeNull();
    expect((await rename(riley, 'x'.repeat(101))).statusCode).toBe(400);
    expect(await systemLines(avery, chatId)).toEqual([
      { kind: 'started', actorId: avery.id, name: null },
      { kind: 'renamed', actorId: sam.id, name: 'Night shift' },
      { kind: 'renamed', actorId: riley.id, name: null },
    ]);
    const direct = await startChat(avery, [jordan.id]);
    expect((await call(avery, 'PATCH', `/chats/${direct}`, { name: 'Us' })).statusCode).toBe(400);
  });

  it('adds people to groups: they see earlier messages, and "Open existing chat" finds the new set', async () => {
    const chatId = await startChat(avery, [sam.id, riley.id], { startNew: true });
    await send(avery, chatId, 'Before Jordan joined');
    const added = await call(sam, 'POST', `/chats/${chatId}/members`, {
      userIds: [jordan.id, riley.id],
    });
    expect(added.statusCode).toBe(200);
    expect(added.json<ChatResponse>().chat.members.map(({ userId }) => userId)).toContain(
      jordan.id,
    );
    const forJordan = await getChat(jordan, chatId);
    expect(forJordan).toMatchObject({ unread: 0, lastReadSeq: forJordan.lastSeq });
    const history = await call(jordan, 'GET', `/chats/${chatId}/messages`);
    expect(history.json<HistoryResponse>().messages.map(({ text }) => text)).toContain(
      'Before Jordan joined',
    );
    expect((await systemLines(avery, chatId)).at(-1)).toEqual({
      kind: 'added',
      actorId: sam.id,
      userIds: [jordan.id],
    });

    // Asked again: nothing changes.
    await call(sam, 'POST', `/chats/${chatId}/members`, { userIds: [jordan.id] });
    expect(await systemLines(avery, chatId)).toHaveLength(2);
    const again = await call(avery, 'POST', '/chats', {
      userIds: [sam.id, riley.id, jordan.id],
    });
    expect(again.json<NewChatResponse>()).toEqual({ chatId, existing: true });

    const guest = await call(sam, 'POST', `/chats/${chatId}/members`, { userIds: [morgan.id] });
    expect(guest.statusCode).toBe(400);
    const direct = await startChat(avery, [sam.id]);
    const toDirect = await call(avery, 'POST', `/chats/${direct}/members`, {
      userIds: [riley.id],
    });
    expect(toDirect.statusCode).toBe(400);
  });

  it('lets only the starter remove people, and hands over when the starter leaves', async () => {
    const chatId = await startChat(avery, [sam.id, riley.id, jordan.id], { startNew: true });
    const remove = (user: TestUser, person: TestUser) =>
      call(user, 'DELETE', `/chats/${chatId}/members/${person.id}`);
    expect((await remove(sam, riley)).statusCode).toBe(403);
    const removed = await remove(avery, riley);
    expect(removed.statusCode).toBe(200);
    expect(removed.json<ChatResponse>().chat.members).toHaveLength(3);
    expect((await call(riley, 'GET', `/chats/${chatId}`)).statusCode).toBe(403);
    const list = (await call(riley, 'GET', '/chats')).json<ChatListResponse>();
    expect(list.chats.map(({ id }) => id)).not.toContain(chatId);
    expect((await remove(avery, riley)).statusCode).toBe(200);

    expect((await remove(avery, avery)).statusCode).toBe(204);
    expect((await call(avery, 'GET', `/chats/${chatId}`)).statusCode).toBe(403);
    const chat = await getChat(sam, chatId);
    expect(chat.members.map(({ userId }) => userId).sort()).toEqual([sam.id, jordan.id].sort());
    const remover = chat.members.filter((member) => member.canRemoveOthers);
    expect(remover).toHaveLength(1);
    expect((await systemLines(sam, chatId)).slice(1)).toEqual([
      { kind: 'removed', actorId: avery.id, userId: riley.id },
      { kind: 'left', userId: avery.id },
      { kind: 'tookOver', userId: remover[0]?.userId },
    ]);

    const direct = await startChat(avery, [sam.id]);
    const leaveDirect = await call(avery, 'DELETE', `/chats/${direct}/members/${avery.id}`);
    expect(leaveDirect.statusCode).toBe(400);
  });
});
