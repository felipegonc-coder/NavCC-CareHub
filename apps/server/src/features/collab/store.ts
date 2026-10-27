import { eq } from 'drizzle-orm';
import * as Y from 'yjs';
import type { Db, Tx } from '../../db';
import { pageSchemaInfo } from './check';
import { pageDocs } from './schema';
import { countBlocks, readContent, toText } from './ydoc';

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
    .select({ state: pageDocs.state })
    .from(pageDocs)
    .where(eq(pageDocs.pageId, pageId));
  return row?.state ?? null;
}

interface StoredRow {
  state: Uint8Array;
  text: string;
}

/** Creates the page's row if needed, locks it until the transaction ends and returns it. */
async function lockRow(tx: Db | Tx, pageId: string): Promise<StoredRow> {
  await tx.insert(pageDocs).values({ pageId, state: NO_STATE }).onConflictDoNothing();
  const [row] = await tx
    .select({ state: pageDocs.state, text: pageDocs.text })
    .from(pageDocs)
    .where(eq(pageDocs.pageId, pageId))
    .for('update');
  return row ?? { state: NO_STATE, text: '' };
}

/** The row's new values. `text_updated_at` moves only when the text changes. */
function changes(doc: Y.Doc, copies: DerivedCopies, stored: StoredRow, by: string | null) {
  const now = new Date();
  const textChanged = copies.text !== stored.text;
  return {
    state: Y.encodeStateAsUpdate(doc),
    ...copies,
    ...(textChanged ? { textUpdatedAt: now } : {}),
    updatedAt: now,
    updatedBy: by,
  };
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
    if (stored.state.length > 0) Y.applyUpdate(doc, stored.state, MERGE_ORIGIN);
    const copies = deriveCopies(doc);
    await tx
      .update(pageDocs)
      .set(changes(doc, copies, stored, by))
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
