import { eq } from 'drizzle-orm';
import * as Y from 'yjs';
import type { Db, Tx } from '../../db';
import { pageSchemaInfo } from './check';
import { pageDocs } from './schema';
import { countBlocks, readContent, toText } from './ydoc';

/** Pages longer than this are refused (Pages and blocks, limits). */
export const MAX_BLOCKS = 20_000;

/**
 * Origin of changes the server merges into a live document from the database. Hocuspocus sends
 * them to the editors but doesn't store them again.
 */
export const MERGE_ORIGIN = { source: 'local', skipStoreHooks: true } as const;

const NO_STATE = new Uint8Array(0);

let liveDoc: (pageId: string) => Y.Doc | undefined = () => undefined;

/** The collab server shares its open documents, so reads and writes see unsaved edits. */
export function setLiveDocs(find: (pageId: string) => Y.Doc | undefined): void {
  liveDoc = find;
}

export interface DerivedCopies {
  text: string;
  blockCount: number;
}

export function deriveCopies(doc: Y.Doc): DerivedCopies {
  return {
    text: toText(readContent(doc)),
    blockCount: countBlocks(doc, pageSchemaInfo().inline),
  };
}

export async function loadState(db: Db | Tx, pageId: string): Promise<Uint8Array | null> {
  const [row] = await db
    .select({ ydoc: pageDocs.ydoc })
    .from(pageDocs)
    .where(eq(pageDocs.pageId, pageId));
  return row?.ydoc ?? null;
}

/** Creates the page's row if needed, locks it until the transaction ends and returns its state. */
async function lockRow(tx: Db | Tx, pageId: string): Promise<Uint8Array> {
  await tx.insert(pageDocs).values({ pageId, ydoc: NO_STATE }).onConflictDoNothing();
  const [row] = await tx
    .select({ ydoc: pageDocs.ydoc })
    .from(pageDocs)
    .where(eq(pageDocs.pageId, pageId))
    .for('update');
  return row?.ydoc ?? NO_STATE;
}

/**
 * Saves a live document. First merges what the database has, so changes written outside the
 * editor (imports, templates) are kept, then writes the document and its copies.
 */
export async function saveDoc(
  db: Db,
  pageId: string,
  doc: Y.Doc,
  by: string | null,
): Promise<DerivedCopies> {
  return db.transaction(async (tx) => {
    const stored = await lockRow(tx, pageId);
    if (stored.length > 0) Y.applyUpdate(doc, stored, MERGE_ORIGIN);
    const copies = deriveCopies(doc);
    await tx
      .update(pageDocs)
      .set({ ydoc: Y.encodeStateAsUpdate(doc), ...copies, updatedAt: new Date(), updatedBy: by })
      .where(eq(pageDocs.pageId, pageId));
    return copies;
  });
}

/** Brings a live document up to date with the database, after another feature wrote to it. */
export async function mergeStored(db: Db, pageId: string): Promise<void> {
  const doc = liveDoc(pageId);
  if (!doc) return;
  const state = await loadState(db, pageId);
  if (state && state.length > 0) Y.applyUpdate(doc, state, MERGE_ORIGIN);
}

/** The page's text for search, one block per line (decision 0007, section 4.2). */
export async function getPageText(db: Db | Tx, pageId: string): Promise<string> {
  const doc = liveDoc(pageId);
  if (doc) return toText(readContent(doc));
  const [row] = await db
    .select({ text: pageDocs.text })
    .from(pageDocs)
    .where(eq(pageDocs.pageId, pageId));
  return row?.text ?? '';
}
