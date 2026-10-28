// Page content for versions. The content API (getPageContent and setPageContent in
// features/collab/index.ts, pull request #200) isn't on main yet, so this is a stand-in: with no
// content to read, no version is saved. Tests bind a fake; when #200 lands, this calls it instead.
import type { HistoryDoc } from '@carehub/extras/history';
import type { Db, Tx } from '../../db';

export interface HistoryContent {
  /** The page's content now, edits the collaboration server hasn't saved yet included. */
  getPageContent(db: Db | Tx, pageId: string): Promise<HistoryDoc>;
  /** Replaces the page's content (restoring a version); open editors get the change. */
  setPageContent(tx: Tx, pageId: string, doc: HistoryDoc, by: string | null): Promise<void>;
}

// stand-in: getPageContent and setPageContent from features/collab/index.ts (#200)
let content: HistoryContent | null = null;

/** Binds the content API; the returned function unbinds it. */
export function bindHistoryContent(next: HistoryContent): () => void {
  content = next;
  return () => {
    if (content === next) content = null;
  };
}

/** The content API, or null while none is bound. */
export function historyContent(): HistoryContent | null {
  return content;
}
