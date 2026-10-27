// The Updates API (/api/history/pages/:pageId/updates, section 3.3): what happened on a page.
import { versionListQuerySchema, type HistoryPerson } from './api';

export const UPDATE_KINDS = [
  'created',
  'edited',
  'renamed',
  'moved',
  'shared',
  'locked',
  'unlocked',
  'commented',
  'suggestion_accepted',
  'property_changed',
  'restored',
  'archived',
  'unarchived',
  'trashed',
  'untrashed',
] as const;
export type UpdateKind = (typeof UPDATE_KINDS)[number];

/** Where a page moved from or to: a page the person can open, one they can't, or a space's top. */
export type UpdatePlace =
  { kind: 'page'; id: string; title: string } | { kind: 'hidden' } | { kind: 'top' };

/** One thing that happened on the page. Times are ISO strings. */
export interface UpdateEntry {
  id: string;
  kind: UpdateKind;
  at: string;
  /** Who did it; null for an automation or someone no longer known. */
  by: HistoryPerson | null;
  /** edited: how many changes the version holds, as Show changes marks them. */
  changes?: number;
  /** renamed */
  title?: { from: string; to: string };
  /** moved */
  move?: { from: UpdatePlace; to: UpdatePlace };
  /** property_changed, as text: "Status: Open → Done" */
  property?: { name: string; from: string; to: string };
  /** restored: when the version put back was saved. */
  restoredFrom?: string;
  /** commented: a reply in a thread rather than a new comment. */
  reply?: boolean;
  /** Show changes opens Version history on this version; only for people with Can edit. */
  versionId?: string;
}

export interface UpdateListResponse {
  /** Newest first. */
  updates: UpdateEntry[];
  /** Pass it as `before` for the next ones; null at the end. */
  nextCursor: string | null;
}

/** `before` (a cursor) and `limit` (50 unless given, at most 100), as for versions. */
export const updateListQuerySchema = versionListQuerySchema;
