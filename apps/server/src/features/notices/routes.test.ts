// The notices API against Postgres: one app for the file, and a new person for each test.
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SeedContext } from '../../seed';
import {
  createTestApp,
  createUser,
  hasDatabase,
  injectAs,
  type TestApp,
  type TestUser,
} from '../../testing';
import { registerNoticeCardResolver, type EventCardResult } from './cards';
import { registerNoticeAction } from './domain/actions';
import { noticeIdempotencyKeys, notices } from './schema';
import { seed } from './seed';
import { sendNotice } from './service';
import type {
  NoticeActionContext,
  NoticeCard,
  NoticeCreatedEvent,
  NoticeListResponse,
  SendNoticeInput,
} from './types';

describe.skipIf(!hasDatabase)('notices API', () => {
  let test: TestApp;
  const created: NoticeCreatedEvent[] = [];

  beforeAll(async () => {
    test = await createTestApp();
    test.app.events.on('notices.notice.created', (event) => {
      created.push(event);
    });
  });

  afterAll(async () => {
    await test?.close();
  });

  const member = (options: Parameters<typeof createUser>[1] = {}) => createUser(test.db, options);

  const workspaceOf = (user: TestUser): string => {
    if (!user.workspaceId) throw new Error(`${user.name} isn't in the workspace.`);
    return user.workspaceId;
  };

  const notice = (user: TestUser, overrides: Partial<SendNoticeInput> = {}) =>
    sendNotice({
      workspaceId: workspaceOf(user),
      userId: user.id,
      kind: 'alert',
      sender: 'Care Hub',
      title: 'Something needs your attention',
      ...overrides,
    });

  const call = (user: TestUser, method: 'GET' | 'POST', url: string, payload?: object) =>
    injectAs(test.app, user, payload === undefined ? { method, url } : { method, url, payload });

  const chat = async (user: TestUser, query = ''): Promise<NoticeListResponse> => {
    const response = await call(user, 'GET', `/api/notices${query}`);
    expect(response.statusCode, response.body).toBe(200);
    return response.json<NoticeListResponse>();
  };

  const titles = (list: NoticeListResponse) => list.notices.map((item) => item.title);

  const byName = <T extends { name: string }>(items: T[]) =>
    [...items].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  it('needs a signed-in person in the workspace', async () => {
    expect((await test.app.inject({ method: 'GET', url: '/api/notices' })).statusCode).toBe(401);
    const outsider = await member({ role: null });
    expect((await call(outsider, 'GET', '/api/notices')).statusCode).toBe(403);
    expect((await call(outsider, 'GET', '/api/notices/unread')).statusCode).toBe(403);
  });

  it("lists the person's own chat, newest first, without titles or action names", async () => {
    const avery = await member({ name: 'Avery Lin' });
    const sam = await member({ name: 'Sam Ortiz' });
    await notice(avery, { title: 'First' });
    await notice(sam, { title: 'For Sam' });
    await notice(avery, {
      kind: 'mention',
      sender: 'Sam Ortiz',
      actorUserId: sam.id,
      title: 'Mentioned you in a comment',
      card: { type: 'page', pageId: randomUUID() },
      buttons: [
        { label: 'Open', href: '/home' },
        { label: 'Done', action: 'tests.done', value: 'r-secret' },
      ],
    });

    const list = await chat(avery);
    expect(titles(list)).toEqual(['Mentioned you in a comment', 'First']);
    expect(list.unread).toBe(2);
    expect(list.nextCursor).toBeNull();
    expect(list.notices[0]).toMatchObject({
      kind: 'mention',
      sender: 'Sam Ortiz',
      actorUserId: sam.id,
      buttons: [
        { type: 'link', label: 'Open', href: '/home' },
        { type: 'action', label: 'Done', choices: [] },
      ],
      count: 1,
      read: false,
    });
    // Page cards stay locked until core's page cards land: no ID, title or space.
    expect(list.notices[0]?.card).toEqual({ type: 'page', state: 'locked' });
    expect(JSON.stringify(list)).not.toContain('tests.done');
    expect(JSON.stringify(list)).not.toContain('r-secret');
  });

  it('pages through the chat and refuses bad queries', async () => {
    const riley = await member();
    for (const title of ['One', 'Two', 'Three']) await notice(riley, { title });

    const first = await chat(riley, '?limit=2');
    expect(titles(first)).toEqual(['Three', 'Two']);
    expect(first.nextCursor).toBe(first.notices[1]?.position);
    const rest = await chat(riley, `?limit=2&before=${first.nextCursor}`);
    expect(titles(rest)).toEqual(['One']);
    expect(rest.nextCursor).toBeNull();
    for (const query of ['?limit=0', '?limit=101', '?before=0', '?before=soon', '?filter=later']) {
      expect((await call(riley, 'GET', `/api/notices${query}`)).statusCode, query).toBe(400);
    }
  });

  it('shows each filter chip its kinds', async () => {
    const jordan = await member();
    for (const kind of ['mention', 'comment', 'reminder', 'access_request', 'alert'] as const) {
      await notice(jordan, { kind, title: kind });
    }
    expect(titles(await chat(jordan, '?filter=mentions'))).toEqual(['mention']);
    expect(titles(await chat(jordan, '?filter=following'))).toEqual(['comment']);
    expect(titles(await chat(jordan, '?filter=reminders'))).toEqual(['reminder']);
    expect(titles(await chat(jordan, '?filter=requests'))).toEqual(['access_request']);

    const [comment] = (await chat(jordan, '?filter=following')).notices;
    expect((await call(jordan, 'POST', `/api/notices/${comment?.id}/read`)).statusCode).toBe(200);
    expect(titles(await chat(jordan, '?filter=unread'))).toEqual([
      'alert',
      'access_request',
      'reminder',
      'mention',
    ]);
  });

  it('marks notices read up to one, one at a time, or all at once', async () => {
    const casey = await member();
    for (const title of ['One', 'Two', 'Three', 'Four']) await notice(casey, { title });
    const [four, , two] = (await chat(casey)).notices;

    let response = await call(casey, 'POST', '/api/notices/read', { through: two?.position });
    expect(response.json()).toEqual({ unread: 2 });
    response = await call(casey, 'POST', `/api/notices/${four?.id}/read`);
    expect(response.json()).toEqual({ unread: 1 });
    expect((await call(casey, 'GET', '/api/notices/unread')).json()).toEqual({ unread: 1 });
    response = await call(casey, 'POST', '/api/notices/read-all');
    expect(response.json()).toEqual({ unread: 0 });
    expect((await chat(casey)).notices.map((item) => item.read)).toEqual([true, true, true, true]);

    for (const body of [{ through: -1 }, { through: 'all' }, { through: 1, filter: 'all' }]) {
      const refused = await call(casey, 'POST', '/api/notices/read', body);
      expect(refused.statusCode, JSON.stringify(body)).toBe(400);
    }
  });

  it('keeps notices private to their owner, admins included', async () => {
    const owner = await member();
    const admin = await member({ role: 'admin', siteAdmin: true });
    const { noticeId } = await notice(owner, {
      buttons: [{ label: 'Done', action: 'tests.done' }],
    });

    expect((await call(admin, 'POST', `/api/notices/${noticeId}/read`)).statusCode).toBe(403);
    const click = await call(admin, 'POST', `/api/notices/${noticeId}/actions`, { button: 0 });
    expect(click.statusCode).toBe(403);
    expect(titles(await chat(admin))).toEqual([]);
    expect((await chat(owner)).unread).toBe(1);

    expect((await call(owner, 'POST', `/api/notices/${randomUUID()}/read`)).statusCode).toBe(404);
    expect((await call(owner, 'POST', '/api/notices/not-a-notice/read')).statusCode).toBe(400);
  });

  it('gives guests a chat of their own', async () => {
    const guest = await member({ kind: 'guest' });
    await notice(guest, { kind: 'shared', title: 'Shared a page with you' });
    expect(titles(await chat(guest))).toEqual(['Shared a page with you']);
  });

  it("drops notices for people who aren't in the workspace", async () => {
    const insider = await member();
    const outsider = await member({ role: null });
    const result = await notice({ ...outsider, workspaceId: workspaceOf(insider) });
    expect(result).toEqual({ noticeId: '', grouped: false, dropped: true });
    const rows = await test.db
      .select({ id: notices.id })
      .from(notices)
      .where(eq(notices.userId, outsider.id));
    expect(rows).toEqual([]);
  });

  it("runs a button's stored action and value, then marks the notice read", async () => {
    const calls: NoticeActionContext[] = [];
    registerNoticeAction('tests.snooze', async (context) => {
      calls.push(context);
      return { message: `Snoozed for ${context.value}` };
    });
    const avery = await member();
    const { noticeId } = await notice(avery, {
      kind: 'reminder',
      title: 'Reminder',
      buttons: [
        { label: 'Open', href: '/reminders' },
        {
          label: 'Snooze',
          action: 'tests.snooze',
          choices: [
            { label: '15 minutes', value: '15m' },
            { label: '1 hour', value: '1h' },
          ],
        },
        { label: 'Archive', action: 'tests.unknown' },
      ],
    });

    const response = await call(avery, 'POST', `/api/notices/${noticeId}/actions`, {
      button: 1,
      choice: 1,
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({ message: 'Snoozed for 1h', unread: 0 });
    expect(calls).toEqual([
      {
        noticeId,
        workspaceId: workspaceOf(avery),
        userId: avery.id,
        action: 'tests.snooze',
        value: '1h',
      },
    ]);

    for (const body of [
      { button: 0 },
      { button: 1 },
      { button: 1, choice: 2 },
      { button: 2 },
      { button: 3 },
      { button: 1, choice: 0, action: 'tests.snooze' },
    ]) {
      const refused = await call(avery, 'POST', `/api/notices/${noticeId}/actions`, body);
      expect(refused.statusCode, JSON.stringify(body)).toBe(400);
    }
    expect(calls).toHaveLength(1);
  });

  it('shows the event cards Calendar opens for the reader, and locks the rest', async () => {
    const asked: { userId: string; cards: unknown[] }[] = [];
    registerNoticeCardResolver('event', async (_db, userId, cards) => {
      asked.push({ userId, cards });
      return new Map<string, EventCardResult>([
        [
          'evt_open|2026-11-02',
          {
            title: 'Weekly stand-up',
            when: 'Mon, Nov 2 · 9:00 AM',
            href: '/calendar?event=evt_open&occurrence=2026-11-02',
          },
        ],
        ['evt_gone|', { deleted: true }],
        ['evt_private|', { locked: true }],
        ['evt_outside|', { title: 'Off-site', href: 'https://example.com/' }],
      ]);
    });
    try {
      const avery = await member();
      const cards: NoticeCard[] = [
        { type: 'event', eventId: 'evt_open', occurrenceStart: '2026-11-02' },
        { type: 'event', eventId: 'evt_gone' },
        { type: 'event', eventId: 'evt_private' },
        { type: 'event', eventId: 'evt_outside' },
        { type: 'event', eventId: 'evt_unknown' },
      ];
      for (const card of cards) await notice(avery, { kind: 'reminder', title: 'Reminder', card });

      const list = await chat(avery);
      expect(list.notices.map((item) => item.card)).toEqual([
        { type: 'event', state: 'locked' },
        { type: 'event', state: 'locked' },
        { type: 'event', state: 'locked' },
        { type: 'event', state: 'deleted' },
        {
          type: 'event',
          state: 'open',
          eventId: 'evt_open',
          occurrenceStart: '2026-11-02',
          href: '/calendar?event=evt_open&occurrence=2026-11-02',
          title: 'Weekly stand-up',
          when: 'Mon, Nov 2 · 9:00 AM',
        },
      ]);
      expect(asked).toEqual([
        {
          userId: avery.id,
          cards: [
            { eventId: 'evt_unknown', occurrenceStart: null },
            { eventId: 'evt_outside', occurrenceStart: null },
            { eventId: 'evt_private', occurrenceStart: null },
            { eventId: 'evt_gone', occurrenceStart: null },
            { eventId: 'evt_open', occurrenceStart: '2026-11-02' },
          ],
        },
      ]);

      registerNoticeCardResolver('event', async () => {
        throw new Error('Calendar is unavailable');
      });
      const locked = (await chat(avery)).notices.map((item) => item.card);
      expect(locked).toEqual(cards.map(() => ({ type: 'event', state: 'locked' })));
    } finally {
      registerNoticeCardResolver('event', null);
    }
  });

  it('adds one notice for concurrent sends with the same idempotency key', async () => {
    const avery = await member();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => notice(avery, { idempotencyKey: 'tests:once' })),
    );
    expect(new Set(results.map((result) => result.noticeId)).size).toBe(1);
    expect(results.filter((result) => result.duplicate)).toHaveLength(4);
    expect((await chat(avery)).notices).toHaveLength(1);
    await test.app.events.settled();
    expect(created.filter((event) => event.userId === avery.id)).toHaveLength(1);
  });

  it('groups concurrent sends with the same group key into one notice', async () => {
    const avery = await member();
    await Promise.all(
      Array.from({ length: 4 }, () => notice(avery, { kind: 'comment', groupKey: 'tests:page' })),
    );
    const list = await chat(avery);
    expect(list.notices.map((item) => item.count)).toEqual([4]);
    expect(list.unread).toBe(1);
  });

  it('seeds four fictional notices for each person, and nothing more the second time', async () => {
    const users = {
      admin: await member({ role: 'admin' }),
      editor: await member(),
      commenter: await member({ role: 'commenter' }),
      viewer: await member({ role: 'viewer' }),
    };
    const unused = async (): Promise<never> => {
      throw new Error('The notices seed adds no roles or people.');
    };
    const ctx: SeedContext = {
      db: test.db,
      workspaceId: workspaceOf(users.admin),
      users,
      teamSpaceId: randomUUID(),
      log: test.app.log,
      createRole: unused,
      createPerson: unused,
    };
    await seed(ctx);
    await seed(ctx);
    for (const person of Object.values(users)) {
      const list = await chat(person);
      expect(titles(list)).toEqual([
        'Reminder',
        'Mentioned you in a comment',
        'Your automation ran',
        'Welcome to your Care Hub chat',
      ]);
      expect(list.unread).toBe(2);
    }
  });

  it('describes the tables exactly as the migrations made them', async () => {
    for (const table of [notices, noticeIdempotencyKeys]) {
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
