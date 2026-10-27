// Archive (spec 3.5, HT-14), shared by the server and the web app: what the archive routes answer,
// and how archiving reads ("Archived by Sam Ortiz on Oct 20, 2026").
import type { HistoryPerson } from './api';

/** `GET /pages/:pageId/archive`: the page's banner and the Archive confirm. */
export interface ArchiveState {
  /** Who archived the page, or the parent page it went with, and when (ISO); null if it isn't. */
  archived: { by: HistoryPerson | null; at: string } | null;
  /**
   * Whether the person may archive the page, or unarchive it: Full access on the page that was
   * archived. Rows can't be archived on their own.
   */
  canChange: boolean;
  /** The sub-pages that go along (rows not counted); counted only when `canChange`. */
  subPages: number;
}

/** `POST /pages/:pageId/archive` and `…/unarchive`: the page archived or put back. */
export interface ArchiveChange {
  pageId: string;
  title: string;
  /** How many sub-pages went along. */
  subPages: number;
}

/** "1 sub-page", "12 sub-pages" */
export function subPagesText(count: number): string {
  return `${count.toLocaleString('en-US')} sub-page${count === 1 ? '' : 's'}`;
}

const quoted = (title: string) => `“${title.trim() || 'Untitled'}”`;

/** "Archive “Policies”?" */
export function archiveTitle(title: string): string {
  return `Archive ${quoted(title)}?`;
}

/** What the Archive confirm says happens, with how many sub-pages go along. */
export function archiveQuestion(subPages: number): string {
  if (subPages === 0) {
    return 'The page turns read-only and leaves the sidebar and search. Links still open it, and Unarchive puts it back.';
  }
  return `The page and its ${subPagesText(subPages)} turn read-only and leave the sidebar and search. Links still open them, and Unarchive puts everything back.`;
}

/** "Archived “Policies” and its 12 sub-pages." or "Unarchived “Policies”." */
export function archiveDoneText(change: ArchiveChange, archived: boolean): string {
  const along = change.subPages > 0 ? ` and its ${subPagesText(change.subPages)}` : '';
  return `${archived ? 'Archived' : 'Unarchived'} ${quoted(change.title)}${along}.`;
}

/** The banner: "Archived by Sam Ortiz on Oct 20, 2026", in `timeZone` (the browser's if left out). */
export function archivedText(
  archived: NonNullable<ArchiveState['archived']>,
  timeZone?: string,
): string {
  const day = new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(archived.at));
  return archived.by ? `Archived by ${archived.by.name} on ${day}` : `Archived on ${day}`;
}
