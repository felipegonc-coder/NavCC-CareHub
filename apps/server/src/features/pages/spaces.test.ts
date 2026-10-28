// Spaces on a real database (Sidebar spec 3.3 and 5): General, making and changing spaces, who sees
// which, members and owners, archiving and Trash. Fictional people only.
import type { SpaceJson, SpaceListJson, SpaceMemberJson } from '@carehub/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../db';
import { createTestApp, createUser, hasDatabase, injectAs, type TestUser } from '../../testing';
import { getPageAccess } from './access';
import { getPrivateSpaceId, joinDefaultSpaces, setUpWorkspaceSpaces } from './spaces';

let app: Awaited<ReturnType<typeof createTestApp>>['app'];
let db: Db;
let close: () => Promise<void>;
let workspaceId: string;
let admin: TestUser, eli: TestUser, emery: TestUser, casey: TestUser, val: TestUser;

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
async function call<T = SpaceJson>(who: TestUser, method: Method, url: string, payload?: object) {
  const response = await injectAs(app, who, { method, url, payload });
  return { status: response.statusCode, body: (response.body ? response.json() : null) as T };
}
const list = (who: TestUser, scope = 'mine') =>
  call<SpaceListJson>(who, 'GET', `/api/spaces?scope=${scope}`);
const names = async (who: TestUser, scope?: string) =>
  (await list(who, scope)).body.spaces.map((space) => space.name);
const create = async (who: TestUser, input: object) =>
  (await call(who, 'POST', '/api/spaces', input)).body;
const membersOf = (answer: { body: { members: SpaceMemberJson[] } }) =>
  answer.body.members.map((member) => [member.name, member.role]);

async function page(spaceId: string): Promise<string> {
  const { rows } = await db.execute<{ id: string }>(sql`
    INSERT INTO pages (workspace_id, space_id, title, position)
    VALUES (${workspaceId}, ${spaceId}, 'Plan', 'V') RETURNING id`);
  return rows[0]!.id;
}

describe.skipIf(!hasDatabase)('spaces', () => {
  beforeAll(async () => {
    ({ app, db, close } = await createTestApp());
    admin = await createUser(db, { role: 'admin', name: 'Avery Admin' });
    eli = await createUser(db, { role: 'editor', name: 'Eli Editor' });
    emery = await createUser(db, { role: 'editor', name: 'Emery Editor' });
    casey = await createUser(db, { role: 'commenter', name: 'Casey Commenter' });
    val = await createUser(db, { role: 'viewer', name: 'Val Viewer' });
    workspaceId = admin.workspaceId!;
  });
  afterAll(() => close());

  it('starts the workspace with General, which new members join (SB-01)', async () => {
    const browse = await list(eli, 'browse');
    const general = browse.body.spaces.find((space) => space.name === 'General');
    expect(general).toMatchObject({ kind: 'open', isDefault: true, myRole: null });
    expect(await setUpWorkspaceSpaces(db, workspaceId)).toBe(general?.id);
    await joinDefaultSpaces(db, workspaceId, eli.id);
    const mine = await list(eli);
    expect(mine.body.spaces.map((space) => [space.name, space.myRole])).toEqual([
      ['General', 'member'],
    ]);
    expect(mine.body.privateSpaceId).toBe(await getPrivateSpaceId(db, eli.id));
    expect(await getPrivateSpaceId(db, eli.id, workspaceId)).toBe(mine.body.privateSpaceId);
    // Guests have no spaces and no Private section; they reach only pages shared with them.
    const guest = await createUser(db, { kind: 'guest', name: 'Gray Guest' });
    await joinDefaultSpaces(db, workspaceId, guest.id);
    expect((await list(guest)).body).toEqual({ spaces: [], privateSpaceId: null });
  });

  it('makes spaces with names unique in the workspace; the maker owns them', async () => {
    const icon = { type: 'emoji', emoji: '🩺' };
    const made = await call(eli, 'POST', '/api/spaces', {
      name: 'Care Team',
      kind: 'closed',
      defaultAccess: 'comment',
      icon,
    });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({
      name: 'Care Team',
      kind: 'closed',
      defaultAccess: 'comment',
      icon,
      description: '',
      myRole: 'owner',
      canManage: true,
      memberCount: 1,
      archivedAt: null,
    });
    expect(made.body.createdAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    expect((await call(emery, 'POST', '/api/spaces', { name: ' care team ' })).status).toBe(409);
    expect((await call(casey, 'POST', '/api/spaces', { name: 'Notes' })).status).toBe(403);
    expect((await call(eli, 'POST', '/api/spaces', { name: 'x'.repeat(61) })).status).toBe(400);
    expect((await call(eli, 'POST', '/api/spaces', { name: 'Ok', owner: 'me' })).status).toBe(400);
  });

  it('shows Open and Closed spaces to everyone, Private ones to members and Admins (SB-07)', async () => {
    const leadership = await create(eli, { name: 'Leadership', kind: 'private' });
    const intake = await create(eli, { name: 'Intake', kind: 'closed' });
    const training = await create(eli, { name: 'Training' });
    expect(await names(val, 'browse')).toEqual(['Care Team', 'General', 'Intake', 'Training']);
    expect((await call(val, 'GET', `/api/spaces/${leadership.id}`)).status).toBe(404);
    expect((await call(admin, 'GET', `/api/spaces/${leadership.id}`)).body).toMatchObject({
      myRole: null,
      canManage: true,
      pageCount: 0,
    });
    expect((await list(val, 'all')).status).toBe(403);
    expect(await names(admin, 'all')).toContain('Leadership');
    // Open spaces let people join by themselves; Closed ones need an owner; Private ones stay hidden.
    const joined = await call(val, 'POST', `/api/spaces/${training.id}/join`);
    expect(joined.body).toMatchObject({ myRole: 'member', memberCount: 2 });
    expect((await call(val, 'POST', `/api/spaces/${intake.id}/join`)).status).toBe(409);
    expect((await call(val, 'POST', `/api/spaces/${leadership.id}/join`)).status).toBe(404);
    expect(await names(val)).toEqual(['Training']);
  });

  it('lets owners change settings; members get the default access (SB-08)', async () => {
    const policies = await create(eli, { name: 'Policies' });
    const p = await page(policies.id);
    const url = `/api/spaces/${policies.id}`;
    await call(eli, 'POST', `${url}/members`, { members: [{ type: 'user', id: emery.id }] });
    expect(await getPageAccess(db, emery.id, p)).toBe('edit');
    expect((await call(emery, 'PATCH', url, { defaultAccess: 'view' })).status).toBe(403);
    const changed = await call(eli, 'PATCH', url, {
      defaultAccess: 'view',
      description: 'How we work',
      ownersOnlyTopLevel: true,
      allowShareLinks: false,
    });
    expect(changed.body).toMatchObject({
      defaultAccess: 'view',
      description: 'How we work',
      ownersOnlyTopLevel: true,
      allowShareLinks: false,
    });
    expect(await getPageAccess(db, emery.id, p)).toBe('view');
    expect(await getPageAccess(db, eli.id, p)).toBe('full');
    expect((await call(eli, 'PATCH', url, { name: 'General' })).status).toBe(409);
    expect((await call(eli, 'PATCH', url, { isDefault: true })).status).toBe(403);
    expect((await call(admin, 'PATCH', url, { isDefault: true })).body.isDefault).toBe(true);
  });

  it('archives a space: hidden, read-only, and only Admins unarchive it (SB-09)', async () => {
    const old = await create(eli, { name: 'Old Projects' });
    const p = await page(old.id);
    const url = `/api/spaces/${old.id}`;
    expect((await call(eli, 'PATCH', url, { archived: true })).body.archivedAt).toEqual(
      expect.any(String),
    );
    expect(await names(eli)).not.toContain('Old Projects');
    expect(await names(eli, 'browse')).not.toContain('Old Projects');
    expect(await getPageAccess(db, eli.id, p)).toBe('view');
    expect((await call(eli, 'PATCH', url, { name: 'Older Projects' })).status).toBe(409);
    expect((await call(eli, 'PATCH', url, { archived: false })).status).toBe(403);
    expect((await call(admin, 'PATCH', url, { archived: false })).body.archivedAt).toBeNull();
    expect(await getPageAccess(db, eli.id, p)).toBe('full');
  });

  it('adds members and owners; the last owner hands over before leaving', async () => {
    const scheduling = await create(eli, { name: 'Scheduling', kind: 'private' });
    const url = `/api/spaces/${scheduling.id}/members`;
    const add = (who: TestUser, ids: string[], role?: string) =>
      call<{ members: SpaceMemberJson[] }>(who, 'POST', url, {
        members: ids.map((id) => ({ type: 'user', id })),
        role,
      });
    const guest = await createUser(db, { kind: 'guest', name: 'Gale Guest' });
    const outsider = await createUser(db, { role: null, name: 'Olly Outsider' });
    expect((await add(eli, [guest.id])).status).toBe(400);
    expect((await add(eli, [outsider.id])).status).toBe(400);
    expect((await add(emery, [casey.id])).status).toBe(404);
    expect(membersOf(await add(eli, [emery.id, casey.id]))).toEqual([
      ['Eli Editor', 'owner'],
      ['Casey Commenter', 'member'],
      ['Emery Editor', 'member'],
    ]);
    expect((await call(eli, 'DELETE', `${url}/${eli.id}`)).status).toBe(409);
    expect((await call(eli, 'PATCH', `${url}/${eli.id}`, { role: 'member' })).status).toBe(409);
    // In a Private space an owner removes people; they can't leave by themselves.
    expect((await call(casey, 'DELETE', `${url}/${casey.id}`)).status).toBe(409);
    await call(eli, 'PATCH', `${url}/${emery.id}`, { role: 'owner' });
    expect((await call(eli, 'DELETE', `${url}/${eli.id}`)).status).toBe(204);
    const left = await call<{ members: SpaceMemberJson[] }>(emery, 'GET', url);
    expect(membersOf(left)).toEqual([
      ['Emery Editor', 'owner'],
      ['Casey Commenter', 'member'],
    ]);
    expect((await call(val, 'GET', url)).status).toBe(404);

    const social = await create(eli, { name: 'Social' });
    await call(casey, 'POST', `/api/spaces/${social.id}/join`);
    const socialUrl = `/api/spaces/${social.id}/members`;
    expect((await call(casey, 'DELETE', `${socialUrl}/${eli.id}`)).status).toBe(403);
    expect((await call(casey, 'DELETE', `${socialUrl}/${casey.id}`)).status).toBe(204);
    // People removed from the workspace drop off the list.
    await call(eli, 'POST', socialUrl, { members: [{ type: 'user', id: val.id }] });
    await db.execute(
      sql`UPDATE workspace_members SET removed_at = now() WHERE user_id = ${val.id}`,
    );
    const after = await call<{ members: SpaceMemberJson[] }>(eli, 'GET', socialUrl);
    expect(membersOf(after)).toEqual([['Eli Editor', 'owner']]);
    await db.execute(sql`UPDATE workspace_members SET removed_at = NULL WHERE user_id = ${val.id}`);
  });

  it('moves a space and its pages to Trash; the name is free again', async () => {
    const drafts = await create(eli, { name: 'Drafts' });
    const p = await page(drafts.id);
    const url = `/api/spaces/${drafts.id}`;
    expect((await call(eli, 'GET', url)).body).toMatchObject({ pageCount: 1 });
    expect((await call(emery, 'DELETE', url)).status).toBe(403);
    expect((await call(eli, 'DELETE', url)).status).toBe(204);
    expect((await call(eli, 'GET', url)).status).toBe(404);
    expect(await getPageAccess(db, eli.id, p)).toBe('none');
    expect((await call(eli, 'POST', '/api/spaces', { name: 'Drafts' })).status).toBe(201);
  });
});
