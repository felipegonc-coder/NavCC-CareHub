// Archive (spec 3.5, HT-14): Full access archives a page or database with its sub-pages, which turn
// read-only and leave the sidebar and search; Unarchive puts everything back. The page model keeps
// who archived what and does the archiving (pages PR 2). This checks access, refuses rows and
// counts the sub-pages that go along; the routes emit page.archived and page.unarchived.
import type { ArchiveChange, ArchiveState } from '@carehub/extras/history';
import { atLeast } from '@carehub/shared';
import { httpError } from '../../core/errors';
import type { Db, Tx } from '../../db';
import { pageFor } from './access';
import { historyPages, type HistoryPage, type PageArchive } from './pages';
import { peopleFor } from './service';

export const ROWS_REFUSED = "Rows can't be archived. Use a property or Trash.";

/** What archiving or unarchiving changed: the answer, and every page for the event. */
export interface ArchiveDone extends ArchiveChange {
  pageIds: string[];
}

/** The archive the page is in: its own, or the parent page's it went with. */
async function archiveOf(db: Db | Tx, page: HistoryPage): Promise<PageArchive | null> {
  if (!page.archivedAt) return null;
  const found = await historyPages().getArchive(db, page.id);
  return found ?? { pageId: page.id, by: null, at: page.archivedAt };
}

const hasFullAccess = async (db: Db | Tx, userId: string, pageId: string) =>
  atLeast(await historyPages().getPageAccess(db, userId, pageId), 'full');

/** The page's archive state, for anyone who can open it (the banner) and Full access (Archive). */
export async function archiveState(
  db: Db,
  userId: string,
  page: HistoryPage,
): Promise<ArchiveState> {
  const archive = await archiveOf(db, page);
  const target = archive?.pageId ?? page.id;
  // A row goes along with its database, never alone.
  const canChange =
    (archive !== null || page.kind !== 'row') && (await hasFullAccess(db, userId, target));
  const [subPages, people] = await Promise.all([
    canChange ? historyPages().countSubPages(db, target) : 0,
    peopleFor(db, archive?.by ? [archive.by] : []),
  ]);
  const by = archive?.by ? (people.get(archive.by) ?? null) : null;
  return {
    archived: archive && { by, at: archive.at.toISOString() },
    canChange,
    subPages,
  };
}

async function done(tx: Tx, page: HistoryPage, pageIds: string[]): Promise<ArchiveDone> {
  // Nothing changed: the page model isn't there, or the page went meanwhile.
  if (pageIds.length === 0) throw httpError(404, 'not_found');
  // Counted like the confirm counts them, so rows aren't sub-pages.
  const subPages = await historyPages().countSubPages(tx, page.id);
  return { pageId: page.id, title: page.title, subPages, pageIds };
}

/** Archives the page with its sub-pages: Full access, not a row, not already archived. */
export function archivePage(db: Db, by: string, pageId: string): Promise<ArchiveDone> {
  return db.transaction(async (tx) => {
    const page = await pageFor(tx, by, pageId, 'full');
    if (page.kind === 'row') throw httpError(409, 'conflict', ROWS_REFUSED);
    if (page.archivedAt) throw httpError(409, 'conflict', 'This page is already archived.');
    return done(tx, page, await historyPages().archivePage(tx, pageId, by));
  });
}

/**
 * Unarchives the page that was archived (this one, or the parent page it went with) and all that
 * went with it. Needs Full access on that page; anyone else gets 403 without its title.
 */
export function unarchivePage(db: Db, by: string, pageId: string): Promise<ArchiveDone> {
  return db.transaction(async (tx) => {
    const page = await pageFor(tx, by, pageId, 'view');
    const archive = await archiveOf(tx, page);
    if (!archive) throw httpError(409, 'conflict', "This page isn't archived.");
    const archived =
      archive.pageId === page.id ? page : await historyPages().getPage(tx, archive.pageId);
    if (!archived || !(await hasFullAccess(tx, by, archived.id))) {
      throw httpError(403, 'forbidden');
    }
    return done(tx, archived, await historyPages().unarchivePage(tx, archived.id, by));
  });
}
