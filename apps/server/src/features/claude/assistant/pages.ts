// What the assistant reads, checked for every question (spec 3.3 and 5; CL-10): only pages the person
// can open now, through Claude core's canOpenPage. The page model (#49) isn't on main yet, so the
// lookup of a page's workspace and title is a stand-in that finds nothing: This page and @ pages are
// refused until it's bound, and tests bind fakes. Page text comes from collab's getPageText.
import type { AssistantPageLink } from '@carehub/extras/claude/assistant';
import type { Db, Tx } from '../../../db';
import { claudeRuntime } from '../server/runtime';

export interface AssistantPage {
  workspaceId: string;
  title: string;
}

/** The page, or null when it's missing or in Trash. */
export type AssistantPageLookup = (db: Db | Tx, pageId: string) => Promise<AssistantPage | null>;

// stand-in: the page model's getPage (#49). Every page is missing.
const missing: AssistantPageLookup = async () => null;
let lookup = missing;

/** Binds the page model; the returned function unbinds it. */
export function bindAssistantPages(next: AssistantPageLookup): () => void {
  lookup = next;
  return () => {
    if (lookup === next) lookup = missing;
  };
}

export interface Asker {
  workspaceId: string;
  userId: string;
}

/** Which of these pages the person can open now. Each is asked once. */
export async function openNow(
  db: Db | Tx,
  asker: Asker,
  pageIds: Iterable<string>,
): Promise<Set<string>> {
  const { pages } = claudeRuntime();
  const open = new Set<string>();
  for (const id of new Set(pageIds)) {
    if (await pages.canOpenPage(db, asker.workspaceId, asker.userId, id)) open.add(id);
  }
  return open;
}

/** The pages with their titles, in order, or null if any is missing, elsewhere or closed to them. */
export async function pagesToRead(
  db: Db | Tx,
  asker: Asker,
  pageIds: readonly string[],
): Promise<AssistantPageLink[] | null> {
  const open = await openNow(db, asker, pageIds);
  const found: AssistantPageLink[] = [];
  for (const id of new Set(pageIds)) {
    const page = open.has(id) ? await lookup(db, id) : null;
    if (!page || page.workspaceId !== asker.workspaceId) return null;
    found.push({ id, title: page.title });
  }
  return found;
}
