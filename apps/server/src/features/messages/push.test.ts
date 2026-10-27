import { randomUUID } from 'node:crypto';
import type { HistoryResponse, MessageResponse, NewChatResponse } from '@carehub/team-chat';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestApp,
  createUser,
  hasDatabase,
  injectAs,
  type TestApp,
  type TestUser,
} from '../../testing';
import { getMessageForPush } from './push';
import { msgMembers } from './schema';

describe.skipIf(!hasDatabase)('getMessageForPush', () => {
  let testApp: TestApp;
  let avery: TestUser;
  let sam: TestUser;
  let riley: TestUser;
  let direct: string;
  let group: string;

  const call = (user: TestUser, method: 'GET' | 'POST' | 'DELETE', url: string, payload?: object) =>
    injectAs(testApp.app, user, { method, url: `/api/messages${url}`, payload });

  async function send(user: TestUser, chatId: string, text: string) {
    const response = await call(user, 'POST', `/chats/${chatId}/messages`, {
      clientId: randomUUID(),
      text,
    });
    return response.json<MessageResponse>().message;
  }

  beforeAll(async () => {
    testApp = await createTestApp();
    const { db } = testApp;
    avery = await createUser(db, { name: 'Avery Lin' });
    sam = await createUser(db, { name: 'Sam Ortiz' });
    riley = await createUser(db, { name: 'Riley Chen' });
    const start = async (userIds: string[]) =>
      (await call(avery, 'POST', '/chats', { userIds })).json<NewChatResponse>().chatId;
    direct = await start([sam.id]);
    group = await start([sam.id, riley.id]);
  });

  afterAll(async () => {
    await testApp?.close();
  });

  it('describes a direct message for the other person, on one line', async () => {
    const message = await send(avery, direct, 'Can you cover\n\nthe   late shift?');
    expect(await getMessageForPush(testApp.db, message.id, sam.id)).toEqual({
      workspaceId: avery.workspaceId,
      chatId: direct,
      messageId: message.id,
      chatType: 'direct',
      chatName: 'Avery Lin',
      senderId: avery.id,
      senderName: 'Avery Lin',
      text: 'Can you cover the late shift?',
      mentionsUser: false,
      muted: false,
    });
  });

  it('names an unnamed group after the other members and shows mentions as names', async () => {
    const message = await send(avery, group, `<@${sam.id}> the rota is up`);
    const forSam = await getMessageForPush(testApp.db, message.id, sam.id);
    expect(forSam).toMatchObject({
      chatType: 'group',
      text: '@Sam Ortiz the rota is up',
      mentionsUser: true,
    });
    expect(['Avery Lin and Riley Chen', 'Riley Chen and Avery Lin']).toContain(forSam?.chatName);
    const forRiley = await getMessageForPush(testApp.db, message.id, riley.id);
    expect(forRiley).toMatchObject({ mentionsUser: false });
    expect(['Avery Lin and Sam Ortiz', 'Sam Ortiz and Avery Lin']).toContain(forRiley?.chatName);
  });

  it('cuts long text to 100 characters, ending in "…"', async () => {
    const message = await send(avery, direct, 'a'.repeat(150));
    const push = await getMessageForPush(testApp.db, message.id, sam.id);
    expect(push?.text).toBe(`${'a'.repeat(99)}…`);
  });

  it('says when the person muted the chat', async () => {
    await testApp.db
      .update(msgMembers)
      .set({ muted: true })
      .where(and(eq(msgMembers.chatId, direct), eq(msgMembers.userId, sam.id)));
    const message = await send(avery, direct, 'Muted, but still here');
    expect(await getMessageForPush(testApp.db, message.id, sam.id)).toMatchObject({
      muted: true,
    });
  });

  it('is null for the sender, outsiders, system lines, deleted messages and unknown IDs', async () => {
    const message = await send(avery, direct, 'See you at 9');
    expect(await getMessageForPush(testApp.db, message.id, avery.id)).toBeNull();
    expect(await getMessageForPush(testApp.db, message.id, riley.id)).toBeNull();

    const history = (await call(sam, 'GET', `/chats/${group}/messages`)).json<HistoryResponse>();
    const started = history.messages.find(({ kind }) => kind === 'system');
    expect(started).toBeDefined();
    expect(await getMessageForPush(testApp.db, started?.id ?? '', sam.id)).toBeNull();

    expect((await call(avery, 'DELETE', `/messages/${message.id}`)).statusCode).toBe(204);
    expect(await getMessageForPush(testApp.db, message.id, sam.id)).toBeNull();
    expect(await getMessageForPush(testApp.db, randomUUID(), sam.id)).toBeNull();
    expect(await getMessageForPush(testApp.db, 'not-a-message', sam.id)).toBeNull();
    expect(await getMessageForPush(testApp.db, message.id, 'not-a-person')).toBeNull();
  });
});
