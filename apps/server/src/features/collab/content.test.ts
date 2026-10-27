import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, hasDatabase } from '../../testing';
import {
  PageTooLongError,
  copyPageContent,
  getPageMarkdown,
  getPageText,
  setPageContentFromMarkdown,
} from './index';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;

let test: TestApp;
// page_docs has no foreign key to pages until the pages table is on main, so any ID will do.
const source = randomUUID();
const target = randomUUID();

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
