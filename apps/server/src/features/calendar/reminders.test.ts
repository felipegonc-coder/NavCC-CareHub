import { eventResponseSchema } from '@carehub/team-calendar-api';
import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bindMemoryReminders } from '../reminders/testing';
import {
  createTestApp,
  createUser,
  hasDatabase,
  injectAs,
  type TestApp,
  type TestUser,
} from '../../testing';
import { lookupStart, onReminderError } from './events/reminders';

const MINUTE = 60_000;
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
