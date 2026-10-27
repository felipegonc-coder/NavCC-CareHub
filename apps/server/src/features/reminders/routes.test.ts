import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestApp,
  createUser,
  hasDatabase,
  injectAs,
  type TestApp,
  type TestUser,
} from '../../testing';
import { drainJobsForTest } from '../jobs/testing';
import { bindMemoryNotices } from '../notices/testing';
import remindersRoutes, { STAND_IN_WORKSPACE_ID } from './routes';
import { createEventReminder, deleteEventReminders, syncEventReminders } from './service';
import { postgresReminderStore } from './store';

const PAGE = { type: 'page', pageId: 'c0ffee00-1111-4222-8333-444455556666' } as const;
const hoursFromNow = (hours: number) => new Date(Date.now() + hours * 3_600_000);
type View = { id: string; dueAt: string; status: string };

describe.skipIf(!hasDatabase)('reminders on Postgres', () => {
  let test: TestApp;
  let avery: TestUser;
  let sam: TestUser;
  let notices: ReturnType<typeof bindMemoryNotices>;

  beforeAll(async () => {
    test = await createTestApp({
      routes: async (app) => {
        await app.register(remindersRoutes, { prefix: '/api/reminders' });
      },
    });
    notices = bindMemoryNotices();
    avery = await createUser(test.db, { name: 'Avery Lin', email: 'avery.lin@example.test' });
    sam = await createUser(test.db, { name: 'Sam Ortiz', email: 'sam.ortiz@example.test' });
  });
  afterAll(async () => {
    notices?.unbind();
    await test?.close();
  });

  const call = (
    user: TestUser,
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    payload?: object,
  ) => injectAs(test.app, user, { method, url, ...(payload ? { payload } : {}) });
  const list = async (user: TestUser) =>
    (await call(user, 'GET', '/api/reminders')).json() as { pending: View[]; sent: View[] };
  async function create(user: TestUser, body: object): Promise<View> {
    const response = await call(user, 'POST', '/api/reminders', body);
    expect(response.statusCode).toBe(201);
    return response.json().reminder;
  }
  const runJobsAt = (iso: string) => drainJobsForTest({ now: new Date(Date.parse(iso) + 1_000) });
  const noticeFor = (id: string) =>
    notices.store.records.find((record) => record.groupKey === `reminders:${id}`);

  it('sets a page reminder, lists it and sends it at its time (HR-07)', async () => {
    const note = 'Check the Bluebird Bakery order';
    const reminder = await create(avery, { target: PAGE, at: hoursFromNow(1).toISOString(), note });
    expect(reminder).toMatchObject({ target: PAGE, minutesBefore: null, note, status: 'pending' });
    expect((await list(avery)).pending.map((r) => r.id)).toEqual([reminder.id]);
    await runJobsAt(reminder.dueAt);
    expect(noticeFor(reminder.id)).toMatchObject({
      workspaceId: avery.workspaceId,
      userId: avery.id,
      title: 'Reminder',
      text: note,
      card: PAGE,
    });
    expect((await list(avery)).sent).toMatchObject([{ id: reminder.id, status: 'sent' }]);
  });

  it('refuses another person’s requests (HR-12)', async () => {
    const reminder = await create(avery, { target: PAGE, at: hoursFromNow(2).toISOString() });
    const url = `/api/reminders/${reminder.id}`;
    const refused = await call(sam, 'PATCH', url, { note: 'Mine now' });
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({
      error: { code: 'forbidden', message: "You don't have access to this." },
    });
    expect((await call(sam, 'DELETE', url)).statusCode).toBe(403);
    expect(await list(sam)).toEqual({ pending: [], sent: [] });
    expect((await call(avery, 'DELETE', url)).statusCode).toBe(204);
    expect((await call(avery, 'DELETE', url)).statusCode).toBe(404);
    expect((await call(avery, 'PATCH', '/api/reminders/nope', { note: 'x' })).statusCode).toBe(404);
  });

  it('changes a pending reminder, but not one already sent', async () => {
    const reminder = await create(avery, { target: PAGE, at: hoursFromNow(3).toISOString() });
    const url = `/api/reminders/${reminder.id}`;
    const at = hoursFromNow(4).toISOString();
    const changed = await call(avery, 'PATCH', url, { at, note: 'Call Northwind Tiles' });
    expect(changed.json()).toMatchObject({ reminder: { dueAt: at, note: 'Call Northwind Tiles' } });
    await runJobsAt(at);
    expect(noticeFor(reminder.id)).toMatchObject({ text: 'Call Northwind Tiles' });
    const again = await call(avery, 'PATCH', url, { note: 'Too late' });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.message).toBe(
      'This reminder was already sent. Set a new one instead.',
    );
  });

  it('says what is wrong with a request', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const late = await call(avery, 'POST', '/api/reminders', { target: PAGE, at: past });
    expect(late.statusCode).toBe(400);
    expect(late.json().error).toMatchObject({
      code: 'invalid',
      message: 'That time has already passed.',
    });
    const at = hoursFromNow(1).toISOString();
    const long = await call(avery, 'POST', '/api/reminders', {
      target: PAGE,
      at,
      note: 'x'.repeat(281),
    });
    expect(long.json().error).toMatchObject({
      code: 'invalid',
      message: 'Notes can be up to 280 characters.',
    });
    const event = { target: { type: 'event', eventId: 'evt_1' }, minutesBefore: 10 };
    expect((await call(avery, 'POST', '/api/reminders', event)).statusCode).toBe(403);
  });

  it('keeps Calendar’s event reminders in step (HR-08)', async () => {
    const [five, six] = [5, 6].map((hours) => ({ start: hoursFromNow(hours) }));
    const occurrenceStart = '2026-11-02T09:00';
    const input = {
      workspaceId: STAND_IN_WORKSPACE_ID,
      eventId: 'evt_pg',
      occurrenceStart,
      start: five!,
      minutesBefore: 10,
      timeZone: 'America/Denver',
      use24h: false,
    };
    const mine = await createEventReminder(test.db, { ...input, userId: avery.id });
    await createEventReminder(test.db, { ...input, userId: sam.id });
    const moved = { eventId: 'evt_pg', occurrenceStart, start: six! };
    expect(await syncEventReminders(test.db, moved)).toBe(2);
    const left = await postgresReminderStore.get(test.db, mine?.reminderId ?? '');
    expect(left).toMatchObject({ status: 'pending', minutesBefore: 10 });
    expect(left?.target).toEqual({ type: 'event', eventId: 'evt_pg', occurrenceStart });
    expect(left?.dueAt).toEqual(new Date(six!.start.getTime() - 10 * 60_000));
    expect(await deleteEventReminders(test.db, { eventId: 'evt_pg', occurrenceStart })).toBe(2);
    const gone = await postgresReminderStore.get(test.db, mine?.reminderId ?? '');
    expect(gone?.status).toBe('deleted');
  });

  it('keeps each person to the limit, even with inserts at the same time', async () => {
    const riley = await createUser(test.db, {
      name: 'Riley Chen',
      email: 'riley.chen@example.test',
    });
    const reminder = {
      workspaceId: STAND_IN_WORKSPACE_ID,
      userId: riley.id,
      target: PAGE,
      minutesBefore: null,
      dueAt: hoursFromNow(1),
      note: '',
      timeZone: 'America/Denver',
      use24h: false,
    };
    const insert = () =>
      test.db.transaction((tx) => postgresReminderStore.insert(tx, reminder, 2, new Date()));
    const saved = await Promise.all([insert(), insert(), insert()]);
    expect(saved.filter((one) => one !== null)).toHaveLength(2);
  });
});
