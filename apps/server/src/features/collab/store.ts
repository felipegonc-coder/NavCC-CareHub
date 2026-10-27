import { eq } from 'drizzle-orm';
import * as Y from 'yjs';
import { HttpError } from '../../core/errors';
import type { Db, Tx } from '../../db';
import { pageSchemaInfo } from './check';
import { fitToSchema, fromMarkdown, toMarkdown } from './markdown';
import { pageDocs } from './schema';
import { countBlocks, readContent, replaceContent, toText, type PageNode } from './ydoc';

/** Pages longer than this are refused (Pages and blocks, limits). */
export const MAX_BLOCKS = 20_000;

/** A write that would take a page past MAX_BLOCKS: answered as a 413 with this message. */
export class PageTooLongError extends HttpError {
  constructor() {
    super(413, 'too_large', 'This page is too long. Move some of it into a sub-page.');
    this.name = 'PageTooLongError';
  }
}

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
  markdown: string;
  text: string;
  blockCount: number;
}

export function deriveCopies(doc: Y.Doc): DerivedCopies {
  const info = pageSchemaInfo();
  const content = readContent(doc);
  return {
    markdown: toMarkdown(content, info),
    text: toText(content),
    blockCount: countBlocks(doc, info.inline),
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
  return doc ? toText(readContent(doc)) : storedCopy(db, pageId, 'text');
}

/** The page as Markdown, for export (decision 0007, section 4.2). */
export async function getPageMarkdown(db: Db | Tx, pageId: string): Promise<string> {
  const doc = liveDoc(pageId);
  return doc ? toMarkdown(readContent(doc), pageSchemaInfo()) : storedCopy(db, pageId, 'markdown');
}

async function storedCopy(db: Db | Tx, pageId: string, copy: 'markdown' | 'text'): Promise<string> {
  const [row] = await db
    .select({ value: pageDocs[copy] })
    .from(pageDocs)
    .where(eq(pageDocs.pageId, pageId));
  return row?.value ?? '';
}

/**
 * Replaces the page's content with Markdown, for imports and templates. Anything the page schema
 * doesn't allow becomes plain text. Throws PageTooLongError past MAX_BLOCKS. After the
 * transaction commits, emit `page.updated` so open editors get the change.
 */
export async function setPageContentFromMarkdown(
  tx: Tx,
  pageId: string,
  markdown: string,
  by: string | null = null,
): Promise<void> {
  await writeContent(tx, pageId, fitToSchema(fromMarkdown(markdown, pageSchemaInfo())), by);
}

/**
 * Replaces one page's content with a copy of another's, unsaved edits included (duplicates,
 * templates). Same rules as setPageContentFromMarkdown.
 */
export async function copyPageContent(
  tx: Tx,
  fromPageId: string,
  toPageId: string,
  by: string | null = null,
): Promise<void> {
  const live = liveDoc(fromPageId);
  const content = live ? readContent(live) : await withStoredDoc(tx, fromPageId, readContent);
  await writeContent(tx, toPageId, content, by);
}

async function withStoredDoc<T>(db: Db | Tx, pageId: string, use: (doc: Y.Doc) => T): Promise<T> {
  const state = await loadState(db, pageId);
  const doc = new Y.Doc();
  try {
    if (state && state.length > 0) Y.applyUpdate(doc, state);
    return use(doc);
  } finally {
    doc.destroy();
  }
}

/**
 * Writes new content as ordinary changes on top of the stored and live document, so it merges
 * with edits in progress. Works on a copy: a rollback leaves open editors untouched, and the
 * collab server merges the stored result on `page.updated`.
 */
async function writeContent(
  tx: Tx,
  pageId: string,
  content: readonly PageNode[],
  by: string | null,
): Promise<void> {
  const stored = await lockRow(tx, pageId);
  const doc = new Y.Doc();
  try {
    if (stored.state.length > 0) Y.applyUpdate(doc, stored.state);
    const live = liveDoc(pageId);
    if (live) Y.applyUpdate(doc, Y.encodeStateAsUpdate(live));
    replaceContent(doc, content);
    const copies = deriveCopies(doc);
    if (copies.blockCount > MAX_BLOCKS) throw new PageTooLongError();
    await tx
      .update(pageDocs)
      .set(changes(doc, copies, stored, by))
      .where(eq(pageDocs.pageId, pageId));
  } finally {
    doc.destroy();
  }
}
