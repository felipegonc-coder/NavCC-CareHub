// Meeting notes shapes shared by the service, the store, the routes and Calendar (via index.ts).
import type { AccessLevel } from '@carehub/shared';
import type { Db, Tx } from '../../db';

/** A meeting notes block: its page, and the event occurrence it's linked to (Meetings spec 4). */
export interface MeetingNotes {
  id: string;
  workspaceId: string;
  pageId: string;
  /** Null for a standalone block. */
  eventId: string | null;
  /** Calendar's occurrence key: '' when the event doesn't repeat, null without an event. */
  occurrenceKey: string | null;
  createdBy: string;
  createdAt: Date;
}

/** One occurrence of a Care Hub event, as Calendar's lookup gives it. */
export interface MeetingEvent {
  eventId: string;
  /** Null when the event doesn't repeat. */
  occurrence: string | null;
  title: string;
  allDay: boolean;
  /** This occurrence's start now: an ISO instant, or a date when it's all-day. */
  start: string;
  /** The event's own time zone. */
  timeZone: string;
  organizerId: string;
  /** Invited workspace members, without the organizer and without outside guests. */
  memberIds: readonly string[];
}

/** Null when the workspace has no such event or occurrence (a repeating one needs the key). */
export type MeetingEventLookup = (
  db: Db | Tx,
  target: { workspaceId: string; eventId: string; occurrence?: string | undefined },
) => Promise<MeetingEvent | null>;

type NewPage = {
  workspaceId: string;
  spaceId?: string;
  parentId?: string;
  kind: 'page';
  title: string;
  createdBy: string;
};
type UserGrant = { pageId: string; principal: { type: 'user'; id: string }; level: 'edit' };

/** What notes need from pages and page content (0007, sections 3.3, 4.1 and 4.2). */
export interface NotesPages {
  getPrivateSpaceId(db: Db | Tx, userId: string): Promise<string>;
  createPage(db: Db | Tx, page: NewPage): Promise<{ id: string }>;
  getPageAccess(db: Db | Tx, userId: string, pageId: string): Promise<AccessLevel>;
  grantAccess(db: Db | Tx, grant: UserGrant & { grantedBy: string }): Promise<{ id: string }>;
  setPageContentFromMarkdown(db: Db | Tx, pageId: string, markdown: string): Promise<void>;
}

/** The signed-in member; `canCreatePages` is the Create permission (`pages.create`). */
export interface Viewer {
  userId: string;
  workspaceId: string;
  canCreatePages: boolean;
}
