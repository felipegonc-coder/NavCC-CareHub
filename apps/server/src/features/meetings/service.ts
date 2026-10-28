// Take meeting notes: one notes page per event occurrence (Meetings spec, sections 3 and 5).
import { atLeast } from '@carehub/shared';
import { httpError } from '../../core/errors';
import type { Db, Tx } from '../../db';
import { attendeesOf, NOTES_MARKDOWN, notesTitle, type TakeNotesInput } from './domain/notes';
import type { MeetingEventLookup, MeetingNotes, NotesPages, Viewer } from './types';

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
 * organizer and invited members (403), and making them needs the Create permission. 404 when
 * Calendar doesn't find the event or occurrence. Two clicks at once get the same page.
 */
export async function takeMeetingNotes(
  db: Db,
  { store, pages }: { store: NotesStore; pages: NotesPages | null },
  viewer: Viewer,
  input: TakeNotesInput,
): Promise<{ notes: MeetingNotes; created: boolean }> {
  const { workspaceId, userId } = viewer;
  const event = eventLookup && (await eventLookup(db, { workspaceId, ...input }));
  if (!event) throw httpError(404, 'not_found');
  const attendees = attendeesOf(event);
  if (!attendees.includes(userId)) throw httpError(403, 'forbidden');
  if (!pages) {
    throw httpError(409, 'conflict', "Meeting notes need pages, which aren't set up yet.");
  }

  // Can edit for these attendees, given in the name of the person who made the notes (MT-D1).
  const share = async (tx: Tx, notes: MeetingNotes, userIds: readonly string[]) => {
    const granted = new Set([notes.createdBy, ...(await store.grantedUsers(tx, notes.id))]);
    for (const id of userIds.filter((user) => !granted.has(user))) {
      const principal = { type: 'user', id } as const;
      const grant = await pages.grantAccess(tx, {
        pageId: notes.pageId,
        principal,
        level: 'edit',
        grantedBy: notes.createdBy,
      });
      await store.addGrant(tx, { notesId: notes.id, userId: id, grantId: grant.id });
    }
  };

  // The person's "Meeting notes" page: made in their private space the first time, or if it's gone.
  const notesPlace = async (tx: Tx) => {
    await store.lock(tx, `meetings:place:${workspaceId}:${userId}`);
    const saved = await store.getPlace(tx, workspaceId, userId);
    if (saved && atLeast(await pages.getPageAccess(tx, userId, saved), 'edit')) return saved;
    const spaceId = await pages.getPrivateSpaceId(tx, userId);
    const page = { workspaceId, spaceId, kind: 'page', title: NOTES_PARENT_TITLE } as const;
    const { id } = await pages.createPage(tx, { ...page, createdBy: userId });
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
      // Someone invited after the notes were made gets the access the event gives.
      await share(tx, existing, [userId]);
      return { notes: existing, created: false };
    }
    if (!viewer.canCreatePages) throw httpError(403, 'forbidden');
    const parentId = await notesPlace(tx);
    const title = notesTitle(event);
    const page = await pages.createPage(tx, {
      workspaceId,
      parentId,
      kind: 'page',
      title,
      createdBy: userId,
    });
    await pages.setPageContentFromMarkdown(tx, page.id, NOTES_MARKDOWN);
    const notes = await store.insert(tx, { ...occurrence, pageId: page.id, createdBy: userId });
    await share(tx, notes, attendees);
    return { notes, created: true };
  });
}
