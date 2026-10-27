import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createTestApp, createUser, hasDatabase, type TestApp } from '../../testing';
import { pageDocs } from './schema';
import { getPageText, loadState, saveDoc, setLiveDocs } from './store';
import { pageFragment, readContent, replaceContent, toText, toYNodes } from './ydoc';

// page_docs has no foreign key to pages until the pages table is on main, so any ID will do.
let test: TestApp;
let editorId = '';

function lines(...texts: string[]) {
  return texts.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] }));
}

function docWith(...texts: string[]): Y.Doc {
  const doc = new Y.Doc();
  replaceContent(doc, lines(...texts));
  return doc;
}

async function savedRow(pageId: string) {
  const [row] = await test.db.select().from(pageDocs).where(eq(pageDocs.pageId, pageId));
  if (!row) throw new Error('The page has no page_docs row.');
  return row;
}

async function storedDoc(pageId: string): Promise<Y.Doc> {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, (await loadState(test.db, pageId)) ?? new Uint8Array());
  return doc;
}

beforeAll(async () => {
  if (!hasDatabase) return;
  test = await createTestApp();
  editorId = (await createUser(test.db, { name: 'Robin Example' })).id;
});

afterEach(() => setLiveDocs(() => undefined));

afterAll(async () => {
  await test?.close();
});

describe.skipIf(!hasDatabase)('page document storage', () => {
  it('creates the row on the first save', async () => {
    const pageId = randomUUID();
    expect(await loadState(test.db, pageId)).toBeNull();
    const copies = await saveDoc(test.db, pageId, docWith('Shift notes'), editorId);
    expect(copies).toMatchObject({ text: 'Shift notes', blockCount: 1 });
    expect(await savedRow(pageId)).toMatchObject({
      text: 'Shift notes',
      blockCount: 1,
      updatedBy: editorId,
    });
    expect(toText(readContent(await storedDoc(pageId)))).toBe('Shift notes');
  });

  it('keeps a change written to the row after the open document loaded', async () => {
    const pageId = randomUUID();
    await saveDoc(test.db, pageId, docWith('First line'), editorId);
    const live = await storedDoc(pageId);
    // Another feature (an import, say) changes the stored page while it's open.
    const other = await storedDoc(pageId);
    pageFragment(other).insert(1, toYNodes(lines('From an import')));
    await saveDoc(test.db, pageId, other, null);
    // The open page is saved with its own edit, and the import's line survives.
    pageFragment(live).insert(0, toYNodes(lines('Typed live')));
    const copies = await saveDoc(test.db, pageId, live, editorId);
    expect(copies.text).toBe('Typed live\nFirst line\nFrom an import');
    expect(toText(readContent(live))).toBe(copies.text);
    expect(await savedRow(pageId)).toMatchObject({
      text: copies.text,
      blockCount: 3,
      updatedBy: editorId,
    });
  });

  it('moves text_updated_at only when the text changes', async () => {
    const pageId = randomUUID();
    const doc = docWith('Medication round');
    const block = pageFragment(doc).get(0) as Y.XmlElement;
    await saveDoc(test.db, pageId, doc, editorId);
    const first = await savedRow(pageId);
    await sleep(20);
    block.setAttribute('textAlign', 'center');
    await saveDoc(test.db, pageId, doc, editorId);
    const second = await savedRow(pageId);
    await sleep(20);
    (block.get(0) as Y.XmlText).insert(0, 'Evening ');
    await saveDoc(test.db, pageId, doc, editorId);
    const third = await savedRow(pageId);

    expect(second.textUpdatedAt).toEqual(first.textUpdatedAt);
    expect(second.updatedAt.getTime()).toBeGreaterThan(first.updatedAt.getTime());
    expect(third.text).toBe('Evening Medication round');
    expect(third.textUpdatedAt.getTime()).toBeGreaterThan(first.textUpdatedAt.getTime());
  });

  it('reads the text from the open document, or else from the row', async () => {
    const pageId = randomUUID();
    await saveDoc(test.db, pageId, docWith('Saved text'), editorId);
    const live = docWith('Unsaved edit');
    setLiveDocs((id) => (id === pageId ? live : undefined));
    expect(await getPageText(test.db, pageId)).toBe('Unsaved edit');
    setLiveDocs(() => undefined);
    expect(await getPageText(test.db, pageId)).toBe('Saved text');
    expect(await getPageText(test.db, randomUUID())).toBe('');
  });
});
