import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseUrl, startHarness, type Body, type Harness, type Person } from '../pages/testing';

describe.skipIf(!databaseUrl)('spaces', () => {
  let h: Harness;
  let admin: Person;
  let editor: Person;
  let commenter: Person;
  let viewer: Person;
  let outsider: Person;

  beforeAll(async () => {
    h = await startHarness();
    const workspaceId = await h.workspace();
    admin = await h.person(workspaceId, 'admin', 'Ana Admin');
    editor = await h.person(workspaceId, 'editor', 'Eli Editor');
    commenter = await h.person(workspaceId, 'commenter', 'Cleo Commenter');
    viewer = await h.person(workspaceId, 'viewer', 'Vic Viewer');
    outsider = await h.person(await h.workspace(), 'admin', 'Otto Outsider');
  });

  afterAll(async () => {
    await h?.close();
  });

  async function createSpace(body: object): Promise<Body> {
    const reply = await h.send(admin, 'POST', '/api/spaces', body);
    expect(reply.status, JSON.stringify(reply.body)).toBe(201);
    return reply.body.space;
  }

  async function spacesOf(person: Person): Promise<Body[]> {
    const reply = await h.send(person, 'GET', '/api/spaces');
    expect(reply.status).toBe(200);
    return reply.body.spaces;
  }

  const ids = (spaces: Body[]) => spaces.map((space: Body) => space.id);

  it('needs a signed-in person', async () => {
    expect((await h.send(null, 'GET', '/api/spaces')).status).toBe(401);
    expect((await h.send(null, 'GET', '/api/workspace/members')).status).toBe(401);
  });

  it('lists the people in the workspace', async () => {
    const reply = await h.send(viewer, 'GET', '/api/workspace/members');
    expect(reply.status).toBe(200);
    expect(reply.body.members.map((member: Body) => member.name)).toEqual([
      'Ana Admin',
      'Cleo Commenter',
      'Eli Editor',
      'Vic Viewer',
    ]);
    expect(reply.body.members[0]).toMatchObject({ id: admin.id, role: 'admin' });
  });

  it('gives each person one private space that only they see', async () => {
    await spacesOf(editor);
    const mine = (await spacesOf(editor)).filter((space) => space.kind === 'private');
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      name: 'Private',
      visibility: null,
      access: { level: 'edit', canCreatePages: true, canManage: true },
    });
    const adminSees = ids(await spacesOf(admin));
    expect(adminSees).not.toContain(mine[0].id);
    const viewersOwn = (await spacesOf(viewer)).find((space) => space.kind === 'private');
    expect(viewersOwn.access).toEqual({ level: 'view', canCreatePages: false, canManage: true });
  });

  it('lets only admins create team spaces', async () => {
    const body = { name: 'Care team', icon: { type: 'icon', name: 'stethoscope', color: 'blue' } };
    expect((await h.send(editor, 'POST', '/api/spaces', body)).status).toBe(403);
    const space = await createSpace(body);
    expect(space).toMatchObject({
      name: 'Care team',
      kind: 'team',
      visibility: 'workspace',
      icon: body.icon,
      access: { level: 'edit', canCreatePages: true, canManage: true },
    });
    const seen = (await spacesOf(viewer)).find((s) => s.id === space.id);
    expect(seen.access).toEqual({ level: 'view', canCreatePages: false, canManage: false });
    expect(ids(await spacesOf(outsider))).not.toContain(space.id);
  });

  it('checks new spaces', async () => {
    const send = (body: object) => h.send(admin, 'POST', '/api/spaces', body);
    expect((await send({ name: '   ' })).status).toBe(400);
    expect((await send({ name: 'x'.repeat(101) })).status).toBe(400);
    expect((await send({ name: 'Odd icon', icon: { type: 'emoji', emoji: 'ab' } })).status).toBe(
      400,
    );
    const outsiderListed = { name: 'Shared', members: [{ userId: outsider.id, role: 'editor' }] };
    expect((await send(outsiderListed)).status).toBe(400);
    const twice = [
      { userId: editor.id, role: 'editor' },
      { userId: editor.id, role: 'viewer' },
    ];
    expect((await send({ name: 'Twice', members: twice })).status).toBe(400);
  });

  it('shows members-only spaces to the people listed, at their space role', async () => {
    const space = await createSpace({
      name: 'Leadership',
      visibility: 'members',
      members: [{ userId: editor.id, role: 'commenter' }],
    });
    const seen = (await spacesOf(editor)).find((s) => s.id === space.id);
    expect(seen.access).toEqual({ level: 'comment', canCreatePages: false, canManage: false });
    expect(ids(await spacesOf(viewer))).not.toContain(space.id);
    expect((await h.send(viewer, 'GET', `/api/spaces/${space.id}/members`)).status).toBe(404);
    expect((await h.send(viewer, 'PATCH', `/api/spaces/${space.id}`, { name: 'x' })).status).toBe(
      404,
    );
    const members = await h.send(editor, 'GET', `/api/spaces/${space.id}/members`);
    expect(members.body.members).toMatchObject([
      { userId: editor.id, name: 'Eli Editor', role: 'commenter' },
    ]);
  });

  it('replaces the member list', async () => {
    const space = await createSpace({
      name: 'Night shift',
      visibility: 'members',
      members: [{ userId: editor.id, role: 'editor' }],
    });
    const url = `/api/spaces/${space.id}/members`;
    const members = [{ userId: viewer.id, role: 'viewer' }];
    expect((await h.send(editor, 'PUT', url, { members })).status).toBe(403);
    const reply = await h.send(admin, 'PUT', url, { members });
    expect(reply.status).toBe(200);
    expect(reply.body.members).toMatchObject([{ userId: viewer.id, role: 'viewer' }]);
    expect(ids(await spacesOf(editor))).not.toContain(space.id);
    expect(ids(await spacesOf(viewer))).toContain(space.id);
    const withOutsider = { members: [{ userId: outsider.id, role: 'viewer' }] };
    expect((await h.send(admin, 'PUT', url, withOutsider)).status).toBe(400);
  });

  it('lets admins rename and reorder team spaces', async () => {
    const first = await createSpace({ name: 'Intake' });
    const last = await createSpace({ name: 'Discharge' });
    const url = `/api/spaces/${last.id}`;
    expect((await h.send(editor, 'PATCH', url, { name: 'Mine now' })).status).toBe(403);
    expect((await h.send(admin, 'PATCH', url, {})).status).toBe(400);
    const renamed = await h.send(admin, 'PATCH', url, { name: 'Discharge planning' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.space.name).toBe('Discharge planning');
    await h.send(admin, 'PATCH', url, { position: 0 });
    const team = ids((await spacesOf(admin)).filter((space) => space.kind === 'team'));
    expect(team[0]).toBe(last.id);
    expect(team.indexOf(first.id)).toBeGreaterThan(0);
  });

  it('lets people rename their private space but not share or delete it', async () => {
    const mine = (await spacesOf(commenter)).find((space) => space.kind === 'private');
    const url = `/api/spaces/${mine.id}`;
    const renamed = await h.send(commenter, 'PATCH', url, { name: 'My notes' });
    expect(renamed.body.space.name).toBe('My notes');
    expect((await h.send(commenter, 'PATCH', url, { visibility: 'members' })).status).toBe(400);
    expect((await h.send(commenter, 'PUT', `${url}/members`, { members: [] })).status).toBe(400);
    expect((await h.send(commenter, 'DELETE', url)).status).toBe(400);
    expect((await h.send(admin, 'PATCH', url, { name: 'Peeking' })).status).toBe(404);
  });

  it('lets admins delete team spaces', async () => {
    const space = await createSpace({ name: 'Old projects' });
    const url = `/api/spaces/${space.id}`;
    expect((await h.send(editor, 'DELETE', url)).status).toBe(403);
    expect((await h.send(admin, 'DELETE', url)).status).toBe(204);
    expect(ids(await spacesOf(admin))).not.toContain(space.id);
    expect((await h.send(admin, 'DELETE', url)).status).toBe(404);
  });

  it('answers 404 for spaces that are hidden, missing or not IDs', async () => {
    const space = await createSpace({ name: 'Front desk' });
    expect((await h.send(outsider, 'GET', `/api/spaces/${space.id}/members`)).status).toBe(404);
    const missing = '00000000-0000-4000-8000-000000000000';
    expect((await h.send(admin, 'GET', `/api/spaces/${missing}/members`)).status).toBe(404);
    expect((await h.send(admin, 'PATCH', '/api/spaces/not-an-id', { name: 'x' })).status).toBe(404);
  });
});
