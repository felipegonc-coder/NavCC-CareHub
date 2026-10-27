import {
  editResponseSchema,
  eventResponseSchema,
  itemsResponseSchema,
} from '@carehub/team-calendar-api';
import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestApp,
  createUser,
  hasDatabase,
  injectAs,
  type TestApp,
  type TestUser,
} from '../../testing';

const weekly = {
  title: 'Weekly check-in',
  allDay: false,
  // Tuesdays 10:00 to 11:00 in Denver from Oct 20, 2026.
  start: '2026-10-20T16:00:00.000Z',
  end: '2026-10-20T17:00:00.000Z',
  repeat: { freq: 'weekly', interval: 1, byDay: [{ day: 'TU' }] },
};

describe.skipIf(!hasDatabase)('changing calendar events', () => {
  let test: TestApp;
  let ada: TestUser;
  let ben: TestUser;
  let cy: TestUser;

  beforeAll(async () => {
    test = await createTestApp();
    ada = await createUser(test.db, { name: 'Ada Example' });
    ben = await createUser(test.db, { name: 'Ben Sample' });
    cy = await createUser(test.db, { name: 'Cy Sample' });
  });

  afterAll(async () => {
    await test?.close();
  });

  const send = (user: TestUser, method: InjectOptions['method'], url: string, payload?: object) =>
    injectAs(test.app, user, { method, url: `/api/calendar${url}`, payload });

  async function meeting(payload: object = weekly) {
    const response = await send(ada, 'POST', '/events', { ...payload, people: [ben.id] });
    expect(response.statusCode, response.body).toBe(201);
    return eventResponseSchema.parse(response.json()).event;
  }

  async function startsOf(user: TestUser, eventId: string) {
    const response = await send(user, 'GET', '/items?from=2026-10-18&to=2026-11-15');
    const { items } = itemsResponseSchema.parse(response.json());
    return items.flatMap((item) =>
      item.source === 'event' && item.eventId === eventId ? [item.start] : [],
    );
  }

  it('moves one occurrence, and refuses a stale one', async () => {
    const event = await meeting();
    const response = await send(ada, 'PATCH', `/events/${event.id}`, {
      scope: 'one',
      occurrence: '2026-10-27T10:00',
      allDay: false,
      start: '2026-10-28T16:00:00.000Z',
      end: '2026-10-28T17:00:00.000Z',
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(editResponseSchema.parse(response.json()).split).toBeNull();
    expect(await startsOf(ben, event.id)).toEqual([
      '2026-10-20T16:00:00.000Z',
      '2026-10-28T16:00:00.000Z',
      '2026-11-03T17:00:00.000Z',
      '2026-11-10T17:00:00.000Z',
    ]);
    const stale = { scope: 'one', occurrence: '2026-10-29T10:00', title: 'Moved' };
    expect((await send(ada, 'PATCH', `/events/${event.id}`, stale)).statusCode).toBe(409);
  });

  it('splits the series for this and following', async () => {
    const event = await meeting();
    const response = await send(ada, 'PATCH', `/events/${event.id}`, {
      scope: 'following',
      occurrence: '2026-11-03T10:00',
      title: 'New check-in',
    });
    expect(response.statusCode, response.body).toBe(200);
    const { event: before, split } = editResponseSchema.parse(response.json());
    expect(before.title).toBe('Weekly check-in');
    expect(split).toMatchObject({ title: 'New check-in', start: '2026-11-03T17:00:00.000Z' });
    expect(split?.people.map((person) => person.id)).toEqual([ben.id]);
    expect(await startsOf(ben, event.id)).toHaveLength(2);
    expect(await startsOf(ben, split?.id ?? '')).toHaveLength(2);
  });

  it('lets only the organizer change or delete a meeting', async () => {
    const event = await meeting();
    for (const user of [ben, cy]) {
      expect((await send(user, 'PATCH', `/events/${event.id}`, { title: 'Mine' })).statusCode).toBe(
        403,
      );
      expect((await send(user, 'DELETE', `/events/${event.id}?scope=all`)).statusCode).toBe(403);
    }
  });

  it('deletes one occurrence, then the whole series', async () => {
    const event = await meeting();
    const one = await send(
      ada,
      'DELETE',
      `/events/${event.id}?scope=one&occurrence=2026-10-27T10:00`,
    );
    expect(one.statusCode, one.body).toBe(204);
    expect(await startsOf(ben, event.id)).not.toContain('2026-10-27T16:00:00.000Z');
    expect((await send(ada, 'DELETE', `/events/${event.id}`)).statusCode).toBe(400);
    expect((await send(ada, 'DELETE', `/events/${event.id}?scope=all`)).statusCode).toBe(204);
    expect((await send(ada, 'GET', `/events/${event.id}`)).statusCode).toBe(404);
    expect(await startsOf(ben, event.id)).toEqual([]);
  });

  it('keeps replies for the series and for one occurrence (CA-17, CA-22)', async () => {
    const event = await meeting();
    const url = `/events/${event.id}/reply`;
    const series = await send(ben, 'PUT', url, { reply: 'maybe', note: 'Running late' });
    expect(series.statusCode, series.body).toBe(204);
    const once = { reply: 'not-going', occurrence: '2026-10-27T10:00' };
    expect((await send(ben, 'PUT', url, once)).statusCode).toBe(204);

    const shown = eventResponseSchema.parse((await send(ada, 'GET', `/events/${event.id}`)).json());
    expect(shown.event.people).toMatchObject([
      { id: ben.id, reply: 'maybe', note: 'Running late' },
    ]);
    const response = await send(ben, 'GET', '/items?from=2026-10-25&to=2026-11-01');
    const item = itemsResponseSchema
      .parse(response.json())
      .items.find((each) => each.source === 'event' && each.eventId === event.id);
    expect(item).toMatchObject({ myReply: 'not-going' });

    const stale = { reply: 'going', occurrence: '2026-10-28T10:00' };
    expect((await send(ben, 'PUT', url, stale)).statusCode).toBe(409);
    expect((await send(ada, 'PUT', url, { reply: 'going' })).statusCode).toBe(403);
    expect((await send(cy, 'PUT', url, { reply: 'going' })).statusCode).toBe(403);
  });

  it('duplicates an event for the person who copies it (CA-20)', async () => {
    const event = await meeting();
    await send(ben, 'PUT', `/events/${event.id}/reply`, { reply: 'going' });
    const response = await send(ben, 'POST', '/duplicate', {
      eventId: event.id,
      occurrence: '2026-11-03T10:00',
    });
    expect(response.statusCode, response.body).toBe(201);
    const copy = eventResponseSchema.parse(response.json()).event;
    expect(copy).toMatchObject({
      title: 'Weekly check-in',
      start: '2026-11-03T17:00:00.000Z',
      organizer: { id: ben.id },
      people: [{ id: ada.id, reply: null }],
      canEdit: true,
    });
    const hidden = { eventId: event.id };
    expect((await send(cy, 'POST', '/duplicate', hidden)).statusCode).toBe(403);
  });
});
