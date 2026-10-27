import { eq } from 'drizzle-orm';
import * as Y from 'yjs';
import { HttpError } from '../../core/errors';
import type { Db, Tx } from '../../db';
import { MAX_BLOCKS, MAX_PAGE_BYTES, pageSchemaInfo } from './check';
import { cleanContent } from './clean';
import { fitToSchema, fromMarkdown, toMarkdown } from './markdown';
import { pageDocs } from './schema';
import { countBlocks, isRecord, readContent, replaceContent, toText, type PageNode } from './ydoc';

/**
 * A write that would take a page past MAX_BLOCKS or MAX_PAGE_BYTES: answered as a 413 with this
 * message.
 */
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

/** The copies kept next to the state. `blockCount` if the caller has counted already. */
export function deriveCopies(doc: Y.Doc, blockCount?: number): DerivedCopies {
  const info = pageSchemaInfo();
  const content = readContent(doc);
  return {
    markdown: toMarkdown(content, info),
    text: toText(content),
    blockCount: blockCount ?? countBlocks(doc, info.inline),
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
function changes(state: Uint8Array, copies: DerivedCopies, stored: StoredRow, by: string | null) {
  const now = new Date();
  const textChanged = copies.text !== stored.text;
  return {
    state,
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
      .set(changes(Y.encodeStateAsUpdate(doc), copies, stored, by))
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

/** A page's content as ProseMirror JSON. */
export interface PageContent {
  type: 'doc';
  content: PageNode[];
}

/** The page as ProseMirror JSON, unsaved edits included (decision 0007, section 4.2). */
export async function getPageContent(db: Db | Tx, pageId: string): Promise<PageContent> {
  const live = liveDoc(pageId);
  const content = live ? readContent(live) : await withStoredDoc(db, pageId, readContent);
  return { type: 'doc', content };
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
 * doesn't allow becomes plain text. Throws PageTooLongError past MAX_BLOCKS or MAX_PAGE_BYTES
 * (Markdown longer than that isn't read at all). After the transaction commits, emit
 * `page.updated` so open editors get the change.
 */
export async function setPageContentFromMarkdown(
  tx: Tx,
  pageId: string,
  markdown: string,
  by: string | null = null,
): Promise<void> {
  if (markdown.length > MAX_PAGE_BYTES) throw new PageTooLongError();
  await writeContent(tx, pageId, fitToSchema(fromMarkdown(markdown, pageSchemaInfo())), by);
}

/**
 * Replaces the page's content with ProseMirror JSON (`{ type: 'doc', content }`), for features
 * that keep content as JSON (history, templates). It keeps only what an editor could write
 * (cleanContent), fitted to the schema; otherwise the same as setPageContentFromMarkdown.
 */
export async function setPageContent(
  tx: Tx,
  pageId: string,
  doc: unknown,
  by: string | null = null,
): Promise<void> {
  if (!isRecord(doc) || doc.type !== 'doc' || !Array.isArray(doc.content)) {
    throw new HttpError(400, 'invalid_content', 'This page content can’t be read.');
  }
  const info = pageSchemaInfo();
  const blocks = doc.content.flatMap((block: unknown) => cleanContent(block, info) ?? []);
  await writeContent(tx, pageId, fitToSchema(blocks), by);
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
    // The limits before the copies, which take longest to make.
    const blockCount = countBlocks(doc, pageSchemaInfo().inline);
    if (blockCount > MAX_BLOCKS) throw new PageTooLongError();
    const state = Y.encodeStateAsUpdate(doc);
    if (state.length > MAX_PAGE_BYTES) throw new PageTooLongError();
    await tx
      .update(pageDocs)
      .set(changes(state, deriveCopies(doc, blockCount), stored, by))
      .where(eq(pageDocs.pageId, pageId));
  } finally {
    doc.destroy();
  }
}
