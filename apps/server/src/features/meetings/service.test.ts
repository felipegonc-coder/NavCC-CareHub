import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HttpError } from '../../core/errors';
import { NOTES_MARKDOWN } from './domain/notes';
import { NOTES_PARENT_TITLE, registerMeetingEventLookup, takeMeetingNotes } from './service';
import { createMemoryCore, createMemoryNotesStore, memoryDb } from './testing';
import type { MeetingEvent, Viewer } from './types';

const WORKSPACE = 'care-team-demo';
const NOW = new Date('2026-10-27T12:00:00.000Z');
const member = (userId: string, canCreatePages = true): Viewer => ({
  userId,
  workspaceId: WORKSPACE,
  canCreatePages,
});
const avery = member('avery');
const sam = member('sam');
const riley = member('riley');
const jordan = member('jordan');
const morgan = member('morgan');
// Invited, but her role can't create pages.
const casey = member('casey', false);

const huddle: MeetingEvent = {
  eventId: 'team-huddle',
  occurrence: null,
  title: 'Team huddle',
  allDay: false,
  start: '2026-10-27T16:00:00.000Z',
  timeZone: 'America/Denver',
  organizerId: 'avery',
  memberIds: ['sam', 'riley', 'casey'],
};
const standUp = (occurrence: string, start: string): MeetingEvent => ({
  ...huddle,
  eventId: 'weekly-stand-up',
  occurrence,
  title: 'Weekly stand-up',
  start,
});

let events: MeetingEvent[];
let store: ReturnType<typeof createMemoryNotesStore>;
let core: ReturnType<typeof createMemoryCore>;
const take = (viewer: Viewer, input: { eventId: string; occurrence?: string }) =>
  takeMeetingNotes(memoryDb, { store, core: core.service }, viewer, input, NOW);
const notesPages = () => core.pages.filter((page) => page.title !== NOTES_PARENT_TITLE);

async function failure(promise: Promise<unknown>): Promise<number> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  if (!(error instanceof HttpError)) throw new Error(`Expected an HttpError, got ${String(error)}`);
  return error.statusCode;
}

beforeEach(() => {
  events = [
    huddle,
    { ...huddle, eventId: 'rota-review', title: 'Rota review' },
    standUp('2026-10-26T09:30', '2026-10-26T15:30:00.000Z'),
    standUp('2026-11-02T09:30', '2026-11-02T16:30:00.000Z'),
    standUp('2028-11-06T09:30', '2028-11-06T16:30:00.000Z'),
  ];
  store = createMemoryNotesStore();
  core = createMemoryCore();
  registerMeetingEventLookup(async (_db, { workspaceId, eventId, occurrence }) => {
    if (workspaceId !== WORKSPACE) return null;
    const found = events.find(
      (e) => e.eventId === eventId && (e.occurrence ?? undefined) === occurrence,
    );
    return found ?? null;
  });
});
afterEach(() => registerMeetingEventLookup(null));

describe('takeMeetingNotes', () => {
  it('makes the notes page under Meeting notes in the private space (MT-01)', async () => {
    const { notes, created } = await take(avery, { eventId: 'team-huddle' });
    expect(created).toBe(true);
    const [parent, page] = core.pages;
    expect(parent).toMatchObject({ title: 'Meeting notes', parentId: null, createdBy: 'avery' });
    expect(parent?.spaceId).toBe(core.privateSpaces.get('avery'));
    expect(page).toMatchObject({
      id: notes.pageId,
      title: 'Team huddle · Oct 27, 2026',
      parentId: parent?.id,
      spaceId: parent?.spaceId,
      markdown: NOTES_MARKDOWN,
      inheritAccess: false,
    });
    expect(notes).toMatchObject({
      workspaceId: WORKSPACE,
      eventId: 'team-huddle',
      occurrenceKey: '',
      createdBy: 'avery',
    });
  });

  it('opens the same page on the second click', async () => {
    const first = await take(avery, { eventId: 'team-huddle' });
    const second = await take(avery, { eventId: 'team-huddle' });
    expect(second.created).toBe(false);
    expect(second.notes.pageId).toBe(first.notes.pageId);
    expect(notesPages()).toHaveLength(1);
  });

  it('gives two people clicking at once the same page (MT-01)', async () => {
    const results = await Promise.all([
      take(avery, { eventId: 'team-huddle' }),
      take(sam, { eventId: 'team-huddle' }),
      take(riley, { eventId: 'team-huddle' }),
    ]);
    expect(new Set(results.map((result) => result.notes.pageId)).size).toBe(1);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(notesPages()).toHaveLength(1);
    expect(store.notes).toHaveLength(1);
  });

  it("shares the page with the event's workspace attendees as Can edit (MT-D1)", async () => {
    const { notes } = await take(sam, { eventId: 'team-huddle' });
    const shared = core.grants.map(({ pageId, userId, level, source }) => ({
      pageId,
      userId,
      level,
      source,
    }));
    expect(shared).toEqual(
      ['avery', 'riley', 'casey'].map((userId) => ({
        pageId: notes.pageId,
        userId,
        level: 'edit',
        source: { type: 'user', id: 'sam' },
      })),
    );
    expect(store.grants.map((grant) => grant.userId)).toEqual(['avery', 'riley', 'casey']);
    expect(store.grants.map((grant) => grant.grantId)).toEqual(core.grants.map((g) => g.id));
  });

  it('gives nothing to guests or people who left the workspace', async () => {
    core.notMembers.add('riley');
    const { notes } = await take(avery, { eventId: 'team-huddle' });
    expect(core.grants.map((grant) => grant.userId)).toEqual(['sam', 'casey']);
    expect(core.canOpen('riley', notes.pageId)).toBe(false);
  });

  it('gives Can edit, from the meeting, to someone invited after the notes were made', async () => {
    const { notes } = await take(avery, { eventId: 'team-huddle' });
    events[0] = { ...huddle, memberIds: [...huddle.memberIds, 'jordan'] };
    const opened = await take(jordan, { eventId: 'team-huddle' });
    expect(opened).toMatchObject({ created: false, notes: { pageId: notes.pageId } });
    expect(core.grants.at(-1)).toMatchObject({
      userId: 'jordan',
      source: { type: 'meeting', notesId: notes.id },
    });
    await take(jordan, { eventId: 'team-huddle' });
    expect(core.grants.filter((grant) => grant.userId === 'jordan')).toHaveLength(1);
  });

  it('makes a page for each occurrence of a repeating meeting, in one Meeting notes page', async () => {
    const first = await take(avery, { eventId: 'weekly-stand-up', occurrence: '2026-10-26T09:30' });
    const next = await take(avery, { eventId: 'weekly-stand-up', occurrence: '2026-11-02T09:30' });
    expect(next.notes.pageId).not.toBe(first.notes.pageId);
    expect(next.notes.occurrenceKey).toBe('2026-11-02T09:30');
    expect(notesPages().map((page) => page.title)).toEqual([
      'Weekly stand-up · Oct 26, 2026',
      'Weekly stand-up · Nov 2, 2026',
    ]);
    expect(core.pages.filter((page) => page.title === NOTES_PARENT_TITLE)).toHaveLength(1);
  });

  it('makes a new Meeting notes page when the old one is in Trash or in another space', async () => {
    await take(avery, { eventId: 'team-huddle' });
    const trashed = core.pages[0]!;
    trashed.trashed = true;
    await take(avery, { eventId: 'rota-review' });
    const second = core.pages.find((page) => page.id === store.places.get(`${WORKSPACE}:avery`))!;
    expect(second).toMatchObject({ title: NOTES_PARENT_TITLE, trashed: false });
    expect(second.id).not.toBe(trashed.id);

    core.move(second.id, 'team-space');
    const { notes } = await take(avery, {
      eventId: 'weekly-stand-up',
      occurrence: '2026-10-26T09:30',
    });
    const third = core.pages.find((page) => page.id === store.places.get(`${WORKSPACE}:avery`))!;
    expect(third.id).not.toBe(second.id);
    expect(third.spaceId).toBe(core.privateSpaces.get('avery'));
    expect(core.pages.find((page) => page.id === notes.pageId)?.parentId).toBe(third.id);
  });

  it('keeps new notes from people the Meeting notes page was shared with or moved to', async () => {
    await take(avery, { eventId: 'team-huddle' });
    const parent = core.pages[0]!;
    core.share(parent.id, 'morgan');
    const shared = await take(avery, { eventId: 'rota-review' });
    expect(core.pages.find((page) => page.id === shared.notes.pageId)?.parentId).toBe(parent.id);
    expect(core.canOpen('morgan', parent.id)).toBe(true);
    expect(core.canOpen('morgan', shared.notes.pageId)).toBe(false);

    core.teamSpaces.set('team-space', new Set(['morgan']));
    core.move(parent.id, 'team-space');
    const moved = await take(avery, { eventId: 'weekly-stand-up', occurrence: '2026-10-26T09:30' });
    expect(core.canOpen('morgan', moved.notes.pageId)).toBe(false);
    expect(core.canOpen('sam', moved.notes.pageId)).toBe(true);
  });

  it("keeps each workspace's notes apart, even for the same event ID", async () => {
    registerMeetingEventLookup(async () => huddle);
    const ours = await take(avery, { eventId: 'team-huddle' });
    const elsewhere = { ...avery, workspaceId: 'other-workspace' };
    const theirs = await take(elsewhere, { eventId: 'team-huddle' });
    expect(theirs.created).toBe(true);
    expect(theirs.notes.pageId).not.toBe(ours.notes.pageId);
  });

  it("is 404 for people not invited, as for events that don't exist", async () => {
    expect(await failure(take(morgan, { eventId: 'team-huddle' }))).toBe(404);
    await take(avery, { eventId: 'team-huddle' });
    expect(await failure(take(morgan, { eventId: 'team-huddle' }))).toBe(404);
    expect(core.grants.some((grant) => grant.userId === 'morgan')).toBe(false);
  });

  it('needs the Create permission to make the page, not to open it', async () => {
    expect(await failure(take(casey, { eventId: 'team-huddle' }))).toBe(403);
    expect(core.pages).toHaveLength(0);
    const { notes } = await take(riley, { eventId: 'team-huddle' });
    expect((await take(casey, { eventId: 'team-huddle' })).notes.pageId).toBe(notes.pageId);
  });

  it('makes notes only for occurrences within a year of today (400)', async () => {
    const later = { eventId: 'weekly-stand-up', occurrence: '2028-11-06T09:30' };
    expect(await failure(take(avery, later))).toBe(400);
    expect(core.pages).toHaveLength(0);
  });

  it("is 404 for an event or occurrence Calendar doesn't find", async () => {
    expect(await failure(take(avery, { eventId: 'no-such-event' }))).toBe(404);
    expect(await failure(take(avery, { eventId: 'weekly-stand-up' }))).toBe(404);
    const wrongDay = { eventId: 'weekly-stand-up', occurrence: '2026-10-27T09:30' };
    expect(await failure(take(avery, wrongDay))).toBe(404);
    const other = { ...avery, workspaceId: 'other-workspace' };
    expect(await failure(take(other, { eventId: 'team-huddle' }))).toBe(404);
    registerMeetingEventLookup(null);
    expect(await failure(take(avery, { eventId: 'team-huddle' }))).toBe(404);
  });

  it('makes nothing until pages are on the server (409)', async () => {
    const noCore = takeMeetingNotes(memoryDb, { store, core: null }, avery, {
      eventId: 'team-huddle',
    });
    expect(await failure(noCore)).toBe(409);
    expect(store.notes).toHaveLength(0);
  });
});
