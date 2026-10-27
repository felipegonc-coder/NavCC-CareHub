// What history needs from the page model (decision 0007, sections 3.3 and 4.1). The page model
// isn't on main yet (pull request #49; archiving comes with pages PR 2), so this is a stand-in that
// denies by default: no page is found, so no version is saved, and the history routes will answer
// 404 and leak nothing. Tests bind fakes. When the page model lands, this calls it instead.
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
}

export interface HistoryPages {
  /** The page, or null when it doesn't exist (deleted for good). */
  getPage(db: Db | Tx, pageId: string): Promise<HistoryPage | null>;
}

// stand-in: features/pages/index.ts (the page model, #49)
const nothing: HistoryPages = {
  getPage: async () => null,
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
