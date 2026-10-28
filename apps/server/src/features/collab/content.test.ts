import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, hasDatabase } from '../../testing';
import { MAX_PAGE_BYTES } from './check';
import {
  PageTooLongError,
  copyPageContent,
  getPageContent,
  getPageMarkdown,
  getPageText,
  setPageContent,
  setPageContentFromMarkdown,
} from './index';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;

let test: TestApp;
// page_docs has no foreign key to pages until the pages table is on main, so any ID will do.
const source = randomUUID();
const target = randomUUID();

const text = (value: string) => ({ type: 'text', text: value });

const MARKDOWN = '# Shift handover\n\n- [ ] Call the family\n\nRefunds go out on **Fridays**.\n';

interface Row {
  text: string;
  block_count: number;
  text_updated_at: Date;
}

async function row(pageId: string): Promise<Row | undefined> {
  const { rows } = await test.db.execute(
    sql`select text, block_count, text_updated_at from page_docs where page_id = ${pageId}`,
  );
  return rows[0] as Row | undefined;
}

beforeAll(async () => {
  if (hasDatabase) test = await createTestApp();
});

afterAll(async () => {
  await test?.close();
});

describe.skipIf(!hasDatabase)('page content for other features', { timeout: 30_000 }, () => {
  it('sets content from Markdown and keeps its copies', async () => {
    await test.db.transaction((tx) => setPageContentFromMarkdown(tx, source, MARKDOWN));
    expect(await getPageMarkdown(test.db, source)).toBe(MARKDOWN);
    expect(await getPageText(test.db, source)).toBe(
      'Shift handover\nCall the family\nRefunds go out on Fridays.',
    );
    expect(await row(source)).toMatchObject({ block_count: 3 });
  });

  it('copies one page into another', async () => {
    await test.db.transaction((tx) => copyPageContent(tx, source, target));
    expect(await getPageMarkdown(test.db, target)).toBe(MARKDOWN);
  });

  it('refuses a page over 20,000 blocks and keeps the old content', async () => {
    const before = await row(source);
    const long = Array.from({ length: 20_001 }, (_, index) => `Line ${index + 1}`).join('\n\n');
    const write = test.db.transaction((tx) => setPageContentFromMarkdown(tx, source, long));
    await expect(write).rejects.toBeInstanceOf(PageTooLongError);
    await expect(write).rejects.toMatchObject({ statusCode: 413, code: 'too_large' });
    expect(await getPageMarkdown(test.db, source)).toBe(MARKDOWN);
    expect(await row(source)).toEqual(before);
  });

  it('refuses Markdown longer than a page may be without reading it', async () => {
    const before = await row(source);
    // Read, blank lines would make an empty page: only their length can refuse them.
    const blank = '\n'.repeat(MAX_PAGE_BYTES + 1);
    const write = test.db.transaction((tx) => setPageContentFromMarkdown(tx, source, blank));
    await expect(write).rejects.toBeInstanceOf(PageTooLongError);
    expect(await row(source)).toEqual(before);
  });

  it('refuses a write that would take the page state past MAX_PAGE_BYTES', async () => {
    // Nothing measures JSON before it's read: the new state's size refuses it, as for copies.
    const text = 'Ward B, bed 4. '.repeat(Math.ceil(MAX_PAGE_BYTES / 15));
    const doc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    };
    const before = await row(source);
    const write = test.db.transaction((tx) => setPageContent(tx, source, doc));
    await expect(write).rejects.toBeInstanceOf(PageTooLongError);
    expect(await row(source)).toEqual(before);
  });

  it('sets and reads content as JSON, keeping only what the schema allows', async () => {
    const unsafe = { type: 'link', attrs: { href: 'javascript:alert(1)' } };
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2, onclick: 'alert(1)' }, content: [text('Rota')] },
        { type: 'paragraph', content: [{ ...text('Sam covers Ward B'), marks: [unsafe] }] },
        { type: 'script', content: [text('alert(1)')] },
      ],
    };
    await test.db.transaction((tx) => setPageContent(tx, target, doc));
    expect(await getPageContent(test.db, target)).toEqual({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [text('Rota')] },
        { type: 'paragraph', content: [text('Sam covers Ward B')] },
      ],
    });
    expect(await getPageMarkdown(test.db, target)).toBe('## Rota\n\nSam covers Ward B\n');
    const invalid = test.db.transaction((tx) => setPageContent(tx, target, [text('Rota')]));
    await expect(invalid).rejects.toMatchObject({ statusCode: 400, code: 'invalid' });
  });

  it('moves text_updated_at only when the text changes', async () => {
    const before = await row(source);
    const restyled = MARKDOWN.replace('**Fridays**', '*Fridays*');
    await test.db.transaction((tx) => setPageContentFromMarkdown(tx, source, restyled));
    expect((await row(source))?.text_updated_at).toEqual(before?.text_updated_at);
    const reworded = MARKDOWN.replace('Fridays', 'Mondays');
    await test.db.transaction((tx) => setPageContentFromMarkdown(tx, source, reworded));
    expect((await row(source))?.text_updated_at).not.toEqual(before?.text_updated_at);
  });
});
