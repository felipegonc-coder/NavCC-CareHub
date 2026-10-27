// What history needs from the page model (decision 0007, sections 3.3 and 4.1). The page model
// isn't on main yet (pull request #49; archiving comes with pages PR 2), so this is a stand-in that
// denies by default: no page is found and nobody has access, so no version is saved and the
// history routes answer 404, leaking nothing. Tests bind fakes. When the page model lands, this
// calls it instead.
import type { AccessLevel } from '@carehub/shared';
import type { Db, Tx } from '../../db';

export type HistoryPageKind = 'page' | 'database' | 'row';

/** A page as versions need it. */
export interface HistoryPage {
  id: string;
  workspaceId: string;
  kind: HistoryPageKind;
  title: string;
  icon: unknown;
  cover: unknown;
  /** Page style (full width, font, small text), as the page model keeps it. */
  style: Record<string, unknown>;
  /** Locked pages can't be restored to a version. */
  locked: boolean;
  /** In Trash, by itself or with a parent page. */
  trashed: boolean;
  /** When it or a parent page was archived (pages PR 2): archived pages are read-only. */
  archivedAt: Date | null;
}

/** Who archived a page and when; `pageId` is the page archived: this one or a parent page. */
export interface PageArchive {
  pageId: string;
  by: string | null;
  at: Date;
}

/** The parts of a page a version puts back besides its content. */
export interface PageLook {
  title: string;
  icon: unknown;
  cover: unknown;
  style: Record<string, unknown>;
}

export interface HistoryPages {
  /** The page, or null when it doesn't exist (deleted for good). */
  getPage(db: Db | Tx, pageId: string): Promise<HistoryPage | null>;
  /** The person's level on the page: `getPageAccess` (decision 0007, section 3.3). */
  getPageAccess(db: Db | Tx, userId: string, pageId: string): Promise<AccessLevel>;
  /** Puts back a version's title, icon, cover and page style (restoring it). */
  setPageLook(tx: Tx, pageId: string, look: PageLook, by: string): Promise<void>;
  /** Titles of those pages the person can open, for moves in Updates (`getPageCards`). */
  getPageTitles(
    db: Db | Tx,
    userId: string,
    pageIds: readonly string[],
  ): Promise<Map<string, string>>;
  /** The archive the page is in, its own or a parent page's (`archived_at`, `archived_by`). */
  getArchive(db: Db | Tx, pageId: string): Promise<PageArchive | null>;
  /** How many sub-pages the page has, rows and Trash left out (`listSubtree`). */
  countSubPages(db: Db | Tx, pageId: string): Promise<number>;
  /** Archives the page with its sub-pages (`archivePage`); the IDs of the pages archived. */
  archivePage(tx: Tx, pageId: string, by: string): Promise<string[]>;
  /** Puts them back (`unarchivePage`); the IDs of the pages unarchived. */
  unarchivePage(tx: Tx, pageId: string, by: string): Promise<string[]>;
}

// stand-in: features/pages/index.ts (the page model, getPageAccess, setPageTitle and
// getPageCards, #49; archiving, pages PR 2)
const nothing: HistoryPages = {
  getPage: async () => null,
  getPageAccess: async () => 'none',
  setPageLook: async () => {},
  getPageTitles: async () => new Map(),
  getArchive: async () => null,
  countSubPages: async () => 0,
  archivePage: async () => [],
  unarchivePage: async () => [],
};
let pages = nothing;

/** Binds the page model; the returned function unbinds it. */
export function bindHistoryPages(next: Partial<HistoryPages>): () => void {
  const bound = { ...nothing, ...next };
  pages = bound;
  return () => {
    if (pages === bound) pages = nothing;
  };
}

export function historyPages(): HistoryPages {
  return pages;
}

/** Whether a page model is bound; until then nothing is tracked or saved. */
export function hasPageModel(): boolean {
  return pages !== nothing;
}
