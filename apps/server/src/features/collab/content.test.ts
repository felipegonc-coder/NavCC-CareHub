import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, createUser } from '../../testing';
import { createPage, getPrivateSpaceId } from '../pages';
import {
  PageTooLongError,
  copyPageContent,
  getPageMarkdown,
  getPageText,
  setPageContentFromMarkdown,
} from './index';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;

let test: TestApp;
let source = '';
let target = '';

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
  test = await createTestApp();
  const owner = await createUser(test.db, { role: 'editor', name: 'Robin Example' });
  const spaceId = await getPrivateSpaceId(test.db, owner.id);
  const { rows } = await test.db.execute(
    sql`select workspace_id from spaces where id = ${spaceId}`,
  );
  const create = (title: string) =>
    createPage(test.db, {
      workspaceId: String(rows[0]?.workspace_id),
      spaceId,
      kind: 'page',
      title,
      createdBy: owner.id,
    });
  source = (await create('Shift handover')).id;
  target = (await create('Handover copy')).id;
});

afterAll(async () => {
  await test?.close();
});

describe('page content for other features', { timeout: 30_000 }, () => {
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
