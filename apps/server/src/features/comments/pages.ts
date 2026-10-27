// What comments need from the page model (decision 0007, section 3.3). The page model isn't on
// main yet (pull request #49), so this is a stand-in: until a lookup is bound, every page counts
// as missing, the comment routes answer 404 and nothing leaks. Tests bind a fake. When the page
// model lands, this calls it instead (see README.md).
import type { AccessLevel } from '@carehub/shared';
import type { Db, Tx } from '../../db';

export type PageAccess = { workspaceId: string; level: AccessLevel };

/** The person's level on the page, and its workspace; null when it's missing or in Trash. */
export type PageAccessLookup = (
  db: Db | Tx,
  userId: string,
  pageId: string,
) => Promise<PageAccess | null>;

const missing: PageAccessLookup = async () => null;
let lookup = missing;

/** Binds the lookup; the returned function unbinds it. */
export function bindCommentPages(next: PageAccessLookup): () => void {
  lookup = next;
  return () => {
    if (lookup === next) lookup = missing;
  };
}

export function pageAccess(db: Db | Tx, userId: string, pageId: string) {
  return lookup(db, userId, pageId);
}
