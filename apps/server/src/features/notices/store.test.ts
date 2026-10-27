// The Postgres store behind sendNotice, in the app: one app for the file, new people per test.
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SeedContext } from '../../seed';
import { createTestApp, createUser, hasDatabase, type TestApp, type TestUser } from '../../testing';
import { users } from '../auth/schema';
import type { NoticeFilter } from './domain/filters';
import { noticeIdempotencyKeys, notices, noticeSettings } from './schema';
import { seed } from './seed';
import { sendNotice, type NoticeScope } from './service';
import { createNoticeStore, getNotice } from './store';
import type { NoticeCreatedEvent, SendNoticeInput } from './types';

describe.skipIf(!hasDatabase)('notices on Postgres', () => {
  let test: TestApp;
  const created: NoticeCreatedEvent[] = [];
  // Any ID will do until workspaces are on main.
  const workspaceId: string = randomUUID();

  beforeAll(async () => {
    test = await createTestApp();
    test.app.events.on('notices.notice.created', (event) => {
      created.push(event);
    });
  });

  afterAll(async () => {
    await test?.close();
  });

  const store = () => createNoticeStore(test.db);
  const person = (name?: string) => createUser(test.db, name === undefined ? {} : { name });
  const chatOf = (user: TestUser, inWorkspace: string = workspaceId): NoticeScope => ({
    workspaceId: inWorkspace,
    userId: user.id,
  });

  const notice = (user: TestUser, overrides: Partial<SendNoticeInput> = {}) =>
    sendNotice({
      workspaceId,
      userId: user.id,
      kind: 'alert',
      sender: 'Care Hub',
      title: 'Something needs your attention',
      ...overrides,
    });

  const list = (user: TestUser, filter?: NoticeFilter, inWorkspace?: string) =>
    store().list(chatOf(user, inWorkspace), { limit: 50, filter });
  const titles = async (user: TestUser, filter?: NoticeFilter) =>
    (await list(user, filter)).map((record) => record.title);

  const byName = <T extends { name: string }>(items: T[]) =>
    [...items].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  it("saves each notice to the person's own chat, newest first", async () => {
    const avery = await person('Avery Lin');
    const sam = await person('Sam Ortiz');
    const pageId = randomUUID();
    const otherWorkspaceId = randomUUID();
    const first = await notice(avery, { title: 'First' });
    await notice(sam, { title: 'For Sam' });
    await notice(avery, { title: 'In another workspace', workspaceId: otherWorkspaceId });
    const mention = await notice(avery, {
      kind: 'mention',
      sender: 'Sam Ortiz',
      actorUserId: sam.id,
      icon: '💬',
      title: 'Mentioned you in a comment',
      text: 'Can you check the follow-up dates?',
      card: { type: 'page', pageId },
      buttons: [
        { label: 'Open', href: `/p/${pageId}` },
        { label: 'Snooze', action: 'tests.snooze', choices: [{ label: '1 hour', value: '1h' }] },
      ],
    });

    expect(mention).toEqual({ noticeId: expect.any(String), grouped: false });
    const chat = await list(avery);
    expect(chat.map((record) => record.title)).toEqual(['Mentioned you in a comment', 'First']);
    expect(chat[0]).toMatchObject({
      id: mention.noticeId,
      workspaceId,
      userId: avery.id,
      kind: 'mention',
      sender: 'Sam Ortiz',
      actorUserId: sam.id,
      icon: '💬',
      text: 'Can you check the follow-up dates?',
      card: { type: 'page', pageId },
      buttons: [
        { label: 'Open', href: `/p/${pageId}` },
        { label: 'Snooze', action: 'tests.snooze', choices: [{ label: '1 hour', value: '1h' }] },
      ],
      groupKey: null,
      count: 1,
      readAt: null,
    });
    expect(chat[1]).toMatchObject({ id: first.noticeId, icon: null, text: null, card: null });
    expect(chat[1]?.position).toBeLessThan(chat[0]?.position ?? 0);
    expect(await store().countUnread(chatOf(avery))).toBe(2);
    expect(await titles(sam)).toEqual(['For Sam']);
    const elsewhere = await list(avery, 'all', otherWorkspaceId);
    expect(elsewhere.map((record) => record.title)).toEqual(['In another workspace']);

    await test.app.events.settled();
    const averys = created.filter(
      (event) => event.userId === avery.id && event.workspaceId === workspaceId,
    );
    expect(averys).toEqual([
      { workspaceId, userId: avery.id, noticeId: first.noticeId, kind: 'alert', grouped: false },
      {
        workspaceId,
        userId: avery.id,
        noticeId: mention.noticeId,
        kind: 'mention',
        grouped: false,
      },
    ]);
  });

  it('pages through the chat, older notices after each cursor', async () => {
    const riley = await person();
    for (const title of ['One', 'Two', 'Three']) await notice(riley, { title });
    const page = await store().list(chatOf(riley), { limit: 2 });
    expect(page.map((record) => record.title)).toEqual(['Three', 'Two']);
    const rest = await store().list(chatOf(riley), { limit: 2, before: page[1]?.position });
    expect(rest.map((record) => record.title)).toEqual(['One']);
  });

  it('shows each filter chip its kinds', async () => {
    const jordan = await person();
    for (const kind of ['mention', 'comment', 'reminder', 'access_request', 'alert'] as const) {
      await notice(jordan, { kind, title: kind });
    }
    expect(await titles(jordan, 'mentions')).toEqual(['mention']);
    expect(await titles(jordan, 'following')).toEqual(['comment']);
    expect(await titles(jordan, 'reminders')).toEqual(['reminder']);
    expect(await titles(jordan, 'requests')).toEqual(['access_request']);

    const [comment] = await list(jordan, 'following');
    await store().markRead(chatOf(jordan), { noticeIds: [comment?.id ?? ''] }, new Date());
    expect(await titles(jordan, 'unread')).toEqual([
      'alert',
      'access_request',
      'reminder',
      'mention',
    ]);
  });

  it('marks notices read up to one, one at a time, or all at once', async () => {
    const casey = await person();
    for (const title of ['One', 'Two', 'Three', 'Four']) await notice(casey, { title });
    const [four, , two] = await list(casey);
    const chat = chatOf(casey);
    const now = new Date();

    expect(await store().markRead(chat, { through: two?.position ?? 0 }, now)).toBe(2);
    expect(await store().markRead(chat, { noticeIds: [four?.id ?? ''] }, now)).toBe(1);
    expect(await store().markRead(chat, { noticeIds: [four?.id ?? ''] }, now)).toBe(0);
    expect(await store().countUnread(chat)).toBe(1);
    expect(await store().markRead(chat, { all: true }, now)).toBe(1);
    expect((await list(casey)).map((record) => record.readAt)).toEqual(Array(4).fill(now));
  });

  it("never marks another person's notices read", async () => {
    const owner = await person();
    const other = await person();
    const { noticeId } = await notice(owner);
    const now = new Date();
    expect(await store().markRead(chatOf(other), { noticeIds: [noticeId] }, now)).toBe(0);
    expect(await store().markRead(chatOf(other), { all: true }, now)).toBe(0);
    expect(await store().countUnread(chatOf(owner))).toBe(1);
  });

  it('adds one notice for concurrent sends with the same idempotency key', async () => {
    const avery = await person();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => notice(avery, { idempotencyKey: 'tests:once' })),
    );
    expect(new Set(results.map((result) => result.noticeId)).size).toBe(1);
    expect(results.filter((result) => result.duplicate)).toHaveLength(4);
    expect(await list(avery)).toHaveLength(1);
    await test.app.events.settled();
    expect(created.filter((event) => event.userId === avery.id)).toHaveLength(1);
  });

  it('groups concurrent sends with the same group key into one notice', async () => {
    const avery = await person();
    await Promise.all(
      Array.from({ length: 4 }, () => notice(avery, { kind: 'comment', groupKey: 'tests:page' })),
    );
    expect((await list(avery)).map((record) => record.count)).toEqual([4]);
    expect(await store().countUnread(chatOf(avery))).toBe(1);
  });

  it('groups only notices of one kind, and never mentions', async () => {
    const sam = await person();
    const groupKey = `comments:${randomUUID()}`;
    await notice(sam, { kind: 'comment', title: 'Comment', groupKey });
    await notice(sam, { kind: 'mention', title: 'Mention', groupKey });
    await notice(sam, { kind: 'mention', title: 'Mention', groupKey });
    await expect(notice(sam, { kind: 'comment', title: 'Comment', groupKey })).resolves.toEqual({
      noticeId: expect.any(String),
      grouped: true,
    });
    expect((await list(sam)).map(({ title, count }) => [title, count])).toEqual([
      ['Comment', 2],
      ['Mention', 1],
      ['Mention', 1],
    ]);
  });

  it('keeps up to 3 cards in order, and a grouped notice takes the new ones', async () => {
    const avery = await person();
    const [planId, formId, notesId] = [randomUUID(), randomUUID(), randomUUID()];
    const event = { type: 'event', eventId: 'evt_42', occurrenceStart: '2026-11-02' } as const;
    const groupKey = `automations:${randomUUID()}`;
    const cards = [
      { type: 'page', pageId: planId },
      event,
      { type: 'page', pageId: formId },
    ] as const;
    await notice(avery, { kind: 'automation', groupKey, cards });
    expect(await list(avery)).toMatchObject([
      { card: cards[0], extraCards: [event, { type: 'page', pageId: formId }] },
    ]);

    await notice(avery, { kind: 'automation', groupKey, card: { type: 'page', pageId: notesId } });
    expect(await list(avery)).toMatchObject([
      { count: 2, card: { type: 'page', pageId: notesId }, extraCards: [] },
    ]);
  });

  it('refuses more than 3 cards, and more cards without a first one', async () => {
    const avery = await person();
    const page = { type: 'page', pageId: randomUUID() } as const;
    const row = { workspaceId, userId: avery.id, sender: 'Care Hub', title: 'Cards' };
    const insert = (cards: Pick<typeof notices.$inferInsert, 'card' | 'extraCards'>) =>
      test.db.insert(notices).values({ ...row, kind: 'alert', ...cards });
    await expect(insert({ card: page, extraCards: [page, page, page] })).rejects.toThrow();
    await expect(insert({ extraCards: [page] })).rejects.toThrow();
    await expect(insert({ card: page, extraCards: [page, page] })).resolves.toBeDefined();
  });

  it("keeps each person's notice settings per workspace, and sends only what's on", async () => {
    const avery = await person();
    const otherWorkspaceId = randomUUID();
    expect(await store().getSettings(chatOf(avery))).toEqual({
      comments: true,
      edits: true,
      formResponses: true,
      automations: true,
    });
    const now = new Date();
    await store().changeSettings(chatOf(avery), { edits: false }, now);
    await expect(
      store().changeSettings(chatOf(avery), { automations: false }, now),
    ).resolves.toEqual({ comments: true, edits: false, formResponses: true, automations: false });
    expect(await store().getSettings(chatOf(avery, otherWorkspaceId))).toMatchObject({
      edits: true,
    });

    await expect(notice(avery, { kind: 'edit_summary', title: 'Edits' })).resolves.toMatchObject({
      turnedOff: true,
    });
    await notice(avery, { kind: 'comment', title: 'New comment' });
    await notice(avery, { kind: 'edit_summary', title: 'Edits', workspaceId: otherWorkspaceId });
    expect(await titles(avery)).toEqual(['New comment']);
  });

  it('gives one notice to features such as push, or null', async () => {
    const avery = await person();
    const pageId = randomUUID();
    const { noticeId } = await notice(avery, {
      kind: 'reminder',
      sender: 'Reminders',
      title: 'Reminder',
      text: 'Follow up with the Q4 coaching plan',
      card: { type: 'page', pageId },
      buttons: [{ label: 'Done', action: 'tests.done', value: 'r-1' }],
    });
    const [record] = await list(avery);
    expect(await getNotice(test.db, noticeId)).toStrictEqual({
      id: noticeId,
      workspaceId,
      userId: avery.id,
      kind: 'reminder',
      title: 'Reminder',
      text: 'Follow up with the Q4 coaching plan',
      senderName: 'Reminders',
      link: `/p/${pageId}`,
      createdAt: record?.createdAt,
      latestAt: record?.latestAt,
    });
    expect(await getNotice(test.db, randomUUID())).toBeNull();
    expect(await getNotice(test.db, 'not-an-id')).toBeNull();
  });

  it("goes with the person's account, and keeps the sender's name when the actor's goes", async () => {
    const avery = await person();
    const sam = await person('Sam Ortiz');
    const { noticeId } = await notice(avery, {
      kind: 'mention',
      sender: 'Sam Ortiz',
      actorUserId: sam.id,
      title: 'Mentioned you in a comment',
    });
    await notice(sam, { idempotencyKey: 'tests:sam' });

    await test.db.delete(users).where(eq(users.id, sam.id));
    expect(await store().get(noticeId)).toMatchObject({ sender: 'Sam Ortiz', actorUserId: null });
    expect(await list(sam)).toEqual([]);
    const keys = await test.db
      .select()
      .from(noticeIdempotencyKeys)
      .where(eq(noticeIdempotencyKeys.userId, sam.id));
    expect(keys).toEqual([]);

    await test.db.delete(users).where(eq(users.id, avery.id));
    expect(await store().get(noticeId)).toBeNull();
  });

  it('seeds four fictional notices for each person, and nothing more the second time', async () => {
    const seeded = {
      admin: await person(),
      editor: await person(),
      commenter: await person(),
      viewer: await person(),
    };
    const unused = async (): Promise<never> => {
      throw new Error('The notices seed adds no roles or people.');
    };
    const ctx: SeedContext = {
      db: test.db,
      workspaceId: randomUUID(),
      users: seeded,
      teamSpaceId: randomUUID(),
      log: test.app.log,
      createRole: unused,
      createPerson: unused,
    };
    await seed(ctx);
    await seed(ctx);
    for (const user of Object.values(seeded)) {
      const chat = chatOf(user, ctx.workspaceId);
      const records = await store().list(chat, { limit: 50 });
      expect(records.map((record) => record.title)).toEqual([
        'Reminder',
        'Mentioned you in a comment',
        'Your automation ran',
        'Welcome to your Care Hub chat',
      ]);
      expect(await store().countUnread(chat)).toBe(2);
    }
  });

  it('describes the tables exactly as the migrations made them', async () => {
    for (const table of [notices, noticeIdempotencyKeys, noticeSettings]) {
      const { name, columns } = getTableConfig(table);
      const { rows } = await test.db.execute<{ name: string; type: string; notNull: boolean }>(sql`
        SELECT attname AS name, format_type(atttypid, atttypmod) AS type, attnotnull AS "notNull"
        FROM pg_attribute
        WHERE attrelid = ${name}::regclass AND attnum > 0 AND NOT attisdropped`);
      const expected = columns.map((column) => ({
        name: column.name,
        // A bigserial column is a bigint with a sequence.
        type: column.getSQLType().replace('bigserial', 'bigint'),
        notNull: column.notNull,
      }));
      expect(byName(rows), name).toEqual(byName(expected));
    }
  });
});
