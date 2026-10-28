// Trash on a real database: moving to Trash, Undo, restoring into a page in Trash, who sees what,
// deleting for good and the cleanup (Page history and Trash 3.4 and 5). Fictional people only.
import type { PageJson, PageTreeJson, SpaceJson, TrashJson } from '@carehub/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../db';
import { createTestApp, createUser, hasDatabase, injectAs, type TestUser } from '../../testing';
import { createPage } from './pages';
import { getPrivateSpaceId, joinSpace } from './spaces';
import { purgeTrash, trashPage, trashPages } from './trash';

let app: Awaited<ReturnType<typeof createTestApp>>['app'];
let db: Db;
let close: () => Promise<void>;
let workspaceId: string;
let admin: TestUser, eli: TestUser, emery: TestUser;

type Failure = { error: { code: string; message: string; details?: unknown } };
async function call<T = PageJson>(who: TestUser, method: string, url: string, payload?: object) {
  const response = await injectAs(app, who, { method, url, payload });
  return { status: response.statusCode, body: (response.body ? response.json() : null) as T };
}
const newSpace = async (name: string) =>
  (await call<SpaceJson>(eli, 'POST', '/api/spaces', { name })).body;
const make = (title: string, place: { spaceId?: string; parentId?: string }, more: object = {}) =>
  createPage(db, { workspaceId, ...place, kind: 'page', title, createdBy: eli.id, ...more });
const trash = (who: TestUser, page: { id: string }) => call(who, 'DELETE', `/api/pages/${page.id}`);
const restore = <T = null>(who: TestUser, id: string, body: object = {}) =>
  call<T>(who, 'POST', `/api/trash/${id}/restore`, body);
const list = async (who: TestUser, query = '') =>
  (await call<TrashJson>(who, 'GET', `/api/trash${query}`)).body.entries;
const titles = async (who: TestUser, spaceId: string) =>
  (await call<PageTreeJson>(who, 'GET', `/api/spaces/${spaceId}/tree`)).body.nodes.map(
    (node) => node.title,
  );

describe.skipIf(!hasDatabase)('Trash', () => {
  beforeAll(async () => {
    ({ app, db, close } = await createTestApp());
    admin = await createUser(db, { role: 'admin', name: 'Avery Admin' });
    eli = await createUser(db, { role: 'editor', name: 'Eli Editor' });
    emery = await createUser(db, { role: 'editor', name: 'Emery Editor' });
    workspaceId = admin.workspaceId!;
  });
  afterAll(() => close());

  it('moves a page with everything under it to Trash as one entry; Undo puts it back (HT-09)', async () => {
    const space = await newSpace('Help line');
    const policies = await make('Policies', { spaceId: space.id });
    const refund = await make('Refund steps', { parentId: policies.id });
    const checklist = await make(
      'Checklist',
      { parentId: policies.id },
      { kind: 'database', isInline: true },
    );
    await make('Rowan Reyes', { parentId: checklist.id }, { kind: 'row' });
    const trashed: string[][] = [];
    const stop = app.events.on('page.trashed', (event) => void trashed.push(event.pageIds));

    expect((await trash(eli, policies)).status).toBe(204);
    await app.events.settled();
    stop();
    expect(trashed).toHaveLength(1);
    expect(trashed[0]).toHaveLength(4);
    expect((await call(eli, 'GET', `/api/pages/${policies.id}`)).status).toBe(404);
    expect((await call(eli, 'GET', `/api/pages/${refund.id}`)).status).toBe(404);
    expect(await titles(eli, space.id)).toEqual([]);

    const [entry] = await list(eli);
    expect(entry).toMatchObject({
      id: policies.id,
      type: 'page',
      title: 'Policies',
      space: { id: space.id, name: 'Help line', kind: 'open' },
      ancestors: [],
      subPages: 2,
      rows: 1,
      deletedBy: { id: eli.id, name: 'Eli Editor' },
      canDeleteForever: true,
    });
    const days = (Date.parse(entry!.deletesAt) - Date.parse(entry!.deletedAt)) / 86_400_000;
    expect(days).toBe(30);
    expect((await call<TrashJson>(eli, 'GET', '/api/trash')).body.retentionDays).toBe(30);
    expect(await list(eli, '?q=polic')).toHaveLength(1);
    expect(await list(eli, '?q=nothing')).toHaveLength(0);
    expect(await list(eli, '?type=database')).toHaveLength(0);

    expect((await restore(eli, policies.id)).status).toBe(204);
    const back = await call(eli, 'GET', `/api/pages/${policies.id}`);
    expect(back.status).toBe(200);
    expect(back.body).toMatchObject({ position: policies.position, deletedAt: null });
    expect(await titles(eli, space.id)).toEqual(['Policies', 'Refund steps']);
    expect((await call(eli, 'GET', `/api/pages/${refund.id}`)).status).toBe(200);
    expect(await list(eli, `?spaceId=${space.id}`)).toHaveLength(0);
  });

  it('asks before restoring into a page in Trash: Restore both or Move to… (HT-10)', async () => {
    const space = await newSpace('Welcome desk');
    const policies = await make('Policies', { spaceId: space.id });
    const refund = await make('Refund steps', { parentId: policies.id });
    const intake = await make('Intake', { parentId: policies.id });
    await trash(eli, intake);
    await trash(eli, policies);
    const entries = await list(eli, `?spaceId=${space.id}`);
    expect(entries.map((entry) => entry.title)).toEqual(['Policies', 'Intake']);
    expect(entries[0]).toMatchObject({ subPages: 1 });
    expect(entries[1]?.ancestors).toEqual([{ id: policies.id, title: 'Policies', icon: null }]);

    const asked = await restore<Failure>(eli, intake.id);
    expect(asked.status).toBe(409);
    expect(asked.body.error.message).toBe(
      'Policies is in Trash too. Restore it as well, or move Intake somewhere else?',
    );
    expect(asked.body.error.details).toEqual({ type: 'page', id: policies.id, title: 'Policies' });
    // A page that went to Trash with its parent asks the same.
    expect((await restore<Failure>(eli, refund.id)).status).toBe(409);
    const both = { withParents: true, moveTo: { parentId: null, spaceId: space.id } };
    expect((await restore(eli, intake.id, both)).status).toBe(400);

    expect((await restore(eli, intake.id, { withParents: true })).status).toBe(204);
    expect(await titles(eli, space.id)).toEqual(['Policies', 'Refund steps', 'Intake']);

    await trash(eli, policies);
    const moveTo = { parentId: null, spaceId: space.id };
    expect((await restore(eli, refund.id, { moveTo })).status).toBe(204);
    expect(await titles(eli, space.id)).toEqual(['Refund steps']);
    const page = (await call(eli, 'GET', `/api/pages/${refund.id}`)).body;
    expect(page).toMatchObject({ parentId: null, spaceId: space.id });
    expect((await list(eli, `?spaceId=${space.id}`)).map((entry) => entry.subPages)).toEqual([1]);
  });

  it('shows an entry to who deleted it and people with Full access, never a Private page (HT-13, HT-15)', async () => {
    const space = await newSpace('Night shift');
    await joinSpace(db, space.id, emery.id);
    const roster = await make('Roster', { spaceId: space.id });
    await trash(eli, roster);

    expect((await list(emery)).map((entry) => entry.id)).not.toContain(roster.id);
    const refused = await restore<Failure>(emery, roster.id);
    expect(refused.status).toBe(403);
    expect(JSON.stringify(refused.body)).not.toContain('Roster');
    expect((await call(emery, 'DELETE', `/api/trash/${roster.id}`)).status).toBe(403);
    expect((await trash(emery, await make('Shift notes', { spaceId: space.id }))).status).toBe(403);
    const forAdmin = (await list(admin)).find((entry) => entry.id === roster.id);
    expect(forAdmin).toMatchObject({ canDeleteForever: true, deletedBy: { id: eli.id } });

    const diary = await make('Diary', {
      spaceId: await getPrivateSpaceId(db, eli.id, workspaceId),
    });
    await trash(eli, diary);
    expect((await list(eli)).map((entry) => entry.id)).toContain(diary.id);
    expect((await list(admin)).map((entry) => entry.id)).not.toContain(diary.id);
    expect((await restore(admin, diary.id)).status).toBe(403);
    expect((await restore(eli, '00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await restore(eli, (await make('Live', { spaceId: space.id })).id)).status).toBe(404);
  });

  it('deletes for good with everything under it, and cleans up after the period (HT-11, HT-12)', async () => {
    const space = await newSpace('Past projects');
    const plan = await make('Plan', { spaceId: space.id });
    const steps = await make('Steps', { parentId: plan.id });
    await trash(eli, plan);
    const deleted: string[][] = [];
    const stop = app.events.on('page.deleted', (event) => void deleted.push(event.pageIds));
    expect((await call(eli, 'DELETE', `/api/trash/${plan.id}`)).status).toBe(204);
    await app.events.settled();
    stop();
    expect(deleted[0]?.sort()).toEqual([plan.id, steps.id].sort());
    const { rows } = await db.execute(
      sql`SELECT 1 FROM pages WHERE id IN (${plan.id}, ${steps.id})`,
    );
    expect(rows).toHaveLength(0);
    expect((await restore(eli, plan.id)).status).toBe(404);

    const old = await make('Old notes', { spaceId: space.id });
    const recent = await make('Recent notes', { spaceId: space.id });
    await trashPage(db, old.id, eli.id);
    await trashPage(db, recent.id, eli.id);
    await db.execute(sql`
      UPDATE pages SET deleted_at = now() - interval '31 days' WHERE id = ${old.id}`);
    const gone = await purgeTrash(db);
    expect(gone.map((entry) => entry.pageId)).toEqual([old.id]);
    expect((await list(eli, `?spaceId=${space.id}`)).map((entry) => entry.id)).toEqual([recent.id]);
  });

  it('moves several pages to Trash as one entry, and brings them back or deletes them together', async () => {
    const space = await newSpace('Import desk');
    const guide = await make('Guide', { spaceId: space.id });
    const faq = await make('FAQ', { spaceId: space.id });
    const answers = await make('Answers', { parentId: faq.id });
    const entry = await trashPages(db, [guide.id, faq.id], eli.id);
    expect(entry).toMatchObject({ pageId: guide.id, spaceId: space.id });
    expect(entry.pageIds.sort()).toEqual([guide.id, faq.id, answers.id].sort());
    expect(await list(eli, `?spaceId=${space.id}`)).toMatchObject([{ id: guide.id, subPages: 2 }]);
    expect(await titles(eli, space.id)).toEqual([]);

    expect((await restore(eli, guide.id)).status).toBe(204);
    expect(await titles(eli, space.id)).toEqual(['Guide', 'FAQ', 'Answers']);

    await trashPages(db, [guide.id, faq.id], eli.id);
    expect((await call(eli, 'DELETE', `/api/trash/${guide.id}`)).status).toBe(204);
    const { rows } = await db.execute(sql`SELECT 1 FROM pages WHERE space_id = ${space.id}`);
    expect(rows).toHaveLength(0);
  });

  it('keeps a deleted space as one entry for its owners and Admins, and brings it back', async () => {
    const space = await newSpace('Archive room');
    await joinSpace(db, space.id, emery.id);
    await make('Boxes', { spaceId: space.id });
    expect((await call(eli, 'DELETE', `/api/spaces/${space.id}`)).status).toBe(204);
    const [entry] = await list(eli, '?type=space');
    expect(entry).toMatchObject({
      id: space.id,
      type: 'space',
      title: 'Archive room',
      subPages: 1,
    });
    expect((await list(emery, '?type=space')).map((item) => item.id)).not.toContain(space.id);
    expect((await restore(emery, space.id)).status).toBe(403);

    const twin = await newSpace('Archive room');
    expect((await restore<Failure>(eli, space.id)).status).toBe(409);
    await call(eli, 'DELETE', `/api/spaces/${twin.id}`);
    expect((await restore(eli, space.id)).status).toBe(204);
    expect(await titles(eli, space.id)).toEqual(['Boxes']);

    await call(eli, 'DELETE', `/api/spaces/${space.id}`);
    expect((await call(eli, 'DELETE', `/api/trash/${space.id}`)).status).toBe(204);
    const { rows } = await db.execute(sql`SELECT 1 FROM pages WHERE space_id = ${space.id}`);
    expect(rows).toHaveLength(0);
  });
});
