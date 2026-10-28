// Page blocks on a real database: deleting a page block moves its page to Trash and Undo brings
// it back, for people with Full access (Pages and blocks 3.3 and 3.4; Page history and Trash 3.2,
// HT-06). Fictional people only.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../db';
import { createTestApp, createUser, hasDatabase, type TestUser } from '../../testing';
import { setPageContent, type PageContent } from '../collab';
import { syncPageBlocks } from './blocks';
import { movePage } from './move';
import { createPage } from './pages';
import { createSpace, joinSpace } from './spaces';

let app: Awaited<ReturnType<typeof createTestApp>>['app'];
let db: Db;
let close: () => Promise<void>;
let workspaceId: string;
let spaceId: string;
let admin: TestUser, eli: TestUser, emery: TestUser;

type Page = { id: string };
const doc = (...content: object[]) => ({ type: 'doc', content }) as PageContent;
const block = (page: Page) => ({ type: 'page', attrs: { pageId: page.id } });
const text = (words: string) => ({ type: 'paragraph', content: [{ type: 'text', text: words }] });
const mention = (page: Page) => ({
  type: 'paragraph',
  content: [{ type: 'mention', attrs: { pageId: page.id } }],
});
const make = (title: string, place: { spaceId?: string; parentId?: string }, more: object = {}) =>
  createPage(db, { workspaceId, ...place, kind: 'page', title, createdBy: eli.id, ...more });
const sync = (page: Page, users: TestUser[], content: PageContent) =>
  db.transaction((tx) =>
    syncPageBlocks(tx, page.id, { userIds: users.map((user) => user.id), content }),
  );
const none = { trashed: [], restored: [] };
async function state(page: Page) {
  const { rows } = await db.execute<{ deleted: boolean; held: boolean }>(sql`
    SELECT deleted_at IS NOT NULL AS deleted, block_parent_id IS NOT NULL AS held
    FROM pages WHERE id = ${page.id}`);
  return rows[0];
}

describe.skipIf(!hasDatabase)('page blocks', () => {
  beforeAll(async () => {
    ({ app, db, close } = await createTestApp());
    admin = await createUser(db, { role: 'admin', name: 'Avery Admin' });
    eli = await createUser(db, { role: 'editor', name: 'Eli Editor' });
    emery = await createUser(db, { role: 'editor', name: 'Emery Editor' });
    workspaceId = admin.workspaceId!;
    spaceId = await createSpace(db, { workspaceId, name: 'Help line', createdBy: eli.id });
    await joinSpace(db, spaceId, emery.id);
  });
  afterAll(() => close());

  it('moves a page to Trash with its sub-pages when its block goes, and back on Undo', async () => {
    const policies = await make('Policies', { spaceId });
    const refund = await make('Refund steps', { parentId: policies.id });
    const step = await make('Step one', { parentId: refund.id });
    expect(await sync(policies, [eli], doc(text('Read first'), block(refund)))).toEqual(none);
    expect(await state(refund)).toEqual({ deleted: false, held: true });

    const gone = await sync(policies, [eli], doc(text('Read first')));
    expect(gone.restored).toEqual([]);
    expect(gone.trashed).toEqual([
      { pageId: refund.id, workspaceId, spaceId, pageIds: expect.any(Array), by: eli.id },
    ]);
    expect(gone.trashed[0]?.pageIds.sort()).toEqual([refund.id, step.id].sort());
    expect(await state(refund)).toEqual({ deleted: true, held: false });
    expect(await state(step)).toEqual({ deleted: true, held: false });
    // Saves without the block leave it in Trash.
    expect(await sync(policies, [eli], doc(text('Read this first')))).toEqual(none);

    const back = await sync(policies, [eli], doc(text('Read this first'), block(refund)));
    expect(back.trashed).toEqual([]);
    expect(back.restored).toEqual([
      { pageId: refund.id, workspaceId, spaceId, pageIds: expect.any(Array), by: eli.id },
    ]);
    expect(await state(refund)).toEqual({ deleted: false, held: true });
    expect(await state(step)).toEqual({ deleted: false, held: false });
  });

  it('needs Full access from everyone who changed the content', async () => {
    const roster = await make('Roster', { spaceId });
    const shifts = await make('Shifts', { parentId: roster.id });
    // Emery can edit (the space's default) but has no Full access: the page stays, unheld, and
    // later saves don't move it either.
    await sync(roster, [emery], doc(block(shifts)));
    expect(await sync(roster, [eli, emery], doc())).toEqual(none);
    expect(await state(shifts)).toEqual({ deleted: false, held: false });
    expect(await sync(roster, [eli], doc())).toEqual(none);
    expect(await state(shifts)).toEqual({ deleted: false, held: false });

    // Eli deletes it. Emery putting the block back doesn't restore it, nor does it later.
    await sync(roster, [eli], doc(block(shifts)));
    expect((await sync(roster, [eli], doc())).trashed).toHaveLength(1);
    expect(await sync(roster, [emery], doc(block(shifts)))).toEqual(none);
    expect(await state(shifts)).toEqual({ deleted: true, held: true });
    expect(await sync(roster, [eli], doc(block(shifts)))).toEqual(none);
    expect(await state(shifts)).toEqual({ deleted: true, held: true });
  });

  it('lets whoever deleted the block undo it without Full access', async () => {
    const desk = await createSpace(db, { workspaceId, name: 'Front desk', createdBy: admin.id });
    await joinSpace(db, desk, eli.id);
    const visits = await make('Visits', { spaceId: desk });
    const today = await make('Today', { parentId: visits.id });
    await sync(visits, [eli], doc(block(today)));
    expect((await sync(visits, [eli], doc())).trashed).toHaveLength(1);
    // Eli's own grants (as creator) go; the space gives Can edit.
    await db.execute(sql`DELETE FROM access_grants WHERE principal_id = ${eli.id}
      AND page_id IN (${visits.id}, ${today.id})`);
    expect((await sync(visits, [eli], doc(block(today)))).restored).toHaveLength(1);
    expect(await state(today)).toEqual({ deleted: false, held: true });
  });

  it('keeps a page whose block became a mention', async () => {
    const guide = await make('Guide', { spaceId });
    const faq = await make('FAQ', { parentId: guide.id });
    await sync(guide, [eli], doc(block(faq)));
    expect(await sync(guide, [eli], doc(mention(faq)))).toEqual(none);
    expect(await state(faq)).toEqual({ deleted: false, held: false });
  });

  it('only notes the blocks when no one changed the content, as after a version restore (HT-06)', async () => {
    const notes = await make('Notes', { spaceId });
    const kept = await make('Kept', { parentId: notes.id });
    const binned = await make('Binned', { parentId: notes.id });
    await sync(notes, [eli], doc(block(kept), block(binned)));
    expect((await sync(notes, [eli], doc(block(kept)))).trashed).toHaveLength(1);
    // An older version without Kept's block and with Binned's: neither page moves.
    expect(await sync(notes, [], doc(block(binned)))).toEqual(none);
    expect(await state(kept)).toEqual({ deleted: false, held: false });
    expect(await state(binned)).toEqual({ deleted: true, held: true });
    expect(await sync(notes, [eli], doc(block(binned)))).toEqual(none);
    expect(await state(binned)).toEqual({ deleted: true, held: true });
  });

  it("holds only the page's own sub-pages, and lets go of one moved away", async () => {
    const north = await make('North team', { spaceId });
    const south = await make('South team', { spaceId });
    const handbook = await make('Handbook', { parentId: north.id });
    await sync(north, [eli], doc(block(handbook)));
    // A block on another page holds nothing there.
    expect(await sync(south, [eli], doc(block(handbook)))).toEqual(none);
    await db.transaction((tx) => movePage(tx, handbook.id, { parentId: south.id }, eli.id));
    expect(await sync(north, [eli], doc())).toEqual(none);
    expect(await state(handbook)).toEqual({ deleted: false, held: false });
    expect(await sync(south, [eli], doc(block(handbook)))).toEqual(none);
    expect(await state(handbook)).toEqual({ deleted: false, held: true });
  });

  it('runs after each live save (page.contentSaved), inline databases included', async () => {
    const board = await make('Board', { spaceId });
    const tasks = await make('Tasks', { parentId: board.id }, { kind: 'database', isInline: true });
    const seen: string[] = [];
    const stops = [
      app.events.on('page.trashed', (event) => void seen.push(`trashed ${event.pageId}`)),
      app.events.on('page.restored', (event) => void seen.push(`restored ${event.pageId}`)),
    ];
    const save = async (content: PageContent) => {
      await db.transaction((tx) => setPageContent(tx, board.id, content));
      app.events.emit('page.contentSaved', { pageId: board.id, userIds: [eli.id] });
      await app.events.settled();
    };
    const table = { type: 'database', attrs: { databaseId: tasks.id } };
    await save(doc(text('This week'), table));
    expect(await state(tasks)).toEqual({ deleted: false, held: true });
    await save(doc(text('This week')));
    expect(await state(tasks)).toEqual({ deleted: true, held: false });
    await save(doc(text('This week'), table));
    expect(await state(tasks)).toEqual({ deleted: false, held: true });
    for (const stop of stops) stop();
    expect(seen).toEqual([`trashed ${tasks.id}`, `restored ${tasks.id}`]);
  });
});
