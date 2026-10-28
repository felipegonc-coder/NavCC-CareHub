// Archiving and unarchiving pages on a real database (Page history and Trash 3.5, HT-14).
// Fictional people only.
import type {
  ArchivedPageJson,
  PageCardsJson,
  PageJson,
  PageTreeJson,
  SpaceJson,
} from '@carehub/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../db';
import { createTestApp, createUser, hasDatabase, injectAs, type TestUser } from '../../testing';
import { grantAccess } from './access';
import { getArchivedPageIds } from './archive';
import { createPage } from './pages';
import { joinSpace } from './spaces';

let app: Awaited<ReturnType<typeof createTestApp>>['app'];
let db: Db;
let close: () => Promise<void>;
let workspaceId: string;
let admin: TestUser, eli: TestUser, emery: TestUser;

async function call<T = PageJson>(who: TestUser, method: string, url: string, payload?: object) {
  const response = await injectAs(app, who, { method, url, payload });
  return { status: response.statusCode, body: (response.body ? response.json() : null) as T };
}
const newSpace = async (input: object) =>
  (await call<SpaceJson>(eli, 'POST', '/api/spaces', input)).body;
const make = (title: string, place: { spaceId?: string; parentId?: string }, more: object = {}) =>
  createPage(db, { workspaceId, ...place, kind: 'page', title, createdBy: eli.id, ...more });
const tree = (who: TestUser, spaceId: string) =>
  call<PageTreeJson>(who, 'GET', `/api/spaces/${spaceId}/tree`);
const move = (who: TestUser, page: { id: string }, body: object) =>
  call(who, 'POST', `/api/pages/${page.id}/move`, body);
const act = (who: TestUser, page: { id: string }, action: string) =>
  call<ArchivedPageJson>(who, 'POST', `/api/pages/${page.id}/${action}`);
const archivedError = {
  error: { code: 'conflict', message: 'This page is archived. Unarchive it first.' },
};

describe.skipIf(!hasDatabase)('archiving pages', () => {
  beforeAll(async () => {
    ({ app, db, close } = await createTestApp());
    admin = await createUser(db, { role: 'admin', name: 'Avery Admin' });
    eli = await createUser(db, { role: 'editor', name: 'Eli Editor' });
    emery = await createUser(db, { role: 'editor', name: 'Emery Editor' });
    workspaceId = admin.workspaceId!;
  });
  afterAll(() => close());

  it('archives a page with what is under it, read-only and out of the tree, until Unarchive (HT-14)', async () => {
    const space = await newSpace({ name: 'Projects' });
    await joinSpace(db, space.id, emery.id);
    const launch = await make('Launch plan', { spaceId: space.id });
    const tasks = await make('Tasks', { parentId: launch.id });
    const tracker = await make('Tracker', { parentId: launch.id }, { kind: 'database' });
    const row = await make('Call vendors', { parentId: tracker.id }, { kind: 'row' });
    const notes = await make('Notes', { parentId: tasks.id });
    const draft = await make('Old draft', { parentId: launch.id });
    await db.execute(sql`UPDATE pages SET deleted_at = now() WHERE id = ${draft.id}`);
    // Emery has Full on Tasks but not on Launch plan, the archive's root.
    const toEmery = { type: 'user' as const, id: emery.id };
    await grantAccess(db, {
      pageId: tasks.id,
      principal: toEmery,
      level: 'full',
      grantedBy: eli.id,
    });
    expect((await act(eli, notes, 'archive')).body).toMatchObject({ access: 'view', subPages: 0 });
    expect((await act(emery, launch, 'archive')).status).toBe(403);
    expect((await act(eli, row, 'archive')).status).toBe(400);

    const seen: { name: string; event: unknown }[] = [];
    const listen = (name: 'page.archived' | 'page.unarchived' | 'page.updated') =>
      app.events.on(name, (event) => {
        seen.push({ name, event });
      });
    const stops = [listen('page.archived'), listen('page.unarchived'), listen('page.updated')];
    const archived = await act(eli, launch, 'archive');
    await app.events.settled();
    expect(archived.body).toMatchObject({
      access: 'view',
      archivedBy: { id: eli.id },
      subPages: 4,
    });
    expect(archived.body.archivedAt).not.toBeNull();
    // Old draft, in Trash, goes along, so it comes back archived if it's restored.
    const pageIds = [launch.id, tasks.id, tracker.id, row.id, draft.id].sort();
    const listed = (name: string) =>
      seen
        .filter((entry) => entry.name === name)
        .map((entry) => entry.event as { pageId: string; pageIds?: string[]; changes?: string[] });
    expect(listed('page.archived')).toEqual([
      { pageId: launch.id, workspaceId, spaceId: space.id, pageIds: expect.any(Array), by: eli.id },
    ]);
    expect([...listed('page.archived')[0]!.pageIds!].sort()).toEqual(pageIds);
    const updated = listed('page.updated');
    expect(updated.every((event) => event.changes?.join() === 'archived')).toBe(true);
    expect(updated.map((event) => event.pageId).sort()).toEqual(pageIds);
    expect(await getArchivedPageIds(db, [launch.id, notes.id, draft.id, space.id])).toEqual(
      new Set([launch.id, notes.id, draft.id]),
    );

    // Read-only, out of the tree, but links and cards still open it.
    expect((await call(admin, 'GET', `/api/pages/${row.id}`)).body.access).toBe('view');
    const cards = await call<PageCardsJson>(emery, 'POST', '/api/pages/cards', {
      ids: [launch.id],
    });
    expect(cards.body.cards).toEqual([
      expect.objectContaining({ id: launch.id, title: 'Launch plan' }),
    ]);
    expect((await call(eli, 'PATCH', `/api/pages/${tasks.id}`, { title: 'Todo' })).status).toBe(
      403,
    );
    const under = await call(eli, 'POST', '/api/pages', { parentId: tasks.id });
    expect(under).toEqual({ status: 409, body: archivedError });
    await expect(
      make('Order supplies', { parentId: tracker.id }, { kind: 'row' }),
    ).rejects.toMatchObject({
      statusCode: 409,
    });
    const loose = await make('Loose ends', { spaceId: space.id });
    expect((await move(eli, loose, { parentId: tasks.id })).body).toEqual(archivedError);
    expect((await move(eli, tasks, { parentId: null, spaceId: space.id })).status).toBe(403);
    expect((await tree(eli, space.id)).body.nodes.map((node) => node.title)).toEqual([
      'Loose ends',
    ]);
    expect((await act(eli, launch, 'archive')).status).toBe(409);

    // Unarchive from any page in the archive brings back all of it; Notes keeps its own.
    seen.length = 0;
    expect((await act(eli, notes, 'unarchive')).status).toBe(409);
    expect((await act(emery, tasks, 'unarchive')).status).toBe(403);
    expect((await act(eli, tasks, 'unarchive')).body).toMatchObject({
      access: 'full',
      archivedAt: null,
      subPages: 4,
    });
    await app.events.settled();
    for (const stop of stops) stop();
    expect(listed('page.unarchived')).toEqual([
      { pageId: launch.id, workspaceId, spaceId: space.id, pageIds: expect.any(Array), by: eli.id },
    ]);
    expect([...listed('page.unarchived')[0]!.pageIds!].sort()).toEqual(pageIds);
    const titles = (await tree(eli, space.id)).body.nodes.map((node) => node.title);
    expect(titles).toEqual(['Launch plan', 'Tasks', 'Tracker', 'Loose ends']);
    expect((await act(eli, launch, 'unarchive')).status).toBe(409);
    expect((await act(eli, notes, 'unarchive')).body).toMatchObject({ access: 'full' });
  });

  it('answers 404 for missing pages and pages in Trash, and 409 in an archived space', async () => {
    const space = await newSpace({ name: 'Old projects' });
    const plan = await make('Spring plan', { spaceId: space.id });
    const binned = await make('Binned', { spaceId: space.id });
    await db.execute(sql`UPDATE pages SET deleted_at = now() WHERE id = ${binned.id}`);
    for (const id of ['not-a-page', '00000000-0000-4000-8000-000000000000', binned.id]) {
      expect((await act(eli, { id }, 'archive')).status).toBe(404);
    }
    await db.execute(sql`UPDATE spaces SET archived_at = now() WHERE id = ${space.id}`);
    const inArchivedSpace = await act(eli, plan, 'archive');
    expect(inArchivedSpace.status).toBe(409);
    expect(inArchivedSpace.body).toMatchObject({
      error: { message: expect.stringMatching(/space is archived/) },
    });
    expect((await act(emery, plan, 'archive')).status).toBe(403);
  });
});
