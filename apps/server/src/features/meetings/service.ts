// Take meeting notes: one notes page per event occurrence (Meetings spec, sections 3 and 5).
import { httpError } from '../../core/errors';
import type { Db, Tx } from '../../db';
import {
  attendeesOf,
  NOTES_MARKDOWN,
  notesTitle,
  withinNotesWindow,
  type TakeNotesInput,
} from './domain/notes';
import type { GrantSource, MeetingEventLookup, MeetingNotes, NotesCore, Viewer } from './types';

/** Where notes are kept: Postgres in the app (store.ts), memory in unit tests (testing.ts). */
export interface NotesStore {
  /** Waits until no other transaction holds `key`, then holds it until this one ends. */
  lock(tx: Tx, key: string): Promise<void>;
  findForOccurrence(
    db: Db | Tx,
    occurrence: { workspaceId: string; eventId: string; occurrenceKey: string },
  ): Promise<MeetingNotes | null>;
  insert(tx: Tx, notes: Omit<MeetingNotes, 'id' | 'createdAt'>): Promise<MeetingNotes>;
  /** The people who have the access the event gave them on these notes. */
  grantedUsers(db: Db | Tx, notesId: string): Promise<string[]>;
  addGrant(tx: Tx, grant: { notesId: string; userId: string; grantId: string }): Promise<void>;
  /** The page a person's new notes go under, if there is one. */
  getPlace(db: Db | Tx, workspaceId: string, userId: string): Promise<string | null>;
  setPlace(tx: Tx, place: { workspaceId: string; userId: string; pageId: string }): Promise<void>;
}

/** The page new notes go under, in the note-taker's private space (MT-D1). */
export const NOTES_PARENT_TITLE = 'Meeting notes';

let eventLookup: MeetingEventLookup | null = null;

/** Calendar registers it at start-up. Until then every event is 404. */
export function registerMeetingEventLookup(lookup: MeetingEventLookup | null): void {
  eventLookup = lookup;
}

/**
 * Take meeting notes (MT-01): the occurrence's notes, made first if there are none. Only for its
 * organizer and invited members; anyone else gets 404, as for an event Calendar doesn't find, so
 * private events aren't confirmed. Making notes needs the Create permission and an occurrence
 * within a year of today. Two clicks at once get the same page.
 */
export async function takeMeetingNotes(
  db: Db,
  { store, core }: { store: NotesStore; core: NotesCore | null },
  viewer: Viewer,
  input: TakeNotesInput,
  now = new Date(),
): Promise<{ notes: MeetingNotes; created: boolean }> {
  const { workspaceId, userId } = viewer;
  const event = eventLookup && (await eventLookup(db, { workspaceId, ...input }));
  const attendees = event ? attendeesOf(event) : [];
  if (!event || !attendees.includes(userId)) throw httpError(404, 'not_found');
  if (!core) {
    throw httpError(409, 'conflict', "Meeting notes need pages, which aren't set up yet.");
  }

  // Can edit for attendees who are current members (MT-D1); guests and people who left get none.
  const share = async (
    tx: Tx,
    notes: MeetingNotes,
    ids: readonly string[],
    source: GrantSource,
  ) => {
    const granted = new Set([notes.createdBy, ...(await store.grantedUsers(tx, notes.id))]);
    for (const id of ids.filter((user) => !granted.has(user))) {
      if (!(await core.isMember(tx, workspaceId, id))) continue;
      const principal = { type: 'user', id } as const;
      const grant = await core.grantAccess(tx, {
        pageId: notes.pageId,
        principal,
        level: 'edit',
        source,
      });
      await store.addGrant(tx, { notesId: notes.id, userId: id, grantId: grant.id });
    }
  };

  // The person's "Meeting notes" page while it's still in their private space and not in Trash.
  // Moved to another space or gone, it's replaced, so it can't widen who sees new notes.
  const notesPlace = async (tx: Tx) => {
    await store.lock(tx, `meetings:place:${workspaceId}:${userId}`);
    const spaceId = await core.getPrivateSpaceId(tx, userId);
    const saved = await store.getPlace(tx, workspaceId, userId);
    const place = saved ? await core.getPagePlace(tx, saved) : null;
    if (saved && place?.spaceId === spaceId && !place.inTrash) return saved;
    const page = { workspaceId, spaceId, kind: 'page', title: NOTES_PARENT_TITLE } as const;
    const { id } = await core.createPage(tx, { ...page, createdBy: userId });
    await store.setPlace(tx, { workspaceId, userId, pageId: id });
    return id;
  };

  const key = event.occurrence ?? '';
  const occurrence = { workspaceId, eventId: event.eventId, occurrenceKey: key };
  return db.transaction(async (tx) => {
    // A second click waits here until the first one's page is saved, then opens that page.
    await store.lock(tx, `meetings:notes:${workspaceId}:${event.eventId}:${key}`);
    const existing = await store.findForOccurrence(tx, occurrence);
    if (existing) {
      // Someone invited after the notes were made gets the access the meeting gives.
      await share(tx, existing, [userId], { type: 'meeting', notesId: existing.id });
      return { notes: existing, created: false };
    }
    if (!viewer.canCreatePages) throw httpError(403, 'forbidden');
    if (!withinNotesWindow(event, now)) {
      throw httpError(400, 'invalid', 'Meeting notes are for meetings within a year of today.');
    }
    const parentId = await notesPlace(tx);
    // Notes pages don't inherit from "Meeting notes": only the note-taker and attendees get in.
    const page = await core.createPage(tx, {
      workspaceId,
      parentId,
      kind: 'page',
      title: notesTitle(event),
      createdBy: userId,
      inheritAccess: false,
    });
    await core.setPageContentFromMarkdown(tx, page.id, NOTES_MARKDOWN);
    const notes = await store.insert(tx, { ...occurrence, pageId: page.id, createdBy: userId });
    await share(tx, notes, attendees, { type: 'user', id: userId });
    return { notes, created: true };
  });
}
