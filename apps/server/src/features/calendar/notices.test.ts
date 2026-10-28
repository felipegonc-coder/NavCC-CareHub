import { eventResponseSchema } from '@carehub/team-calendar-api';
import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bindMemoryNotices } from '../notices/testing';
import {
  createTestApp,
  createUser,
  hasDatabase,
  injectAs,
  type TestApp,
  type TestUser,
} from '../../testing';
import { NOTICE_TITLES } from './events/notices';
import { eventCards } from './events/service';

describe.skipIf(!hasDatabase)('calendar notices', () => {
  let test: TestApp;
  let memory: ReturnType<typeof bindMemoryNotices>;
  let ada: TestUser;
  let sam: TestUser;
  let cy: TestUser;

  beforeAll(async () => {
    test = await createTestApp();
    // After the app, so the notices Calendar sends land in memory.
    memory = bindMemoryNotices();
    ada = await createUser(test.db, { name: 'Ada Example' });
    sam = await createUser(test.db, { name: 'Sam Ortiz' });
    cy = await createUser(test.db, { name: 'Cy Sample' });
  });

  afterAll(async () => {
    memory?.unbind();
    await test?.close();
  });

  const send = (user: TestUser, method: InjectOptions['method'], url: string, payload?: object) =>
    injectAs(test.app, user, { method, url: `/api/calendar${url}`, payload });

  const chat = (user: TestUser) =>
    memory.store.records
      .filter((notice) => notice.userId === user.id)
      .sort((a, b) => a.position - b.position);

  /** Ada's Team huddle with Sam, at 10:00 UTC on Nov 10, 2026. */
  async function huddle() {
    const response = await send(ada, 'POST', '/events', {
      title: 'Team huddle',
      allDay: false,
      start: '2026-11-10T10:00:00.000Z',
      end: '2026-11-10T11:00:00.000Z',
      timeZone: 'UTC',
      people: [sam.id],
    });
    expect(response.statusCode, response.body).toBe(201);
    return eventResponseSchema.parse(response.json()).event;
  }

  const cardFor = async (user: TestUser, eventId: string) => {
    const reader = { userId: user.id, timeZone: 'UTC', use24h: false };
    const cards = await eventCards(test.db, reader, [{ eventId, occurrenceStart: null }]);
    return [...cards.values()][0];
  };

  it('sends the people on a meeting its invite, time change and cancel (CA-06)', async () => {
    const before = chat(sam).length;
    const event = await huddle();
    const later = { start: '2026-11-10T10:30:00.000Z', end: '2026-11-10T11:30:00.000Z' };
    expect((await send(ada, 'PATCH', `/events/${event.id}`, later)).statusCode).toBe(200);
    expect((await send(ada, 'DELETE', `/events/${event.id}`)).statusCode).toBe(204);

    const notices = chat(sam).slice(before);
    expect(notices.map((notice) => notice.title)).toEqual([
      NOTICE_TITLES.invited,
      NOTICE_TITLES.changed,
      NOTICE_TITLES.cancelled,
    ]);
    for (const notice of notices) {
      expect(notice).toMatchObject({ kind: 'alert', sender: 'Ada Example', actorUserId: ada.id });
      expect(notice.card).toMatchObject({ type: 'event', eventId: event.id });
    }
    expect(chat(ada)).toEqual([]);
  });

  it('tells the organizer each reply, with its note (CA-17)', async () => {
    const event = await huddle();
    const reply = { reply: 'maybe', note: 'Running late' };
    expect((await send(sam, 'PUT', `/events/${event.id}/reply`, reply)).statusCode).toBe(204);
    expect(chat(ada).at(-1)).toMatchObject({
      title: 'Answered Maybe to your meeting',
      text: 'Running late',
      sender: 'Sam Ortiz',
      actorUserId: sam.id,
    });
  });

  it('shows the event cards only to the people on the meeting', async () => {
    const event = await huddle();
    expect(await cardFor(sam, event.id)).toEqual({
      title: 'Team huddle',
      when: 'Tue, Nov 10 · 10:00 to 11:00 AM',
      href: `/calendar?event=${event.id}`,
    });
    expect(await cardFor(cy, event.id)).toEqual({ locked: true });
    expect((await send(ada, 'DELETE', `/events/${event.id}`)).statusCode).toBe(204);
    expect(await cardFor(sam, event.id)).toEqual({
      title: 'Team huddle',
      when: 'Cancelled · Tue, Nov 10 · 10:00 to 11:00 AM',
      href: '/calendar?date=2026-11-10',
    });
  });

  it("still saves the change when a notice can't be sent", async () => {
    memory.unbind();
    try {
      await huddle();
    } finally {
      memory = bindMemoryNotices();
    }
  });
});
