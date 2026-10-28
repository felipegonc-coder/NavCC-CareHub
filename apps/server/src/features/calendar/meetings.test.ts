import { eventResponseSchema } from '@carehub/team-calendar-api';
import type { InjectOptions } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestApp,
  createUser,
  hasDatabase,
  injectAs,
  type TestApp,
  type TestUser,
} from '../../testing';
import { lookupMeetingEvent } from './events/service';
import { calEventPeople } from './schema';

/** Tuesdays 10:00 to 11:00 in Denver (the people's zone here) from Oct 20, 2026. */
const weekly = {
  title: 'Team huddle',
  allDay: false,
  start: '2026-10-20T16:00:00.000Z',
  end: '2026-10-20T17:00:00.000Z',
  repeat: { freq: 'weekly', interval: 1, byDay: [{ day: 'TU' }] },
};

/** "Today" for these tests, so the year meeting notes look at stays put. */
const now = new Date('2026-10-28T15:00:00.000Z');

describe.skipIf(!hasDatabase)('the meeting notes lookup', () => {
  let test: TestApp;
  let ada: TestUser;
  let ben: TestUser;

  beforeAll(async () => {
    test = await createTestApp();
    ada = await createUser(test.db, { name: 'Ada Example' });
    ben = await createUser(test.db, { name: 'Ben Sample' });
  });

  afterAll(async () => {
    await test?.close();
  });

  const send = (user: TestUser, method: InjectOptions['method'], url: string, payload?: object) =>
    injectAs(test.app, user, { method, url: `/api/calendar${url}`, payload });

  async function meeting(payload: object) {
    const response = await send(ada, 'POST', '/events', payload);
    expect(response.statusCode, response.body).toBe(201);
    return eventResponseSchema.parse(response.json()).event;
  }

  const lookup = (eventId: string, occurrence?: string, workspaceId = ada.workspaceId ?? '') =>
    lookupMeetingEvent(test.db, { workspaceId, eventId, occurrence }, now);

  it('gives an occurrence as it is now, with the people invited who are still members', async () => {
    const event = await meeting({ ...weekly, people: [ben.id] });
    // Invited while they were members: one is a guest now, the other has left the workspace.
    const guest = await createUser(test.db, { kind: 'guest' });
    const left = await createUser(test.db, { role: null });
    await test.db
      .insert(calEventPeople)
      .values([guest, left].map((user) => ({ eventId: event.id, userId: user.id })));

    expect(await lookup(event.id, '2026-10-27T10:00')).toEqual({
      eventId: event.id,
      occurrence: '2026-10-27T10:00',
      title: 'Team huddle',
      allDay: false,
      start: '2026-10-27T16:00:00.000Z',
      timeZone: ada.timeZone,
      organizerId: ada.id,
      memberIds: [ben.id],
    });

    const moved = await send(ada, 'PATCH', `/events/${event.id}`, {
      scope: 'one',
      occurrence: '2026-11-03T10:00',
      title: 'Huddle, late',
      allDay: false,
      start: '2026-11-03T21:00:00.000Z',
      end: '2026-11-03T22:00:00.000Z',
    });
    expect(moved.statusCode, moved.body).toBe(200);
    expect(await lookup(event.id, '2026-11-03T10:00')).toMatchObject({
      occurrence: '2026-11-03T10:00',
      title: 'Huddle, late',
      start: '2026-11-03T21:00:00.000Z',
    });
  });

  it('is null without the key, in another workspace, for ids not ours and once deleted', async () => {
    const event = await meeting(weekly);
    expect(await lookup(event.id)).toBeNull();
    expect(await lookup(event.id, '2026-10-28T10:00')).toBeNull();
    expect(await lookup(event.id, '2026-10-27T10:00', randomUUID())).toBeNull();
    expect(await lookup('synced:example:1', '2026-10-27T10:00')).toBeNull();
    expect(await lookup(event.id, '2026-10-27T10:00')).not.toBeNull();

    const deleted = await send(ada, 'DELETE', `/events/${event.id}?scope=all`);
    expect(deleted.statusCode, deleted.body).toBe(204);
    expect(await lookup(event.id, '2026-10-27T10:00')).toBeNull();
  });
});
