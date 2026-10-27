// Pages on a real database (Pages and blocks 3.1 and 5; Sidebar spec 5): making, opening and
// changing pages, breadcrumbs, locks and page cards. Fictional people only.
import type { PageCardsJson, PageJson, SpaceJson } from '@carehub/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../db';
import { createTestApp, createUser, hasDatabase, injectAs, type TestUser } from '../../testing';
import { grantAccess } from './access';
import { getPageCards } from './cards';
import { createPage } from './pages';
import { getPrivateSpaceId, joinSpace } from './spaces';

let app: Awaited<ReturnType<typeof createTestApp>>['app'];
let db: Db;
let close: () => Promise<void>;
let workspaceId: string;
let admin: TestUser, eli: TestUser, emery: TestUser, casey: TestUser, val: TestUser;
let olive: TestUser;
let team: SpaceJson;

type Method = 'GET' | 'POST' | 'PATCH';
async function call<T = PageJson>(who: TestUser, method: Method, url: string, payload?: object) {
  const response = await injectAs(app, who, { method, url, payload });
  return { status: response.statusCode, body: (response.body ? response.json() : null) as T };
}
const newPage = (who: TestUser, input: object = {}) => call(who, 'POST', '/api/pages', input);
const newSpace = async (who: TestUser, input: object) =>
  (await call<SpaceJson>(who, 'POST', '/api/spaces', input)).body;
const make = (title: string, place: { spaceId?: string; parentId?: string }) =>
  createPage(db, { workspaceId, ...place, kind: 'page', title, createdBy: eli.id });

describe.skipIf(!hasDatabase)('pages', () => {
  beforeAll(async () => {
    ({ app, db, close } = await createTestApp());
    admin = await createUser(db, { role: 'admin', name: 'Avery Admin' });
    eli = await createUser(db, { role: 'editor', name: 'Eli Editor' });
    emery = await createUser(db, { role: 'editor', name: 'Emery Editor' });
    casey = await createUser(db, { role: 'commenter', name: 'Casey Commenter' });
    val = await createUser(db, { role: 'viewer', name: 'Val Viewer' });
    olive = await createUser(db, { role: 'editor', name: 'Olive Outsider' });
    workspaceId = admin.workspaceId!;
    team = await newSpace(eli, { name: 'Clinic ops' });
    for (const who of [emery, casey, val]) await joinSpace(db, team.id, who.id);
  });
  afterAll(() => close());

  it('makes pages in the Private section, at the top of a space or under a page', async () => {
    const mine = await newPage(eli, { title: 'Notes' });
    expect(mine.status).toBe(201);
    expect(mine.body).toMatchObject({
      kind: 'page',
      title: 'Notes',
      parentId: null,
      access: 'full',
      ancestors: [],
      space: { id: await getPrivateSpaceId(db, eli.id, workspaceId), kind: 'personal' },
      createdBy: { id: eli.id, name: 'Eli Editor' },
      updatedBy: { id: eli.id, name: 'Eli Editor' },
      font: 'default',
      smallText: false,
      textDirection: 'ltr',
      fullWidth: false,
      lockedBy: null,
      deletedAt: null,
    });
    expect(mine.body.createdAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);

    const top = await newPage(eli, { spaceId: team.id, title: 'Policies' });
    expect(top.body).toMatchObject({ spaceId: team.id, access: 'full' });
    expect(top.body.space).toEqual({ id: team.id, name: 'Clinic ops', icon: null, kind: 'open' });
    const last = await newPage(emery, { parentId: top.body.id, title: 'Refund steps' });
    const first = await newPage(emery, { parentId: top.body.id, title: 'Intake', index: 0 });
    expect(first.body.position < last.body.position).toBe(true);
    expect(last.body).toMatchObject({ access: 'edit', parentId: top.body.id, spaceId: team.id });
    expect(last.body.ancestors).toEqual([{ id: top.body.id, title: 'Policies', icon: null }]);
    expect((await newPage(eli, { title: 'Two\nlines' })).body.title).toBe('Two lines');
  });

  it('needs the Create permission, the space and Can edit where the page goes (RP-05, SB-08)', async () => {
    expect((await newPage(casey)).status).toBe(403);
    expect((await newPage(val, { spaceId: team.id })).status).toBe(403);
    const guest = await createUser(db, { kind: 'guest', name: 'Gray Guest' });
    expect((await newPage(guest)).status).toBe(403);

    // Not in an Open space: 403. A Private space or someone else's Private section: 404.
    expect((await newPage(olive, { spaceId: team.id })).status).toBe(403);
    const leadership = await newSpace(eli, { name: 'Leadership', kind: 'private' });
    expect((await newPage(olive, { spaceId: leadership.id })).status).toBe(404);
    const elisOwn = await getPrivateSpaceId(db, eli.id, workspaceId);
    expect((await newPage(olive, { spaceId: elisOwn })).status).toBe(404);
    expect((await newPage(admin, { spaceId: leadership.id })).status).toBe(201);
    expect((await newPage(eli, { spaceId: '00000000-0000-4000-8000-000000000000' })).status).toBe(
      404,
    );

    // "Owners only" at the top level; sub-pages still follow their parent.
    const policies = await make('Handover', { spaceId: team.id });
    await call(eli, 'PATCH', `/api/spaces/${team.id}`, { ownersOnlyTopLevel: true });
    expect((await newPage(emery, { spaceId: team.id })).status).toBe(403);
    expect((await newPage(emery, { parentId: policies.id })).status).toBe(201);
    expect((await newPage(eli, { spaceId: team.id })).status).toBe(201);
    await call(eli, 'PATCH', `/api/spaces/${team.id}`, { ownersOnlyTopLevel: false });

    // Members who can only view don't add pages; archived spaces take none.
    const handbook = await newSpace(eli, { name: 'Handbook', defaultAccess: 'view' });
    await joinSpace(db, handbook.id, emery.id);
    expect((await newPage(emery, { spaceId: handbook.id })).status).toBe(403);
    await call(eli, 'PATCH', `/api/spaces/${handbook.id}`, { archived: true });
    expect((await newPage(eli, { spaceId: handbook.id })).status).toBe(409);

    // Rows come from their database, never from New page.
    const clients = await createPage(db, {
      workspaceId,
      spaceId: team.id,
      kind: 'database',
      title: 'Clients',
      createdBy: eli.id,
    });
    expect((await newPage(eli, { parentId: clients.id })).status).toBe(400);
    expect((await newPage(eli, { spaceId: elisOwn, parentId: policies.id })).status).toBe(400);
  });

  it('keeps rows in databases and inline databases on pages (createPage)', async () => {
    const visits = await createPage(db, {
      workspaceId,
      spaceId: team.id,
      kind: 'database',
      title: 'Visits',
      createdBy: eli.id,
    });
    const row = { workspaceId, parentId: visits.id, kind: 'row' as const, createdBy: eli.id };
    expect(await createPage(db, { ...row, title: 'Visit 1' })).toMatchObject({
      spaceId: team.id,
      parentId: visits.id,
      kind: 'row',
      title: 'Visit 1',
    });
    await expect(createPage(db, { ...row, kind: 'page' })).rejects.toMatchObject({
      statusCode: 400,
    });
    const top = { workspaceId, spaceId: team.id, createdBy: eli.id };
    await expect(createPage(db, { ...top, kind: 'row' })).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(
      createPage(db, { ...top, kind: 'database', isInline: true }),
    ).rejects.toMatchObject({ statusCode: 400 });
    const host = await make('Weekly huddle', { spaceId: team.id });
    const inline = { ...top, parentId: host.id, kind: 'database' as const, isInline: true };
    expect(await createPage(db, inline)).toMatchObject({ isInline: true, parentId: host.id });
    await expect(
      createPage(db, { ...row, parentId: '00000000-0000-4000-8000-000000000000' }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('shows breadcrumbs only for pages the person can open (SB-06)', async () => {
    const plans = await make('Care plans', { spaceId: team.id });
    const closed = await make('Restricted', { parentId: plans.id });
    const closedToo = await make('Also restricted', { parentId: closed.id });
    const shared = await make('Shared with Casey', { parentId: closedToo.id });
    const notes = await make('Visit notes', { parentId: shared.id });
    await db.execute(sql`
      UPDATE pages SET inherit_access = false WHERE id IN (${closed.id}, ${shared.id})`);
    const casey1 = { type: 'user' as const, id: casey.id };
    await grantAccess(db, {
      pageId: shared.id,
      principal: casey1,
      level: 'view',
      grantedBy: admin.id,
    });

    const seen = await call(casey, 'GET', `/api/pages/${notes.id}`);
    expect(seen.status).toBe(200);
    expect(seen.body.access).toBe('view');
    expect(seen.body.ancestors).toEqual([
      { id: plans.id, title: 'Care plans', icon: null },
      { hidden: true },
      { id: shared.id, title: 'Shared with Casey', icon: null },
    ]);
    expect(JSON.stringify(seen.body).toLowerCase()).not.toContain('restricted');
    expect((await call(casey, 'GET', `/api/pages/${closed.id}`)).status).toBe(403);
    // Stopping inheritance closes the page to the space's owners too; Admins keep Full access.
    expect((await call(eli, 'GET', `/api/pages/${notes.id}`)).status).toBe(403);
    expect((await call(admin, 'GET', `/api/pages/${notes.id}`)).body.ancestors).toHaveLength(4);
    expect((await call(eli, 'GET', '/api/pages/not-a-page')).status).toBe(404);
  });

  it('changes the header and style with Can edit, and locks pages (PB-21, PB-22)', async () => {
    const page = (await newPage(eli, { spaceId: team.id, title: 'Huddle' })).body;
    const url = `/api/pages/${page.id}`;
    const updates: unknown[] = [];
    const off = app.events.on('page.updated', (event) => {
      updates.push(event);
    });
    const icon = { type: 'emoji', emoji: '📋' };
    const cover = { type: 'preset', name: 'sunrise' };
    const style = { font: 'serif', smallText: true, textDirection: 'rtl', fullWidth: true };
    const changed = await call(emery, 'PATCH', url, {
      title: 'Weekly huddle',
      icon,
      cover,
      ...style,
    });
    expect(changed.status).toBe(200);
    expect(changed.body).toMatchObject({ title: 'Weekly huddle', icon, cover, ...style });
    expect(changed.body.updatedBy).toEqual({ id: emery.id, name: 'Emery Editor' });
    expect(
      (await call(emery, 'PATCH', url, { font: 'mono', coverPosition: 30 })).body,
    ).toMatchObject({ font: 'mono', smallText: true, coverPosition: 30 });
    await app.events.settled();
    expect(updates[0]).toMatchObject({ pageId: page.id, workspaceId, by: emery.id });
    const fields = ['title', 'icon', 'cover', 'fullWidth', 'font', 'smallText', 'textDirection'];
    expect((updates[0] as { changes: string[] }).changes.sort()).toEqual(fields.sort());
    off();

    expect((await call(casey, 'PATCH', url, { title: 'Mine now' })).status).toBe(403);
    expect((await call(emery, 'PATCH', url, { title: 'x'.repeat(2001) })).status).toBe(400);
    expect((await call(emery, 'PATCH', url, { owner: emery.id })).status).toBe(400);

    // Locked: nothing changes, sub-pages included, until someone with Can edit unlocks it.
    const locked = await call(emery, 'PATCH', url, { locked: true });
    expect(locked.body.lockedBy).toEqual({ id: emery.id, name: 'Emery Editor' });
    expect(locked.body.lockedAt).toEqual(expect.any(String));
    expect((await call(eli, 'PATCH', url, { title: 'Renamed' })).status).toBe(403);
    expect((await newPage(eli, { parentId: page.id })).status).toBe(403);
    expect((await call(eli, 'PATCH', url, { locked: true })).body.lockedBy?.id).toBe(emery.id);
    expect((await call(casey, 'PATCH', url, { locked: false })).status).toBe(403);
    const unlocked = await call(eli, 'PATCH', url, { locked: false, title: 'Renamed' });
    expect(unlocked.body).toMatchObject({ title: 'Renamed', lockedBy: null, lockedAt: null });

    // Pages in an archived space are read-only.
    const archive = await newSpace(eli, { name: 'Old projects' });
    const old = (await newPage(eli, { spaceId: archive.id, title: 'Pilot' })).body;
    await call(eli, 'PATCH', `/api/spaces/${archive.id}`, { archived: true });
    expect((await call(eli, 'GET', `/api/pages/${old.id}`)).body.access).toBe('view');
    expect((await call(eli, 'PATCH', `/api/pages/${old.id}`, { title: 'Pilot 2' })).status).toBe(
      403,
    );
  });

  it('gives cards only for pages the person can open (0007, section 3.3)', async () => {
    const icon = { type: 'emoji', emoji: '✅' };
    const open = (await newPage(eli, { spaceId: team.id, title: 'Intake checklist', icon })).body;
    const mine = (await newPage(eli, { title: 'My drafts' })).body;
    const trashed = (await newPage(eli, { spaceId: team.id, title: 'Old process' })).body;
    await db.execute(sql`
      UPDATE pages SET deleted_at = now(), deleted_by = ${eli.id} WHERE id = ${trashed.id}`);
    const unknown = '00000000-0000-4000-8000-000000000000';
    const ids = [open.id, mine.id, trashed.id, unknown];
    const card = {
      id: open.id,
      kind: 'page',
      title: 'Intake checklist',
      icon,
      spaceName: 'Clinic ops',
    };

    const forEmery = await call<PageCardsJson>(emery, 'POST', '/api/pages/cards', { ids });
    expect(forEmery.body.cards).toEqual([
      card,
      { id: mine.id, locked: true },
      { id: trashed.id, deleted: true },
      { id: unknown, deleted: true },
    ]);
    // Someone who could never open them learns only that they're closed.
    const forOlive = await call<PageCardsJson>(olive, 'POST', '/api/pages/cards', { ids });
    expect(forOlive.body.cards).toEqual([
      { id: open.id, locked: true },
      { id: mine.id, locked: true },
      { id: trashed.id, locked: true },
      { id: unknown, deleted: true },
    ]);
    expect((await getPageCards(db, eli.id, [mine.id])).get(mine.id)).toMatchObject({
      title: 'My drafts',
      spaceName: null,
    });

    expect((await call(emery, 'GET', `/api/pages/${open.id}/card`)).body).toEqual(card);
    const refused = await call(emery, 'GET', `/api/pages/${mine.id}/card`);
    expect(refused.status).toBe(403);
    expect(JSON.stringify(refused.body)).not.toContain('My drafts');
    expect((await call(emery, 'GET', `/api/pages/${trashed.id}/card`)).status).toBe(404);
    expect((await call(emery, 'GET', `/api/pages/${trashed.id}`)).status).toBe(404);
    expect((await call(emery, 'POST', '/api/pages/cards', { ids: [] })).status).toBe(400);
  });
});
