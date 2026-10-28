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
import { createPage, insertPage, MAX_DEPTH } from './pages';
import { getPrivateSpaceId, joinSpace } from './spaces';
import { listSubtree } from './tree';

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
    const archived = await move<Failure>(emery, shifts, { ...confirm, spaceId: floor.id });
    expect(archived.status).toBe(409);
    expect(archived.body.error.message).toMatch(/^This space is archived/);
  });

  it('lets nobody gain access by moving pages to another space (Roles spec, Stop inheriting)', async () => {
    const space = await newSpace({ name: 'Case files' });
    await joinSpace(db, space.id, emery.id);
    const cases = await make('Cases', { spaceId: space.id });
    const principal = { type: 'user' as const, id: emery.id };
    await grantAccess(db, { pageId: cases.id, principal, level: 'full', grantedBy: eli.id });
    const sealed = await make('Sealed case', { parentId: cases.id });
    await db.execute(sql`UPDATE pages SET inherit_access = false WHERE id = ${sealed.id}`);
    const spaceOf = async (id: string) =>
      (await db.execute<{ id: string }>(sql`SELECT space_id AS id FROM pages WHERE id = ${id}`))
        .rows[0]?.id;

    // Emery has Full access on Cases but can't open Sealed case, which her Private section opens.
    const emerys = await getPrivateSpaceId(db, emery.id, workspaceId);
    const toHers = { parentId: null, spaceId: emerys, confirmAccessChange: true };
    const refused = await move<Failure>(emery, cases, toHers);
    expect(refused.status).toBe(403);
    expect(JSON.stringify(refused.body)).not.toContain('Sealed');
    expect([await spaceOf(cases.id), await spaceOf(sealed.id)]).toEqual([space.id, space.id]);

    // The same for a closed page in Trash under it; once nothing is closed to her, it moves.
    await db.execute(sql`UPDATE pages SET inherit_access = true WHERE id = ${sealed.id}`);
    const binned = await make('Old case', { parentId: sealed.id });
    await db.execute(sql`
      UPDATE pages SET inherit_access = false, deleted_at = now() WHERE id = ${binned.id}`);
    expect((await move(emery, cases, toHers)).status).toBe(403);
    await db.execute(sql`UPDATE pages SET inherit_access = true WHERE id = ${binned.id}`);
    expect((await move(emery, cases, toHers)).status).toBe(200);
    expect(await spaceOf(binned.id)).toBe(emerys);

    // An Admin moving a page shared with them out of a Private section into a team space.
    const plan = await createPage(db, {
      workspaceId,
      kind: 'page',
      title: 'Personal plan',
      createdBy: emery.id,
    });
    const diary = await createPage(db, {
      workspaceId,
      parentId: plan.id,
      kind: 'page',
      title: 'Diary',
      createdBy: emery.id,
    });
    await db.execute(sql`UPDATE pages SET inherit_access = false WHERE id = ${diary.id}`);
    const toAdmin = { type: 'user' as const, id: admin.id };
    await grantAccess(db, {
      pageId: plan.id,
      principal: toAdmin,
      level: 'full',
      grantedBy: emery.id,
    });
    const toTeam = { parentId: null, spaceId: space.id, confirmAccessChange: true };
    expect((await move(admin, plan, toTeam)).status).toBe(403);
    expect(await spaceOf(diary.id)).toBe(emerys);
  });

  it('makes one move wait for another, so two moves at once make no loop', async () => {
    const space = await newSpace({ name: 'Two desks' });
    const deskA = await make('Desk A', { spaceId: space.id });
    const drawerA = await make('Drawer A', { parentId: deskA.id });
    const deskB = await make('Desk B', { spaceId: space.id });
    const drawerB = await make('Drawer B', { parentId: deskB.id });
    const both = await Promise.all([
      move(eli, deskA, { parentId: drawerB.id }),
      move(eli, deskB, { parentId: drawerA.id }),
    ]);
    expect(both.map((answer) => answer.status).sort()).toEqual([200, 400]);
  });

  it('refuses moves that would nest pages too deep', async () => {
    const space = await newSpace({ name: 'Deep stacks' });
    const add = (title: string, place: { spaceId?: string; parentId?: string }) =>
      insertPage(db, { workspaceId, ...place, kind: 'page', title, createdBy: eli.id });
    const levels = [await add('Level 1', { spaceId: space.id })];
    while (levels.length < MAX_DEPTH - 1) {
      levels.push(await add(`Level ${levels.length + 1}`, { parentId: levels.at(-1)!.id }));
    }
    const box = await make('Box', { spaceId: space.id });
    await make('Lid', { parentId: box.id });
    const tooDeep = await move<Failure>(eli, box, { parentId: levels.at(-1)!.id });
    expect(tooDeep.status).toBe(400);
    expect(tooDeep.body.error.message).toBe(`Pages can nest up to ${MAX_DEPTH} levels deep.`);
    expect((await move(eli, box, { parentId: levels.at(-2)!.id })).status).toBe(200);
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

    expect(
      (await move<Failure>(eli, draft, { parentId: null, spaceId: space.id })).body.error.message,
    ).toBe('3 people will gain access.');
    const confirmed = { parentId: null, spaceId: space.id, confirmAccessChange: true };
    expect((await move(eli, draft, confirmed)).body).toMatchObject({ spaceId: space.id });
    const back = await move<Failure>(eli, draft, { parentId: null, spaceId: draft.spaceId });
    expect(back.body.error.message).toBe('3 people will lose access.');
    const letters = await make('Letters', { spaceId: space.id });
    expect((await move(eli, draft, { parentId: letters.id })).status).toBe(200);

    // Pages under it that keep their own access count too: the Admin keeps the page through a
    // grant but loses the closed page under it, which a Private section doesn't open to Admins.
    const notes = await make('Board notes', { parentId: letters.id });
    await db.execute(sql`UPDATE pages SET inherit_access = false WHERE id = ${notes.id}`);
    const toAdmin = { type: 'user' as const, id: admin.id };
    await grantAccess(db, {
      pageId: letters.id,
      principal: toAdmin,
      level: 'view',
      grantedBy: eli.id,
    });
    const mine = await getPrivateSpaceId(db, eli.id, workspaceId);
    const counted = await move<Failure>(eli, letters, { parentId: null, spaceId: mine });
    expect(counted.body.error.details).toEqual({ losing: 3, gaining: 0 });
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
    const beds = await make('Beds', { parentId: plan.id }, { kind: 'database' });
    const bed = await make('Bed 1', { parentId: beds.id }, { kind: 'row' });
    const moved = await move(eli, plan, { parentId: null, spaceId: newWing.id });
    expect(moved.status).toBe(200);
    const { rows } = await db.execute<{ spaceId: string; parentId: string | null }>(sql`
      SELECT space_id AS "spaceId", parent_id AS "parentId" FROM pages
      WHERE id IN (${plan.id}, ${rooms.id}, ${binned.id}, ${beds.id}, ${bed.id})
      ORDER BY created_at, id`);
    expect(rows).toEqual([
      { spaceId: newWing.id, parentId: null },
      { spaceId: newWing.id, parentId: plan.id },
      { spaceId: newWing.id, parentId: rooms.id },
      { spaceId: newWing.id, parentId: plan.id },
      { spaceId: newWing.id, parentId: beds.id },
    ]);
  });

  it('lists a page and everything under it, parents first (listSubtree)', async () => {
    const space = await newSpace({ name: 'Archive desk' });
    const guide = await make('Guide', { spaceId: space.id });
    const second = await make('Second', { parentId: guide.id });
    const first = await make('First', { parentId: guide.id }, { index: 0 });
    const log = await make('Log', { parentId: first.id }, { kind: 'database', isInline: true });
    const entry = await make('Entry', { parentId: log.id }, { kind: 'row' });
    const gone = await make('Gone', { parentId: second.id });
    await db.execute(sql`UPDATE pages SET deleted_at = now() WHERE id = ${gone.id}`);

    const pages = await listSubtree(db, guide.id);
    expect(pages.map((page) => [page.title, page.depth, page.parentId])).toEqual([
      ['Guide', 0, null],
      ['First', 1, guide.id],
      ['Log', 2, first.id],
      ['Entry', 3, log.id],
      ['Second', 1, guide.id],
    ]);
    expect(pages[3]).toMatchObject({ id: entry.id, kind: 'row', archived: false });
    expect(await listSubtree(db, gone.id)).toEqual([]);
    expect(await listSubtree(db, 'not-a-page')).toEqual([]);
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
