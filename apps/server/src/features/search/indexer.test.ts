import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, createUser, hasDatabase, type TestApp, type TestUser } from '../../testing';
import { reindexForSearch, registerSearchText } from './index';
import { pageIdsOf } from './indexer';
import { bindSearchPages, type IndexPage } from './pages';
import { searchEntries } from './schema';
import { contentCursorStart, indexMissingPages, syncContent } from './sync';

/** The stand-in page model: each test's pages. */
const pages = new Map<string, IndexPage>();
const rowText = new Map<string, string>();
const workspaceId = randomUUID();
const support = randomUUID();
const billing = randomUUID();

type Bus = { emit(name: string, payload: unknown): void; settled(): Promise<void> };

describe('pageIdsOf', () => {
  it('reads pageId and pageIds and ignores anything else', () => {
    const [a, b] = [randomUUID(), randomUUID()];
    expect(pageIdsOf({ pageId: a, pageIds: [b, 'x', 3], title: 'Secret' })).toEqual([a, b]);
    expect(pageIdsOf(null)).toEqual([]);
    expect(pageIdsOf({ pageId: "x'; DROP TABLE pages" })).toEqual([]);
  });
});

describe.skipIf(!hasDatabase)('the search index on Postgres', () => {
  let test: TestApp;
  let sam: TestUser;
  let clock = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const unbind: (() => void)[] = [];

  beforeAll(async () => {
    test = await createTestApp();
    sam = await createUser(test.db, { name: 'Sam Ortiz', email: 'sam.ortiz@example.test' });
    unbind.push(
      bindSearchPages({
        getPagesForIndex: async (_db, ids) =>
          new Map(ids.flatMap((id) => (pages.has(id) ? [[id, pages.get(id)!] as const] : []))),
        listPageIds: async (_db, { afterId, limit }) =>
          [...pages.keys()]
            .sort()
            .filter((id) => afterId === null || id > afterId)
            .slice(0, limit),
      }),
      registerSearchText('row', async (_db, pageId) => rowText.get(pageId) ?? ''),
    );
  });
  afterAll(async () => {
    for (const off of unbind) off();
    await test?.close();
  });

  type PageOptions = Partial<IndexPage> & { text?: string; markdown?: string };
  async function addPage(title: string, options: PageOptions = {}): Promise<string> {
    const { text, markdown, ...fields } = options;
    const id = randomUUID();
    clock += 60_000;
    pages.set(id, {
      id,
      workspaceId,
      spaceId: support,
      parentId: fields.ancestorIds?.at(-1) ?? null,
      ancestorIds: [],
      kind: 'page',
      title,
      icon: { type: 'emoji', emoji: '📄' },
      createdBy: sam.id,
      createdAt: new Date(clock),
      updatedBy: sam.id,
      updatedAt: new Date(clock),
      archivedAt: null,
      trashed: false,
      ...fields,
    });
    if (text !== undefined || markdown !== undefined) await setText(id, text ?? '', markdown);
    await reindexForSearch(test.db, [id]);
    return id;
  }
  async function setText(pageId: string, text: string, markdown = '') {
    await test.db.execute(sql`
      INSERT INTO page_docs (page_id, state, text, markdown, text_updated_at)
      VALUES (${pageId}, ''::bytea, ${text}, ${markdown}, clock_timestamp())
      ON CONFLICT (page_id) DO UPDATE SET text = excluded.text, markdown = excluded.markdown,
        text_updated_at = excluded.text_updated_at`);
  }
  type Entry = {
    page_id: string;
    title: string;
    title_key: string;
    space_id: string | null;
    ancestors: string[];
    trashed: boolean;
  };
  async function entry(pageId: string): Promise<Entry | undefined> {
    const { rows } = await test.db.execute<Entry>(sql`
      SELECT page_id, title, title_key, space_id, ancestor_ids::text[] AS ancestors,
        trashed_at IS NOT NULL AS trashed
      FROM search_entries WHERE page_id = ${pageId}`);
    return rows[0];
  }
  /** Pages whose index entry matches `query`, a tsquery in the plain words configuration. */
  async function matching(query: string, weights = '{a,b,c,d}'): Promise<string[]> {
    const { rows } = await test.db.execute<{ title: string }>(sql`
      SELECT title FROM search_entries
      WHERE workspace_id = ${workspaceId} AND trashed_at IS NULL
        AND ts_filter(doc_tsv, ${weights}::"char"[]) @@ to_tsquery('simple', ${query})
      ORDER BY updated_at`);
    return rows.map((row) => row.title);
  }
  const events = () => test.app.events as unknown as Bus;

  it('mirrors its migration', async () => {
    const config = getTableConfig(searchEntries);
    type Column = { name: string; type: string; not_null: boolean; has_default: boolean };
    const { rows } = await test.db.execute<Column>(sql`
      SELECT attname AS name, format_type(atttypid, atttypmod) AS type,
        attnotnull AS not_null, atthasdef AS has_default
      FROM pg_attribute
      WHERE attrelid = ${config.name}::regclass AND attnum > 0 AND NOT attisdropped`);
    const inDatabase = Object.fromEntries(
      rows.map((row) => [
        row.name,
        { type: row.type, notNull: row.not_null, hasDefault: row.has_default },
      ]),
    );
    const inDrizzle = Object.fromEntries(
      config.columns.map((column) => [
        column.name,
        { type: column.getSQLType(), notNull: column.notNull, hasDefault: column.hasDefault },
      ]),
    );
    expect(inDatabase).toEqual(inDrizzle);
  });

  it('indexes titles, headings, text and row text, without case or accents', async () => {
    const team = await addPage('Team list: Felipe GONÇALVES', {
      text: 'Lead of the refund desk.\nShifts',
      markdown: '## Shifts',
    });
    const tickets = await addPage('Tickets', { kind: 'database' });
    const row = await addPage('Printer jam', { kind: 'row', ancestorIds: [tickets] });
    rowText.set(row, 'QA-17\nHigh');
    await reindexForSearch(test.db, [row]);

    expect(await entry(team)).toMatchObject({ title_key: 'team list felipe goncalves' });
    expect(await matching('goncalves')).toEqual(['Team list: Felipe GONÇALVES']);
    expect(await matching('goncalves', '{a}')).toEqual(['Team list: Felipe GONÇALVES']);
    expect(await matching('shifts', '{b}')).toEqual(['Team list: Felipe GONÇALVES']);
    expect(await matching('refund', '{a}')).toEqual([]);
    expect(await matching('refund')).toEqual(['Team list: Felipe GONÇALVES']);
    expect(await matching("'qa-17'")).toEqual(['Printer jam']);
    expect(await entry(row)).toMatchObject({ ancestors: [tickets], space_id: support });
  });

  it('follows renames, Trash, restoring and deleting (SR-09)', async () => {
    const id = await addPage('Return label');
    const child = await addPage('Label sizes', { ancestorIds: [id] });
    pages.set(id, { ...pages.get(id)!, title: 'Return sticker' });
    events().emit('page.updated', { pageId: id, workspaceId, by: sam.id });
    await events().settled();
    expect(await matching('sticker')).toEqual(['Return sticker']);

    events().emit('page.trashed', { pageId: id, workspaceId, by: sam.id });
    await events().settled();
    expect(await entry(id)).toMatchObject({ trashed: true });
    expect(await entry(child)).toMatchObject({ trashed: true });
    events().emit('page.restored', { pageId: id, workspaceId, by: sam.id });
    await events().settled();
    expect(await matching('sticker | sizes')).toEqual(['Return sticker', 'Label sizes']);

    pages.delete(id);
    pages.delete(child);
    events().emit('page.deleted', { pageId: id, workspaceId, by: sam.id });
    await events().settled();
    expect(await entry(id)).toBeUndefined();
    expect(await entry(child)).toBeUndefined();
  });

  it('keeps the pages under a moved page in their new place', async () => {
    const top = await addPage('Billing hub', { spaceId: billing });
    const page = await addPage('Refund page');
    const under = await addPage('Refund under', { ancestorIds: [page] });
    pages.set(page, { ...pages.get(page)!, spaceId: billing, parentId: top, ancestorIds: [top] });
    events().emit('page.updated', { pageId: page, workspaceId, by: sam.id });
    await events().settled();
    expect(await entry(page)).toMatchObject({ ancestors: [top], space_id: billing });
    expect(await entry(under)).toMatchObject({ ancestors: [top, page], space_id: billing });
  });

  it('picks up content edits and pages it missed', async () => {
    const id = await addPage('Holiday hours', { text: 'Closed on Monday.' });
    const cursor = await contentCursorStart(test.db);
    await setText(id, 'Open on Saturday.');
    const next = await syncContent(test.db, cursor);
    expect(next.at.getTime()).toBeGreaterThan(cursor.at.getTime());
    expect(await matching('saturday')).toEqual(['Holiday hours']);
    expect(await matching('monday')).toEqual([]);

    const missed = randomUUID();
    pages.set(missed, { ...pages.get(id)!, id: missed, title: 'Missed page' });
    await indexMissingPages(test.db);
    expect(await matching('missed')).toEqual(['Missed page']);
  });

  it('drops pages the page model no longer has, and indexes nothing without it', async () => {
    const id = await addPage('Short lived');
    pages.delete(id);
    await reindexForSearch(test.db, [id]);
    expect(await entry(id)).toBeUndefined();

    const kept = await addPage('Kept page');
    const off = unbind.shift();
    off?.();
    // The stand-in denies by default: no pages, so nothing stays in the index.
    await reindexForSearch(test.db, [kept]);
    expect(await entry(kept)).toBeUndefined();
  });
});
