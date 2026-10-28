import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestApp,
  createUser,
  hasDatabase,
  injectAs,
  type CreateUserOptions,
  type TestApp,
  type TestUser,
} from '../../testing';
import { addMember } from '../workspaces';
import { notesTitle } from './domain/notes';
import meetingsRoutes from './routes';
import { NOTES_PARENT_TITLE, registerMeetingEventLookup } from './service';
import { isCurrentMember } from './stand-ins';
import { createMemoryCore } from './testing';
import type { MeetingEvent } from './types';

const DAY_MS = 86_400_000;
type View = { notes: { id: string; pageId: string } };

describe.skipIf(!hasDatabase)('meetings routes on Postgres', () => {
  let test: TestApp;
  let avery: TestUser;
  let sam: TestUser;
  let riley: TestUser;
  let casey: TestUser;
  let morgan: TestUser;
  let outsider: TestUser;
  const core = createMemoryCore();
  let events: MeetingEvent[] = [];

  beforeAll(async () => {
    test = await createTestApp({
      routes: async (app) => {
        // Pages in memory, memberships from core.
        const notes = { ...core.service, isMember: isCurrentMember };
        await app.register(meetingsRoutes, { prefix: '/api/meetings', core: notes });
      },
    });
    // Editors by default, so with the Create permission. Casey comments only, Jordan is outside.
    const person = (name: string, email: string, options: CreateUserOptions = {}) =>
      createUser(test.db, { name, email, ...options });
    avery = await person('Avery Lin', 'avery.lin@example.com');
    sam = await person('Sam Ortiz', 'sam.ortiz@example.com');
    riley = await person('Riley Chen', 'riley.chen@example.com');
    casey = await person('Casey Nguyen', 'casey.nguyen@example.com', { role: 'commenter' });
    morgan = await person('Morgan Lee', 'morgan.lee@example.com');
    outsider = await person('Jordan Patel', 'jordan.patel@example.com', { role: null });
    // Dates from today, as new notes are only for meetings within a year of it.
    const meeting = (eventId: string, title: string, inDays = 1): MeetingEvent => ({
      eventId,
      occurrence: null,
      title,
      allDay: false,
      start: new Date(Date.now() + inDays * DAY_MS).toISOString(),
      timeZone: 'America/Denver',
      organizerId: avery.id,
      memberIds: [sam.id, riley.id, casey.id],
    });
    events = [
      meeting('team-huddle', 'Team huddle'),
      meeting('rota-review', 'Rota review'),
      meeting('coaching-sync', 'Coaching sync'),
      meeting('qa-review', 'QA review'),
      meeting('care-plan-review', 'Care plan review'),
      meeting('far-off-review', 'Far-off review', 800),
      { ...meeting('weekly-stand-up', 'Weekly stand-up', 2), occurrence: '2026-10-26T09:30' },
      { ...meeting('weekly-stand-up', 'Weekly stand-up', 9), occurrence: '2026-11-02T09:30' },
    ];
    registerMeetingEventLookup(async (_db, { workspaceId, eventId, occurrence }) => {
      if (workspaceId !== avery.workspaceId) return null;
      const found = events.find(
        (e) => e.eventId === eventId && (e.occurrence ?? undefined) === occurrence,
      );
      return found ?? null;
    });
  });
  afterAll(async () => {
    registerMeetingEventLookup(null);
    await test?.close();
  });

  const takeNotes = (user: TestUser, payload: object) =>
    injectAs(test.app, user, { method: 'POST', url: '/api/meetings/notes', payload });
  const rows = async (query: ReturnType<typeof sql>) => (await test.db.execute(query)).rows;

  it('makes the notes once, then opens them (MT-01)', async () => {
    const first = await takeNotes(avery, { eventId: 'team-huddle' });
    expect(first.statusCode).toBe(201);
    const made = (first.json() as View).notes;
    expect(Object.keys(made).sort()).toEqual(['id', 'pageId']);
    const saved = await rows(
      sql`SELECT workspace_id, page_id, event_id, occurrence_key, created_by FROM meetings_notes
        WHERE id = ${made.id}::uuid`,
    );
    expect(saved).toEqual([
      {
        workspace_id: avery.workspaceId,
        page_id: made.pageId,
        event_id: 'team-huddle',
        occurrence_key: '',
        created_by: avery.id,
      },
    ]);
    const page = core.pages.find((p) => p.id === made.pageId);
    expect(page).toMatchObject({ title: notesTitle(events[0]!), inheritAccess: false });
    const again = await takeNotes(avery, { eventId: 'team-huddle' });
    expect(again.statusCode).toBe(200);
    expect((again.json() as View).notes).toEqual(made);
  });

  it('gives people clicking at once one page (MT-01)', async () => {
    const responses = await Promise.all(
      [avery, sam, riley].map((user) => takeNotes(user, { eventId: 'rota-review' })),
    );
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 200, 201]);
    const pageIds = responses.map((response) => (response.json() as View).notes.pageId);
    expect(new Set(pageIds).size).toBe(1);
    const saved = await rows(
      sql`SELECT count(*)::int AS n FROM meetings_notes WHERE event_id = 'rota-review'`,
    );
    expect(saved).toEqual([{ n: 1 }]);
  });

  it('keeps the Can edit the event gave each workspace attendee (MT-D1)', async () => {
    const { notes } = (await takeNotes(sam, { eventId: 'coaching-sync' })).json() as View;
    const given = core.grants.filter((grant) => grant.pageId === notes.pageId);
    expect(given.map((grant) => grant.userId).sort()).toEqual(
      [avery.id, riley.id, casey.id].sort(),
    );
    for (const grant of given) {
      expect(grant).toMatchObject({ level: 'edit', source: { type: 'user', id: sam.id } });
    }
    const kept = await rows(
      sql`SELECT user_id, grant_id FROM meetings_grants WHERE notes_id = ${notes.id}::uuid`,
    );
    const pairs = (list: { user_id: string; grant_id: string }[]) =>
      list.map((row) => `${row.user_id}:${row.grant_id}`).sort();
    expect(pairs(kept as { user_id: string; grant_id: string }[])).toEqual(
      pairs(given.map((grant) => ({ user_id: grant.userId, grant_id: grant.id }))),
    );
  });

  it('makes a page for each occurrence, under one Meeting notes page', async () => {
    const take = async (occurrence: string) =>
      ((await takeNotes(avery, { eventId: 'weekly-stand-up', occurrence })).json() as View).notes;
    const first = await take('2026-10-26T09:30');
    const next = await take('2026-11-02T09:30');
    expect(next.pageId).not.toBe(first.pageId);
    const keys = await rows(
      sql`SELECT occurrence_key FROM meetings_notes WHERE event_id = 'weekly-stand-up'
        ORDER BY occurrence_key`,
    );
    expect(keys).toEqual([
      { occurrence_key: '2026-10-26T09:30' },
      { occurrence_key: '2026-11-02T09:30' },
    ]);
    const parents = core.pages.filter(
      (page) => page.title === NOTES_PARENT_TITLE && page.createdBy === avery.id,
    );
    expect(parents).toHaveLength(1);
    const place = await rows(
      sql`SELECT parent_page_id FROM meetings_places WHERE user_id = ${avery.id}::uuid`,
    );
    expect(place).toEqual([{ parent_page_id: parents[0]?.id }]);
    for (const notes of [first, next]) {
      expect(core.pages.find((page) => page.id === notes.pageId)?.parentId).toBe(parents[0]?.id);
    }
  });

  it('gives Can edit only to attendees who are members now (MT-D1)', async () => {
    await addMember(test.db, { userId: riley.id, kind: 'guest' });
    const { notes } = (await takeNotes(avery, { eventId: 'care-plan-review' })).json() as View;
    await addMember(test.db, { userId: riley.id, role: 'editor' });
    const given = core.grants.filter((grant) => grant.pageId === notes.pageId);
    expect(given.map((grant) => grant.userId).sort()).toEqual([sam.id, casey.id].sort());
  });

  it('is 404 for people not invited, 403 for outsiders, guests and without the Create permission', async () => {
    const notInvited = await takeNotes(morgan, { eventId: 'team-huddle' });
    expect(notInvited.statusCode).toBe(404);
    expect(notInvited.json()).toEqual({
      error: { code: 'not_found', message: 'This was deleted, or the link is wrong.' },
    });
    expect((await takeNotes(outsider, { eventId: 'team-huddle' })).statusCode).toBe(403);
    expect((await takeNotes(casey, { eventId: 'qa-review' })).statusCode).toBe(403);
    expect((await takeNotes(casey, { eventId: 'team-huddle' })).statusCode).toBe(200);
    // A guest gets nothing, even one Calendar lists.
    await addMember(test.db, { userId: sam.id, kind: 'guest' });
    expect((await takeNotes(sam, { eventId: 'team-huddle' })).statusCode).toBe(403);
    await addMember(test.db, { userId: sam.id, role: 'editor' });
    expect((await takeNotes(sam, { eventId: 'team-huddle' })).statusCode).toBe(200);
  });

  it('is 400 for a bad request, or a meeting more than a year away', async () => {
    const bad = await takeNotes(avery, { eventId: 'team-huddle', occurrence: 'next week' });
    expect(bad.statusCode).toBe(400);
    expect((bad.json() as { error: { code: string } }).error.code).toBe('invalid');
    const farOff = await takeNotes(avery, { eventId: 'far-off-review' });
    expect(farOff.statusCode).toBe(400);
    expect(farOff.json()).toEqual({
      error: { code: 'invalid', message: 'Meeting notes are for meetings within a year of today.' },
    });
  });

  it('answers 429 after 20 tries in a minute', async () => {
    const busy = await createUser(test.db);
    for (let i = 0; i < 20; i += 1) {
      expect((await takeNotes(busy, { eventId: 'team-huddle' })).statusCode).toBe(404);
    }
    const limited = await takeNotes(busy, { eventId: 'team-huddle' });
    expect(limited.statusCode).toBe(429);
    expect((limited.json() as { error: { code: string } }).error.code).toBe('rate_limited');
  });
});
