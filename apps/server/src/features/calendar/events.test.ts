import {
  eventResponseSchema,
  itemsResponseSchema,
  upcomingResponseSchema,
} from '@carehub/team-calendar-api';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestApp,
  createUser,
  hasDatabase,
  injectAs,
  type TestApp,
  type TestUser,
} from '../../testing';

const denver = 'America/Denver';
const missing = '00000000-0000-4000-8000-000000000000';

describe.skipIf(!hasDatabase)('calendar events', () => {
  let test: TestApp;
  let ada: TestUser;
  let ben: TestUser;
  let cy: TestUser;

  beforeAll(async () => {
    test = await createTestApp();
    ada = await createUser(test.db, { name: 'Ada Example' });
    ben = await createUser(test.db, { name: 'Ben Sample', role: 'viewer' });
    cy = await createUser(test.db, { name: 'Cy Sample' });
  });

  afterAll(async () => {
    await test?.close();
  });

  const create = (user: TestUser, payload: Record<string, unknown>) =>
    injectAs(test.app, user, { method: 'POST', url: '/api/calendar/events', payload });

  async function created(user: TestUser, payload: Record<string, unknown>) {
    const response = await create(user, payload);
    expect(response.statusCode, response.body).toBe(201);
    return eventResponseSchema.parse(response.json()).event;
  }

  async function itemsFor(user: TestUser, from: string, to: string) {
    const url = `/api/calendar/items?from=${from}&to=${to}`;
    const response = await injectAs(test.app, user, { method: 'GET', url });
    expect(response.statusCode, response.body).toBe(200);
    return itemsResponseSchema.parse(response.json());
  }

  const getEvent = (user: TestUser, id: string) =>
    injectAs(test.app, user, { method: 'GET', url: `/api/calendar/events/${id}` });

  it('creates an event that its creator organizes, in their time zone', async () => {
    const event = await created(ada, {
      title: 'Care plan review',
      allDay: false,
      start: '2026-10-27T16:00:00.000Z',
      end: '2026-10-27T17:00:00.000Z',
      location: 'Room 2',
    });
    expect(event).toMatchObject({
      title: 'Care plan review',
      timeZone: denver,
      repeat: null,
      layerId: 'my-events',
      organizer: { id: ada.id, name: 'Ada Example' },
      people: [],
      canEdit: true,
      canReply: false,
    });
    const range = await itemsFor(ada, '2026-10-25', '2026-11-01');
    expect(range).toMatchObject({ timeZone: denver, truncated: false });
    expect(range.items.find((item) => item.id === event.id)).toMatchObject({
      start: '2026-10-27T16:00:00.000Z',
      location: 'Room 2',
      occurrence: null,
    });
  });

  it('keeps the local time of repeating events when daylight saving ends', async () => {
    const event = await created(ada, {
      title: 'Weekly huddle',
      allDay: false,
      start: '2026-10-27T15:00:00.000Z',
      end: '2026-10-27T15:30:00.000Z',
      repeat: { freq: 'weekly', interval: 1, byDay: [{ day: 'TU' }], count: 3 },
    });
    const { items } = await itemsFor(ada, '2026-10-25', '2026-11-29');
    const huddles = items.filter((item) => item.source === 'event' && item.eventId === event.id);
    expect(huddles.map((item) => [item.id, item.start])).toEqual([
      [`${event.id}:2026-10-27T09:00`, '2026-10-27T15:00:00.000Z'],
      [`${event.id}:2026-11-03T09:00`, '2026-11-03T16:00:00.000Z'],
      [`${event.id}:2026-11-10T09:00`, '2026-11-10T16:00:00.000Z'],
    ]);
  });

  it('shows meetings to the people invited, and to no one else', async () => {
    const event = await created(ada, {
      title: 'Family meeting',
      allDay: false,
      start: '2026-10-28T18:00:00.000Z',
      end: '2026-10-28T19:00:00.000Z',
      people: [ben.id, ada.id, ben.id],
    });
    expect(event.layerId).toBe('meetings');
    expect(event.people.map((person) => [person.id, person.reply])).toEqual([[ben.id, null]]);

    const { items } = await itemsFor(ben, '2026-10-28', '2026-10-30');
    expect(items.find((item) => item.id === event.id)).toMatchObject({
      canEdit: false,
      canReply: true,
      myReply: null,
      organizer: { id: ada.id },
    });
    expect((await getEvent(ben, event.id)).statusCode).toBe(200);

    const others = await itemsFor(cy, '2026-10-25', '2026-11-01');
    expect(others.items.some((item) => item.id === event.id)).toBe(false);
    expect((await getEvent(cy, event.id)).statusCode).toBe(403);
  });

  it('answers 404 for events that are not there', async () => {
    expect((await getEvent(ada, missing)).statusCode).toBe(404);
    expect((await getEvent(ada, 'not-an-id')).statusCode).toBe(404);
  });

  it('only invites members of the workspace', async () => {
    const outsider = await createUser(test.db, { role: null });
    const guest = await createUser(test.db, { kind: 'guest' });
    for (const person of [outsider.id, guest.id, missing]) {
      const response = await create(ada, {
        allDay: false,
        start: '2026-10-29T16:00:00.000Z',
        end: '2026-10-29T17:00:00.000Z',
        people: [person],
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: 'invalid' } });
    }
  });

  it('keeps all-day events on their dates for everyone invited', async () => {
    const event = await created(ada, {
      title: 'Respite day',
      allDay: true,
      start: '2026-11-05',
      end: '2026-11-06',
      people: [ben.id],
    });
    expect(event).toMatchObject({ start: '2026-11-05', end: '2026-11-06', timeZone: denver });
    for (const user of [ada, ben]) {
      const { items } = await itemsFor(user, '2026-11-05', '2026-11-06');
      expect(items.find((item) => item.id === event.id)).toMatchObject({
        allDay: true,
        start: '2026-11-05',
        end: '2026-11-06',
        timeZone: null,
      });
    }
  });

  it('lists what is next for Upcoming, soonest first', async () => {
    const dee = await createUser(test.db, { name: 'Dee Example' });
    const at = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
    const timed = (title: string, from: number, videoUrl: string | null = null) =>
      created(dee, { title, allDay: false, start: at(from), end: at(from + 30), videoUrl });
    const visit = await timed('Video visit', 60, 'https://zoom.us/j/123456789');
    await timed('Huddle', 5);
    await timed('Shift notes', 90);
    await timed('Next week', 7 * 24 * 60);
    const url = '/api/calendar/upcoming?limit=2';
    const response = await injectAs(test.app, dee, { method: 'GET', url });
    expect(response.statusCode, response.body).toBe(200);
    const { items } = upcomingResponseSchema.parse(response.json());
    expect(items.map((item) => item.title)).toEqual(['Huddle', 'Video visit']);
    expect(items[1]).toMatchObject({
      href: `/calendar?event=${visit.id}`,
      videoLink: { provider: 'zoom' },
    });
    const tooMany = { method: 'GET' as const, url: '/api/calendar/upcoming?limit=11' };
    expect((await injectAs(test.app, dee, tooMany)).statusCode).toBe(400);
  });

  it('refuses events that end before they start, and ranges over 42 days', async () => {
    const backwards = await create(ada, {
      allDay: false,
      start: '2026-10-29T17:00:00.000Z',
      end: '2026-10-29T16:00:00.000Z',
    });
    expect(backwards.statusCode).toBe(400);
    const url = '/api/calendar/items?from=2026-01-01&to=2026-03-01';
    expect((await injectAs(test.app, ada, { method: 'GET', url })).statusCode).toBe(400);
  });

  it('is only for signed-in members of the workspace', async () => {
    const url = '/api/calendar/items?from=2026-10-25&to=2026-11-01';
    expect((await test.app.inject({ method: 'GET', url })).statusCode).toBe(401);
    for (const options of [{ role: null }, { kind: 'guest' as const }]) {
      const person = await createUser(test.db, options);
      expect((await injectAs(test.app, person, { method: 'GET', url })).statusCode).toBe(403);
    }
  });
});
