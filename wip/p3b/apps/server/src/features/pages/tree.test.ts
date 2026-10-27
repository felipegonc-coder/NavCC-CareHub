// The sidebar tree, moving pages and live nudges on a real database (Sidebar spec 3.2 and 5;
// Pages and blocks 3.2). Fictional people only.
import type { PageJson, PageTreeJson, SpaceJson } from '@carehub/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../db';
import { createTestApp, createUser, hasDatabase, injectAs, type TestUser } from '../../testing';
import { liveHub } from '../live';
import { grantAccess } from './access';
import { changePageKind } from './move';
import { createPage } from './pages';
import { getPrivateSpaceId, joinSpace } from './spaces';

let app: Awaited<ReturnType<typeof createTestApp>>['app'];
let db: Db;
let close: () => Promise<void>;
let workspaceId: string;
let admin: TestUser, eli: TestUser, emery: TestUser, val: TestUser, olive: TestUser;

type Failure = { error: { code: string; message: string; details?: unknown } };
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
const move = <T = PageJson>(who: TestUser, page: { id: string }, body: object) =>
  call<T>(who, 'POST', `/api/pages/${page.id}/move`, body);

describe.skipIf(!hasDatabase)('the page tree and moving pages', () => {
  beforeAll(async () => {
    ({ app, db, close } = await createTestApp());
    admin = await createUser(db, { role: 'admin', name: 'Avery Admin' });
    eli = await createUser(db, { role: 'editor', name: 'Eli Editor' });
    emery = await createUser(db, { role: 'editor', name: 'Emery Editor' });
    val = await createUser(db, { role: 'viewer', name: 'Val Viewer' });
    olive = await createUser(db, { role: 'editor', name: 'Olive Outsider' });
    workspaceId = admin.workspaceId!;
  });
  afterAll(() => close());

  it('builds each person their tree: depth first, no rows, nothing they cannot open (SB-06, SB-10)', async () => {
    const space = await newSpace({ name: 'Front desk' });
    for (const who of [emery, val]) await joinSpace(db, space.id, who.id);
    const policies = await make('Policies', { spaceId: space.id });
    await make('Refund steps', { parentId: policies.id });
    const intake = await make('Intake', { parentId: policies.id }, { index: 0 });
    await make('Checklist', { parentId: policies.id }, { kind: 'database', isInline: true });
    const clients = await make('Clients', { spaceId: space.id }, { kind: 'database' });
    await make('Rowan Reyes', { parentId: clients.id }, { kind: 'row' });
    const hr = await make('HR notes', { spaceId: space.id });
    const roster = await make('Roster', { parentId: hr.id });
    await db.execute(sql`UPDATE pages SET inherit_access = false WHERE id = ${hr.id}`);
    const principal = { type: 'user' as const, id: emery.id };
    await grantAccess(db, { pageId: roster.id, principal, level: 'view', grantedBy: admin.id });

    const titles = (nodes: PageTreeJson['nodes']) => nodes.map((node) => node.title);
    const forAdmin = (await tree(admin, space.id)).body.nodes;
    const all = ['Policies', 'Intake', 'Refund steps', 'Clients', 'HR notes', 'Roster'];
    expect(titles(forAdmin)).toEqual(all);
    expect(forAdmin.every((node) => node.access === 'full' && !node.pathHidden)).toBe(true);

    const forEmery = (await tree(emery, space.id)).body.nodes;
    expect(titles(forEmery)).toEqual(['Policies', 'Intake', 'Refund steps', 'Clients', 'Roster']);
    expect(forEmery[0]).toMatchObject({ id: policies.id, parentId: null, hasChildren: true });
    expect(forEmery[1]).toMatchObject({ id: intake.id, parentId: policies.id, access: 'edit' });
    expect(forEmery[3]).toMatchObject({ id: clients.id, kind: 'database', hasChildren: false });
    expect(forEmery[4]).toEqual({
      id: roster.id,
      parentId: null,
      kind: 'page',
      title: 'Roster',
      icon: null,
      position: roster.position,
      hasChildren: false,
      access: 'view',
      pathHidden: true,
    });
    expect(JSON.stringify(forEmery)).not.toContain('HR notes');
    expect(JSON.stringify(forEmery)).not.toContain(hr.id);

    const forVal = (await tree(val, space.id)).body.nodes;
    expect(titles(forVal)).toEqual(['Policies', 'Intake', 'Refund steps', 'Clients']);
    expect(forVal.every((node) => node.access === 'view')).toBe(true);

    // Not in the space: 403; a Private space or someone else's Private section: 404; guests: 403.
    expect((await tree(olive, space.id)).status).toBe(403);
    const board = await newSpace({ name: 'Board', kind: 'private' });
    expect((await tree(olive, board.id)).status).toBe(404);
    const elisOwn = await getPrivateSpaceId(db, eli.id, workspaceId);
    expect((await tree(emery, elisOwn)).status).toBe(404);
    expect((await tree(eli, elisOwn)).status).toBe(200);
    const guest = await createUser(db, { kind: 'guest', name: 'Gray Guest' });
    expect((await tree(guest, space.id)).status).toBe(403);
  });

  it('moves pages onto, above and below others, and to the top of a space (SB-03)', async () => {
    const space = await newSpace({ name: 'Billing' });
    const claims = await make('Claims', { spaceId: space.id });
    const refunds = await make('Refunds', { spaceId: space.id });
    const appeals = await make('Appeals', { parentId: claims.id });

    const onto = await move(eli, refunds, { parentId: claims.id });
    expect(onto.status).toBe(200);
    expect(onto.body).toMatchObject({ parentId: claims.id, spaceId: space.id });
    expect(onto.body.ancestors).toEqual([{ id: claims.id, title: 'Claims', icon: null }]);
    expect(onto.body.position > appeals.position).toBe(true);
    const above = await move(eli, refunds, { parentId: claims.id, index: 0 });
    expect(above.body.position < appeals.position).toBe(true);
    const top = await move(eli, refunds, { parentId: null, spaceId: space.id, index: 0 });
    expect(top.body).toMatchObject({ parentId: null, ancestors: [] });
    expect(top.body.position < claims.position).toBe(true);
    const order = (await tree(eli, space.id)).body.nodes.map((node) => node.title);
    expect(order).toEqual(['Refunds', 'Claims', 'Appeals']);

    // Never inside itself, and a place is needed.
    expect((await move(eli, claims, { parentId: appeals.id })).status).toBe(400);
    expect((await move(eli, claims, { parentId: claims.id })).status).toBe(400);
    expect((await move(eli, claims, { parentId: null })).status).toBe(400);
    const other = await newSpace({ name: 'Other' });
    expect((await move(eli, claims, { parentId: appeals.id, spaceId: other.id })).status).toBe(400);
    const missing = { parentId: '00000000-0000-4000-8000-000000000000' };
    expect((await move(eli, claims, missing)).status).toBe(404);

    // An inline database stays on a page; a database never goes in a database.
    const inline = await make(
      'Tasks',
      { parentId: claims.id },
      { kind: 'database', isInline: true },
    );
    expect((await move(eli, inline, { parentId: null, spaceId: space.id })).status).toBe(400);
    expect((await move(eli, inline, { parentId: refunds.id })).body.parentId).toBe(refunds.id);
    const ledger = await make('Ledger', { spaceId: space.id }, { kind: 'database' });
    expect((await move(eli, ledger, { parentId: inline.id })).status).toBe(400);
  });

  it('needs Full access on the page and Can edit where it goes (SB-08)', async () => {
    const space = await newSpace({ name: 'Scheduling' });
    await joinSpace(db, space.id, emery.id);
    const shifts = await make('Shifts', { spaceId: space.id });
    const rotas = await make('Rotas', { spaceId: space.id });
    expect((await move(emery, shifts, { parentId: rotas.id })).status).toBe(403);
    const principal = { type: 'user' as const, id: emery.id };
    await grantAccess(db, { pageId: shifts.id, principal, level: 'full', grantedBy: eli.id });
    expect((await move(emery, shifts, { parentId: rotas.id })).status).toBe(200);

    // A space where Emery can only view, or one she isn't in.
    const confirm = { parentId: null, confirmAccessChange: true };
    const handbook = await newSpace({ name: 'Staff handbook', defaultAccess: 'view' });
    await joinSpace(db, handbook.id, emery.id);
    expect((await move(emery, shifts, { ...confirm, spaceId: handbook.id })).status).toBe(403);
    const payroll = await newSpace({ name: 'Payroll', kind: 'closed' });
    expect((await move(emery, shifts, { ...confirm, spaceId: payroll.id })).status).toBe(403);

    // Owners only at the top, a locked parent, an archived space, a space that keeps its pages.
    await call(eli, 'PATCH', `/api/spaces/${space.id}`, { ownersOnlyTopLevel: true });
    expect((await move(emery, shifts, { parentId: null, spaceId: space.id })).status).toBe(403);
    await call(eli, 'PATCH', `/api/spaces/${space.id}`, { ownersOnlyTopLevel: false });
    await call(eli, 'PATCH', `/api/pages/${rotas.id}`, { locked: true });
    const locked = await move<Failure>(emery, shifts, { parentId: rotas.id, index: 0 });
    expect(locked.status).toBe(403);
    expect(locked.body.error.message).toBe('This page is locked. Unlock it to change it.');
    const floor = await newSpace({ name: 'Open floor' });
    await joinSpace(db, floor.id, emery.id);
    await call(eli, 'PATCH', `/api/spaces/${space.id}`, { allowMoveOut: false });
    const kept = await move<Failure>(emery, shifts, { ...confirm, spaceId: floor.id });
    expect(kept.status).toBe(403);
    expect(kept.body.error.message).toBe("This space's pages can't be moved to other spaces.");
    await call(eli, 'PATCH', `/api/spaces/${space.id}`, { allowMoveOut: true });
    await call(eli, 'PATCH', `/api/spaces/${floor.id}`, { archived: true });
    expect((await move(emery, shifts, { ...confirm, spaceId: floor.id })).status).toBe(409);
  });

  it('asks first when a move changes who can open the page (SB-04)', async () => {
    const space = await newSpace({ name: 'Outreach' });
    for (const who of [emery, val]) await joinSpace(db, space.id, who.id);
    const draft = (await call(eli, 'POST', '/api/pages', { title: 'Draft letter' })).body;
    const asked = await move<Failure>(eli, draft, { parentId: null, spaceId: space.id });
    expect(asked.status).toBe(409);
    expect(asked.body).toEqual({
      error: {
        code: 'conflict',
        message: '3 people will gain access.',
        details: { losing: 0, gaining: 3 },
      },
    });
    expect((await call(eli, 'GET', `/api/pages/${draft.id}`)).body.spaceId).toBe(draft.spaceId);

    const confirmed = { parentId: null, spaceId: space.id, confirmAccessChange: true };
    expect((await move(eli, draft, confirmed)).body).toMatchObject({ spaceId: space.id });
    const back = await move<Failure>(eli, draft, { parentId: null, spaceId: draft.spaceId });
    expect(back.body.error.message).toBe('3 people will lose access.');
    const letters = await make('Letters', { spaceId: space.id });
    expect((await move(eli, draft, { parentId: letters.id })).status).toBe(200);
  });

  it('turns a page moved into a database into a row, and back (page.kindChanged)', async () => {
    const space = await newSpace({ name: 'Intake desk' });
    const clients = await make('Clients', { spaceId: space.id }, { kind: 'database' });
    const visits = await make('Visits', { spaceId: space.id }, { kind: 'database' });
    const rowan = await make('Rowan Reyes', { spaceId: space.id });
    const seen: unknown[] = [];
    const stop = app.events.on('page.kindChanged', (event) => {
      seen.push(event);
    });
    const into = await move(eli, rowan, { parentId: clients.id });
    expect(into.body).toMatchObject({ kind: 'row', parentId: clients.id });
    expect((await move(eli, rowan, { parentId: visits.id })).status).toBe(400);
    const out = await move(eli, rowan, { parentId: null, spaceId: space.id });
    expect(out.body).toMatchObject({ kind: 'page', parentId: null });
    await app.events.settled();
    stop();
    expect(seen).toEqual([
      { pageId: rowan.id, workspaceId, from: 'page', to: 'row', by: eli.id },
      { pageId: rowan.id, workspaceId, from: 'row', to: 'page', by: eli.id },
    ]);

    expect((await move(eli, visits, { parentId: clients.id })).status).toBe(400);
    const toTop = { kind: 'row' as const, parentId: null, spaceId: space.id };
    await expect(
      db.transaction((tx) => changePageKind(tx, rowan.id, toTop, eli.id)),
    ).rejects.toMatchObject({ statusCode: 400 });
    const toRow = { kind: 'row' as const, parentId: clients.id };
    expect(await db.transaction((tx) => changePageKind(tx, rowan.id, toRow, eli.id))).toEqual({
      pageId: rowan.id,
      from: 'page',
      to: 'row',
    });
  });

  it('takes sub-pages, rows and pages in Trash along to another space', async () => {
    const oldWing = await newSpace({ name: 'Old wing' });
    const newWing = await newSpace({ name: 'New wing' });
    const plan = await make('Floor plan', { spaceId: oldWing.id });
    const rooms = await make('Rooms', { parentId: plan.id });
    const binned = await make('Old rooms', { parentId: rooms.id });
    await db.execute(sql`UPDATE pages SET deleted_at = now() WHERE id = ${binned.id}`);
    const moved = await move(eli, plan, { parentId: null, spaceId: newWing.id });
    expect(moved.status).toBe(200);
    const { rows } = await db.execute<{ spaceId: string; parentId: string | null }>(sql`
      SELECT space_id AS "spaceId", parent_id AS "parentId" FROM pages
      WHERE id IN (${plan.id}, ${rooms.id}, ${binned.id}) ORDER BY created_at, id`);
    expect(rows).toEqual([
      { spaceId: newWing.id, parentId: null },
      { spaceId: newWing.id, parentId: plan.id },
      { spaceId: newWing.id, parentId: rooms.id },
    ]);
  });

  it('nudges the trees and pages people have open, with IDs only (SB-05)', async () => {
    const space = await newSpace({ name: 'Dispatch' });
    await joinSpace(db, space.id, emery.id);
    const oncall = await make('On call', { spaceId: space.id });
    const frames: string[] = [];
    const sink = (into: string[]) => ({
      write: (frame: string) => {
        into.push(frame);
        return true;
      },
      end: () => {},
    });
    const tab = liveHub.connect(emery.id, sink(frames));
    const outsider = liveHub.connect(olive.id, sink([]));
    const topics = [`space:${space.id}`, `page:${oncall.id}`];
    const subscribe = (userId: string, connectionId: string) =>
      liveHub.updateTopics({ userId, connectionId, add: topics });
    expect((await subscribe(emery.id, tab.id))?.results.map((r) => r.ok)).toEqual([true, true]);
    expect((await subscribe(olive.id, outsider.id))?.results.map((r) => r.ok)).toEqual([
      false,
      false,
    ]);

    await call(eli, 'PATCH', `/api/pages/${oncall.id}`, { title: 'On call rota' });
    const sent = frames.join('');
    expect(sent).toContain('tree-changed');
    expect(sent).toContain('page-changed');
    expect(sent).not.toContain('On call rota');
    tab.disconnect();
    outsider.disconnect();
  });
});
