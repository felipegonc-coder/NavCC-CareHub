import { editResponseSchema, eventResponseSchema } from '@carehub/team-calendar-api';
import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEventReminder } from '../reminders';
import { bindMemoryReminders } from '../reminders/testing';
import {
  createTestApp,
  createUser,
  hasDatabase,
  injectAs,
  type TestApp,
  type TestUser,
} from '../../testing';
import { lookupStart, lookupTitles, onReminderError } from './events/reminders';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const utc = 'UTC';

describe.skipIf(!hasDatabase)('calendar reminders', () => {
  let test: TestApp;
  let memory: ReturnType<typeof bindMemoryReminders>;
  let ada: TestUser;
  let ben: TestUser;

  beforeAll(async () => {
    test = await createTestApp();
    // After the app, so these tests read the reminders Calendar makes from memory.
    memory = bindMemoryReminders();
    ada = await createUser(test.db, { name: 'Ada Example' });
    ben = await createUser(test.db, { name: 'Ben Sample' });
    const settings = await send(ada, 'PATCH', '/settings', { defaultReminder: 10 });
    expect(settings.statusCode, settings.body).toBe(200);
  });

  afterAll(async () => {
    memory?.unbind();
    await test?.close();
  });

  const send = (user: TestUser, method: InjectOptions['method'], url: string, payload?: object) =>
    injectAs(test.app, user, { method, url: `/api/calendar${url}`, payload });

  /** On the minute, as Calendar keeps times. Events here are in UTC, which has no DST. */
  function inHours(hours: number) {
    const time = new Date(Date.now() + hours * 60 * MINUTE);
    time.setUTCSeconds(0, 0);
    return time;
  }

  async function created(payload: object) {
    const response = await send(ada, 'POST', '/events', payload);
    expect(response.statusCode, response.body).toBe(201);
    return eventResponseSchema.parse(response.json()).event;
  }

  const remindersOf = (eventId: string) =>
    memory.store.reminders.filter(
      (reminder) => reminder.target.type === 'event' && reminder.target.eventId === eventId,
    );

  it('gives new timed events the default reminder, which moves and goes with them', async () => {
    const start = inHours(2);
    const end = inHours(3);
    const visit = await created({ title: 'Home visit', allDay: false, start, end, timeZone: utc });
    const [reminder] = remindersOf(visit.id);
    expect(reminder).toMatchObject({ userId: ada.id, minutesBefore: 10, status: 'pending' });
    expect(reminder?.dueAt.getTime()).toBe(start.getTime() - 10 * MINUTE);

    const later = { start: inHours(5).toISOString(), end: inHours(6).toISOString() };
    expect((await send(ada, 'PATCH', `/events/${visit.id}`, later)).statusCode).toBe(200);
    expect(remindersOf(visit.id)[0]?.dueAt.getTime()).toBe(Date.parse(later.start) - 10 * MINUTE);

    expect((await send(ada, 'DELETE', `/events/${visit.id}`)).statusCode).toBe(204);
    expect(remindersOf(visit.id).map((each) => each.status)).toEqual(['deleted']);
  });

  it('gives all-day and repeating events no default reminder yet', async () => {
    const day = (hours: number) => inHours(hours).toISOString().slice(0, 10);
    const allDay = await created({ allDay: true, start: day(48), end: day(72) });
    const daily = await created({
      allDay: false,
      start: inHours(2),
      end: inHours(3),
      timeZone: utc,
      repeat: { freq: 'daily', interval: 1 },
    });
    expect([...remindersOf(allDay.id), ...remindersOf(daily.id)]).toEqual([]);
  });

  it('tells Remind me when an event starts, only for the people who see it', async () => {
    const start = inHours(4);
    const end = inHours(5);
    const huddle = await created({ allDay: false, start, end, timeZone: utc, people: [ben.id] });
    const target = { eventId: huddle.id };
    expect(await lookupStart(test.db, ada.id, target)).toEqual({ start });
    expect(await lookupStart(test.db, ben.id, target)).toEqual({ start });
    const cy = await createUser(test.db, { name: 'Cy Sample' });
    expect(await lookupStart(test.db, cy.id, target)).toBeNull();
    const missing = { eventId: '00000000-0000-4000-8000-000000000000' };
    expect(await lookupStart(test.db, ada.id, missing)).toBeNull();
  });

  /** An occurrence's key: its start on the UTC wall clock, to the minute. */
  const keyOf = (time: Date) => time.toISOString().slice(0, 16);
  const dueBefore = (time: Date) => new Date(time.getTime() - 15 * MINUTE).toISOString();

  /** Someone's own reminder, 15 minutes before, as Remind me in the event panel makes it. */
  async function remind(user: TestUser, eventId: string, start: Date, occurrenceStart?: string) {
    const made = await createEventReminder(test.db, {
      workspaceId: user.workspaceId ?? '',
      userId: user.id,
      eventId,
      ...(occurrenceStart === undefined ? {} : { occurrenceStart }),
      start: { start },
      minutesBefore: 15,
      timeZone: utc,
      use24h: false,
    });
    expect(made).not.toBeNull();
  }

  /** The pending reminders on an event: whose, which occurrence and when they're due. */
  const pendingOn = (eventId: string) =>
    remindersOf(eventId)
      .filter((reminder) => reminder.status === 'pending')
      .map(({ userId, target, dueAt }) => ({
        userId,
        key: target.type === 'event' ? target.occurrenceStart : undefined,
        dueAt: dueAt.toISOString(),
      }));

  async function daily(title: string, first: Date, people: string[] = []) {
    const end = new Date(first.getTime() + 30 * MINUTE);
    const repeat = { freq: 'daily', interval: 1 };
    return created({ title, allDay: false, start: first, end, timeZone: utc, repeat, people });
  }

  it('moves reminders with All events and into the new series of This and following', async () => {
    const first = inHours(24);
    const at = (n: number, shift = 0) => new Date(first.getTime() + n * DAY + shift);
    const huddle = await daily('Daily huddle', first, [ben.id]);
    await remind(ben, huddle.id, at(1), keyOf(at(1)));
    await remind(ada, huddle.id, at(3), keyOf(at(3)));

    // All events an hour later: each reminder follows its occurrence to its new key and time.
    const later = {
      start: at(0, HOUR).toISOString(),
      end: at(0, HOUR + 30 * MINUTE).toISOString(),
    };
    const all = { scope: 'all', occurrence: keyOf(first), allDay: false, ...later };
    expect((await send(ada, 'PATCH', `/events/${huddle.id}`, all)).statusCode).toBe(200);
    const bens = { userId: ben.id, key: keyOf(at(1, HOUR)), dueAt: dueBefore(at(1, HOUR)) };
    const adas = { userId: ada.id, key: keyOf(at(3, HOUR)), dueAt: dueBefore(at(3, HOUR)) };
    expect(pendingOn(huddle.id)).toEqual([bens, adas]);

    // This and following from the third day: the fourth day's reminder goes to the new series.
    const following = { scope: 'following', occurrence: keyOf(at(2, HOUR)), title: 'Late huddle' };
    const response = await send(ada, 'PATCH', `/events/${huddle.id}`, following);
    expect(response.statusCode, response.body).toBe(200);
    const { split } = editResponseSchema.parse(response.json());
    expect(pendingOn(huddle.id)).toEqual([bens]);
    expect(pendingOn(split?.id ?? '')).toEqual([adas]);
  });

  it('deletes the reminders on the occurrences a delete takes, and keeps the rest', async () => {
    const first = inHours(30);
    const day = (n: number) => new Date(first.getTime() + n * DAY);
    const standup = await daily('Standup', first);
    for (const n of [1, 2, 4]) await remind(ada, standup.id, day(n), keyOf(day(n)));
    const remove = (scope: string, n: number) =>
      send(ada, 'DELETE', `/events/${standup.id}?scope=${scope}&occurrence=${keyOf(day(n))}`);

    expect((await remove('one', 2)).statusCode).toBe(204);
    expect(pendingOn(standup.id).map(({ key }) => key)).toEqual([keyOf(day(1)), keyOf(day(4))]);
    expect((await remove('following', 3)).statusCode).toBe(204);
    expect(pendingOn(standup.id).map(({ key }) => key)).toEqual([keyOf(day(1))]);
  });

  it('deletes the reminders of people taken off a meeting', async () => {
    const start = inHours(6);
    const review = await created({
      title: 'Case review',
      allDay: false,
      start,
      end: inHours(7),
      timeZone: utc,
      people: [ben.id],
    });
    await remind(ben, review.id, start);
    expect(pendingOn(review.id).map(({ userId }) => userId)).toEqual([ada.id, ben.id]);
    expect((await send(ada, 'PATCH', `/events/${review.id}`, { people: [] })).statusCode).toBe(200);
    expect(pendingOn(review.id).map(({ userId }) => userId)).toEqual([ada.id]);
  });

  it('gives the Reminders list the titles of the events each person sees', async () => {
    const plan = await created({
      title: 'Care plan review',
      allDay: false,
      start: inHours(8),
      end: inHours(9),
      timeZone: utc,
      people: [ben.id],
    });
    const untitled = await created({ allDay: false, start: inHours(10), end: inHours(11) });
    const ids = [plan.id, untitled.id, 'synced:google:abc'];
    expect(await lookupTitles(test.db, ada.id, ids)).toEqual(
      new Map([
        [plan.id, 'Care plan review'],
        [untitled.id, '(No title)'],
      ]),
    );
    expect(await lookupTitles(test.db, ben.id, ids)).toEqual(
      new Map([[plan.id, 'Care plan review']]),
    );
    expect((await send(ada, 'DELETE', `/events/${plan.id}`)).statusCode).toBe(204);
    expect(await lookupTitles(test.db, ben.id, ids)).toEqual(new Map());
  });

  it("saves events even while reminders aren't running, and logs each miss", async () => {
    const errors: unknown[] = [];
    onReminderError((error) => errors.push(error));
    memory.unbind();
    try {
      const start = inHours(2);
      const visit = await created({ allDay: false, start, end: inHours(3), timeZone: utc });
      const later = { start: inHours(5).toISOString(), end: inHours(6).toISOString() };
      expect((await send(ada, 'PATCH', `/events/${visit.id}`, later)).statusCode).toBe(200);
      expect((await send(ada, 'DELETE', `/events/${visit.id}`)).statusCode).toBe(204);
      expect((await send(ada, 'GET', `/events/${visit.id}`)).statusCode).toBe(404);
    } finally {
      memory = bindMemoryReminders();
    }
    // Adding the default reminder, moving it and deleting it each failed on their own.
    expect(errors).toHaveLength(3);
    expect(String(errors[0])).toContain('Reminders are not running');
  });
});
