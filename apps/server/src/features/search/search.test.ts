import { randomUUID } from 'node:crypto';
import { searchWords, type SearchResponse } from '@carehub/extras/search';
import type { AccessLevel } from '@carehub/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestApp,
  createUser,
  hasDatabase,
  injectAs,
  type TestApp,
  type TestUser,
} from '../../testing';
import { registerSearchBoost, registerSearchText, reindexForSearch, runSearch } from './index';
import { bindSearchMember, bindSearchPages, type IndexPage } from './pages';

/** The stand-in page model: each test's pages, and who can open them. */
const pages = new Map<string, IndexPage>();
const levels = new Map<string, Map<string, AccessLevel>>();
const rowText = new Map<string, string>();
const verified = new Set<string>();
const support = randomUUID();
const billing = randomUUID();
const spaceNames = new Map<string, string>([
  [support, 'Support'],
  [billing, 'Billing'],
]);

type Bus = { emit(name: string, payload: unknown): void; settled(): Promise<void> };

describe.skipIf(!hasDatabase)('search on Postgres', () => {
  let test: TestApp;
  let sam: TestUser;
  let avery: TestUser;
  let riley: TestUser;
  /** Each test searches its own workspace. */
  let workspaceId = randomUUID();
  let clock = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const unbind: (() => void)[] = [];

  beforeAll(async () => {
    test = await createTestApp();
    sam = await createUser(test.db, { name: 'Sam Ortiz', email: 'sam.ortiz@example.test' });
    avery = await createUser(test.db, { name: 'Avery Lin', email: 'avery.lin@example.test' });
    riley = await createUser(test.db, { name: 'Riley Chen', email: 'riley.chen@example.test' });
    unbind.push(
      bindSearchPages({
        getPagesForIndex: async (_db, ids) =>
          new Map(ids.flatMap((id) => (pages.has(id) ? [[id, pages.get(id)!] as const] : []))),
        getAccessForPages: async (_db, userId, ids) =>
          new Map(ids.map((id) => [id, levels.get(id)?.get(userId) ?? 'none'])),
        getSpaces: async (_db, _userId, ids) =>
          new Map(
            ids.flatMap((id) =>
              spaceNames.has(id) ? [[id, { name: spaceNames.get(id)! }] as const] : [],
            ),
          ),
      }),
      // Riley isn't in the workspace.
      bindSearchMember((request) =>
        request.user && request.user.id !== riley.id ? { workspaceId, isGuest: false } : null,
      ),
      registerSearchText('row', async (_db, pageId) => rowText.get(pageId) ?? ''),
      registerSearchBoost('test-verified', async (_db, { pageIds }) => {
        const found = pageIds.filter((id) => verified.has(id));
        return new Map(found.map((id) => [id, { verified: true }]));
      }),
    );
  });
  afterAll(async () => {
    for (const off of unbind) off();
    await test?.close();
  });
  beforeEach(() => {
    workspaceId = randomUUID();
  });

  type PageOptions = Partial<IndexPage> & { text?: string; markdown?: string; open?: TestUser[] };
  async function addPage(title: string, options: PageOptions = {}): Promise<string> {
    const { text, markdown, open = [sam, avery], ...fields } = options;
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
    levels.set(id, new Map(open.map((user) => [user.id, 'view'])));
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
  async function search(user: TestUser, body: Record<string, unknown>) {
    const response = await injectAs(test.app, user, {
      method: 'POST',
      url: '/api/search/query',
      payload: body,
    });
    expect(response.statusCode, response.body).toBe(200);
    return response.json<SearchResponse>();
  }
  const titles = async (user: TestUser, body: Record<string, unknown>) =>
    (await search(user, body)).results.map((result) => result.title);
  const events = () => test.app.events as unknown as Bus;

  it('finds beginnings, word forms and names without accents, in any case (SR-03)', async () => {
    await addPage('Refund steps', { text: 'Ask the customer for the order number.' });
    await addPage('Team list', { text: 'Lúcia Assunção leads the refund desk.' });
    await addPage('Shipping times');
    expect(await titles(sam, { text: 'ref' })).toEqual(['Refund steps', 'Team list']);
    expect(await titles(sam, { text: 'REFUNDS ' })).toEqual(['Refund steps', 'Team list']);
    const [found] = (await search(sam, { text: 'assuncao' })).results;
    expect(found).toMatchObject({ title: 'Team list', path: ['Support'], kind: 'page' });
    expect(found?.snippet?.text).toBe('Lúcia Assunção leads the refund desk.');
    expect(found?.snippet?.ranges).toEqual([[6, 14]]);
    expect(found?.editedBy).toEqual({ id: sam.id, name: 'Sam Ortiz' });
    expect(found?.icon).toEqual({ type: 'emoji', emoji: '📄' });
  });

  it('reads quotes, minus, OR and IDs like QA-17 (SR-04)', async () => {
    await addPage('Refund steps', { text: 'Refund steps for damaged items.' });
    await addPage('Refund draft', { text: 'Steps to refund, still a draft.' });
    await addPage('Exchanges');
    const tickets = await addPage('Tickets', { kind: 'database' });
    const row = await addPage('Printer jam', { kind: 'row', ancestorIds: [tickets] });
    rowText.set(row, 'QA-17\nHigh');
    await reindexForSearch(test.db, [row]);

    expect(await titles(sam, { text: '"refund steps"' })).toEqual(['Refund steps']);
    expect(await titles(sam, { text: 'refund -draft' })).toEqual(['Refund steps']);
    expect(await titles(sam, { text: 'exchanges OR draft ' })).toEqual([
      'Exchanges',
      'Refund draft',
    ]);
    const [qa] = (await search(sam, { text: 'QA-17' })).results;
    expect(qa).toMatchObject({ title: 'Printer jam', kind: 'row', rowIn: 'Tickets' });
    expect(qa?.path).toEqual(['Support', 'Tickets']);
    expect(await titles(sam, { text: 'qa-1' })).toEqual(['Printer jam']);
    expect(await titles(sam, { text: '-draft' })).toEqual([]);
  });

  it('ranks title matches, then headings, then text; ✓ Verified first, then the newest edit (SR-05)', async () => {
    await addPage('Notes', { text: 'refund steps' });
    await addPage('Guide', { text: 'Intro\nRefund steps', markdown: '# Refund steps' });
    await addPage('Steps to refund');
    await addPage('Refund steps for returns');
    await addPage('Refund steps');
    expect(await titles(sam, { text: 'refund steps ' })).toEqual([
      'Refund steps',
      'Refund steps for returns',
      'Steps to refund',
      'Guide',
      'Notes',
    ]);

    const older = await addPage('Damaged parcel', { text: 'lighthouse' });
    await addPage('Lost parcel', { text: 'lighthouse' });
    expect(await titles(sam, { text: 'lighthouse' })).toEqual(['Lost parcel', 'Damaged parcel']);
    verified.add(older);
    expect(await titles(sam, { text: 'lighthouse' })).toEqual(['Damaged parcel', 'Lost parcel']);
    const [first] = (await search(sam, { text: 'lighthouse' })).results;
    expect(first?.verified).toBe(true);
  });

  it('applies each filter and sort, alone and together (SR-06)', async () => {
    const guide = await addPage('Harbor guide', { updatedBy: avery.id });
    const child = await addPage('Harbor child', { ancestorIds: [guide], createdBy: avery.id });
    await addPage('Harbor billing', { spaceId: billing, createdBy: avery.id });
    const board = await addPage('Harbor board', { kind: 'database', updatedBy: avery.id });
    await addPage('Harbor row', { kind: 'row', ancestorIds: [board] });
    await addPage('Notes', { text: 'harbor in the text only' });
    await addPage('Harbor archive', { archivedAt: new Date() });
    const all = [
      'Harbor guide',
      'Harbor child',
      'Harbor billing',
      'Harbor board',
      'Harbor row',
      'Notes',
    ];

    const sorted = (sort: string, filters = {}) => titles(sam, { text: 'harbor', sort, filters });
    expect(await sorted('edited_asc')).toEqual(all);
    expect(await sorted('edited_desc')).toEqual([...all].reverse());
    expect(await sorted('created_asc')).toEqual(all);
    expect(await sorted('created_desc')).toEqual([...all].reverse());
    expect(await sorted('edited_asc', { in: [billing] })).toEqual(['Harbor billing']);
    expect(await sorted('edited_asc', { in: [guide] })).toEqual(['Harbor guide', 'Harbor child']);
    expect(await sorted('edited_asc', { createdBy: [avery.id] })).toEqual([
      'Harbor child',
      'Harbor billing',
    ]);
    expect(await sorted('edited_asc', { types: ['database', 'row'] })).toEqual([
      'Harbor board',
      'Harbor row',
    ]);
    expect(await sorted('edited_asc', { types: ['file'] })).toEqual([]);
    expect(await sorted('edited_asc', { titleOnly: true })).toEqual(all.slice(0, 5));
    expect((await sorted('edited_asc', { includeArchived: true })).at(-1)).toBe('Harbor archive');
    const from = pages.get(child)?.updatedAt.toISOString();
    expect(await sorted('edited_asc', { date: { field: 'edited', from } })).toEqual(all.slice(1));
    expect(await sorted('edited_desc', { in: [support], editedBy: [avery.id] })).toEqual([
      'Harbor board',
      'Harbor guide',
    ]);
  });

  it('counts, ranks and shows only pages the person can open (SR-07, SR-08)', async () => {
    const bands = await addPage('Pay bands', { text: 'salary table', open: [sam] });
    await addPage('Pay review', { text: 'review dates' });
    await addPage('Pay calendar', { ancestorIds: [bands], open: [sam, avery] });
    expect(await titles(sam, { text: 'pay' })).toHaveLength(3);
    const forAvery = await search(avery, { text: 'pay' });
    expect(forAvery.total).toBe(2);
    expect(forAvery.results.map((result) => result.title).sort()).toEqual([
      'Pay calendar',
      'Pay review',
    ]);
    // The parent Avery can't open stays out of the path.
    expect(forAvery.results.find((result) => result.title === 'Pay calendar')?.path).toEqual([
      'Support',
    ]);
    expect(await search(avery, { text: 'salary' })).toEqual({
      results: [],
      total: 0,
      nextCursor: null,
    });
    // A crafted filter for a page Avery can't open finds nothing from it.
    expect(await titles(avery, { text: 'pay', filters: { in: [bands] } })).toEqual([]);
    expect(await titles(avery, { text: 'pay', filters: { in: [randomUUID()] } })).toEqual([]);
    // Losing access removes results at once.
    levels.get(bands)?.delete(sam.id);
    expect(await titles(sam, { text: 'salary' })).toEqual([]);
  });

  it('finds new names and hides Trash at once (SR-09)', async () => {
    const id = await addPage('Return label');
    await addPage('Label sizes', { ancestorIds: [id] });
    pages.set(id, { ...pages.get(id)!, title: 'Return sticker' });
    events().emit('page.updated', { pageId: id, workspaceId, by: sam.id });
    await events().settled();
    expect(await titles(sam, { text: 'sticker' })).toEqual(['Return sticker']);
    expect(await titles(sam, { text: 'return label' })).toEqual([]);

    events().emit('page.trashed', { pageId: id, workspaceId, by: sam.id });
    await events().settled();
    expect(await titles(sam, { text: 'sticker OR sizes' })).toEqual([]);
    events().emit('page.restored', { pageId: id, workspaceId, by: sam.id });
    await events().settled();
    expect((await titles(sam, { text: 'sticker OR sizes' })).sort()).toEqual([
      'Label sizes',
      'Return sticker',
    ]);
  });

  it('hides archived pages unless the Archived filter is on, at once (SR-06, SR-09)', async () => {
    const rota = await addPage('Old rota', { text: 'night shifts' });
    const notes = await addPage('Rota notes', { ancestorIds: [rota] });
    // The page model reports the pages under an archived page as archived too.
    for (const id of [rota, notes]) pages.set(id, { ...pages.get(id)!, archivedAt: new Date() });
    events().emit('page.archived', { pageId: rota, workspaceId, by: sam.id });
    await events().settled();
    expect(await titles(sam, { text: 'rota' })).toEqual([]);
    const archived = await search(sam, { text: 'rota', filters: { includeArchived: true } });
    expect(archived.results.map((result) => [result.title, result.archived])).toEqual([
      ['Rota notes', true],
      ['Old rota', true],
    ]);

    for (const id of [rota, notes]) pages.set(id, { ...pages.get(id)!, archivedAt: null });
    events().emit('page.unarchived', { pageId: rota, workspaceId, by: sam.id });
    await events().settled();
    expect(await titles(sam, { text: 'rota' })).toEqual(['Rota notes', 'Old rota']);
  });

  it("finds any of the words with match: 'any', more of them first (Claude spec 3.3)", async () => {
    await addPage('Client list', { text: 'Names and phone numbers.' });
    await addPage('Refund policy', { text: 'How refunds work for every client.' });
    await addPage('Refund desk notes', { open: [sam] });
    await addPage('Shipping times');
    const text = searchWords('How do I refund a client?').join(' ');
    expect(text).toBe('refund client');
    expect(await titles(avery, { text })).toEqual(['Refund policy']);
    expect(await titles(avery, { text, match: 'any' })).toEqual(['Refund policy', 'Client list']);
    // What other features call: the same access checks, without the page Avery can't open.
    const found = await runSearch(
      test.db,
      { userId: avery.id, workspaceId },
      { text, match: 'any' },
    );
    expect(found.total).toBe(2);
    expect(found.results.map((result) => result.title)).toEqual(['Refund policy', 'Client list']);
    expect((await titles(sam, { text, match: 'any' })).sort()).toEqual([
      'Client list',
      'Refund desk notes',
      'Refund policy',
    ]);
  });

  it('answers 20 results at a time', async () => {
    for (let n = 1; n <= 25; n += 1) await addPage(`Checklist ${n}`);
    const first = await search(sam, { text: 'checklist', sort: 'created_asc' });
    expect(first.results).toHaveLength(20);
    expect(first).toMatchObject({ total: 25, nextCursor: '20' });
    const second = await search(sam, { text: 'checklist', sort: 'created_asc', cursor: '20' });
    expect(second.results.map((result) => result.title)).toEqual(
      [21, 22, 23, 24, 25].map((n) => `Checklist ${n}`),
    );
    expect(second.nextCursor).toBeNull();
  });

  it('needs a workspace membership and valid input', async () => {
    const outsider = await injectAs(test.app, riley, {
      method: 'POST',
      url: '/api/search/query',
      payload: { text: 'pay' },
    });
    expect(outsider.statusCode).toBe(403);
    expect(outsider.json()).toEqual({
      error: { code: 'forbidden', message: "You don't have access to this." },
    });
    const invalid = await injectAs(test.app, sam, {
      method: 'POST',
      url: '/api/search/query',
      payload: { text: 'pay', filters: { in: ['not-an-id'] } },
    });
    expect(invalid.statusCode).toBe(400);
    const signedOut = await test.app.inject({
      method: 'POST',
      url: '/api/search/query',
      payload: {},
    });
    expect(signedOut.statusCode).toBe(401);
  });
});
