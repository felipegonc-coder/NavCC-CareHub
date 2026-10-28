// Archiving and unarchiving pages on a real database (Page history and Trash 3.5, HT-14).
// Fictional people only.
import type { PageJson, PageTreeJson, SpaceJson } from '@carehub/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../db';
import { createTestApp, createUser, hasDatabase, injectAs, type TestUser } from '../../testing';
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
    const act = (who: TestUser, page: { id: string }, action: string) =>
      call(who, 'POST', `/api/pages/${page.id}/${action}`);
    expect((await act(eli, notes, 'archive')).body).toMatchObject({ access: 'view' });
    expect((await act(emery, launch, 'archive')).status).toBe(403);
    expect((await act(eli, row, 'archive')).status).toBe(400);

    const seen: unknown[] = [];
    const stop = app.events.on('page.archived', (event) => {
      seen.push(event);
    });
    const archived = await act(eli, launch, 'archive');
    await app.events.settled();
    stop();
    expect(archived.body).toMatchObject({ access: 'view', archivedBy: { id: eli.id } });
    expect(archived.body.archivedAt).not.toBeNull();
    const pageIds = [launch.id, tasks.id, tracker.id, row.id];
    expect(seen).toEqual([
      { pageId: launch.id, workspaceId, spaceId: space.id, pageIds: expect.any(Array), by: eli.id },
    ]);
    expect([...(seen[0] as { pageIds: string[] }).pageIds].sort()).toEqual(pageIds.sort());
    expect((await call(admin, 'GET', `/api/pages/${row.id}`)).body.access).toBe('view');
    expect((await call(eli, 'PATCH', `/api/pages/${tasks.id}`, { title: 'Todo' })).status).toBe(
      403,
    );
    expect((await call(eli, 'POST', '/api/pages', { parentId: tasks.id })).status).toBe(403);
    expect((await move(eli, tasks, { parentId: null, spaceId: space.id })).status).toBe(403);
    expect((await tree(eli, space.id)).body.nodes).toEqual([]);
    expect((await act(eli, launch, 'archive')).status).toBe(409);

    // Unarchive from any page in the archive brings back all of it; Notes keeps its own.
    expect((await act(eli, notes, 'unarchive')).status).toBe(409);
    expect((await act(emery, tasks, 'unarchive')).status).toBe(403);
    expect((await act(eli, tasks, 'unarchive')).body).toMatchObject({
      access: 'full',
      archivedAt: null,
    });
    const titles = (await tree(eli, space.id)).body.nodes.map((node) => node.title);
    expect(titles).toEqual(['Launch plan', 'Tasks', 'Tracker']);
    expect((await act(eli, launch, 'unarchive')).status).toBe(409);
    expect((await act(eli, notes, 'unarchive')).body).toMatchObject({ access: 'full' });
  });
});
