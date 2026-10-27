import {
  BUILT_IN_ROLES,
  BUILT_IN_ROLE_KEYS,
  PERMISSION_KEYS,
  type PermissionKey,
} from '@carehub/shared';
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, createUser, hasDatabase, injectAs, type TestApp } from '../../testing';
import { createRole } from '../roles';
import {
  getCurrentMember,
  getDefaultWorkspace,
  getMembership,
  syncDefaultWorkspace,
} from './members';
import { roles, workspaceMembers, workspaces } from './schema';

const LEARNING: PermissionKey[] = ['learning.build', 'learning.assign', 'learning.analytics'];

describe.skipIf(!hasDatabase)('workspaces, roles and members', () => {
  let testApp: TestApp;
  let app: FastifyInstance;
  let workspaceId: string;

  beforeAll(async () => {
    testApp = await createTestApp({
      routes: (instance) => {
        const kind = async (request: { member: { kind: string } | null }) => ({
          kind: request.member?.kind,
        });
        instance.get('/api/test/member', { preHandler: instance.requireMember }, kind);
        instance.get(
          '/api/test/guests-too',
          { config: { allowGuests: true }, preHandler: instance.requireMember },
          kind,
        );
        for (const key of PERMISSION_KEYS) {
          const preHandler = instance.requirePermission(key);
          instance.get(`/api/test/can/${key}`, { preHandler }, kind);
          instance.get(
            `/api/test/guest-can/${key}`,
            { config: { allowGuests: true }, preHandler },
            kind,
          );
        }
      },
    });
    app = testApp.app;
    const workspace = await getDefaultWorkspace(testApp.db);
    workspaceId = workspace?.id ?? '';
  });

  afterAll(async () => {
    await testApp?.close();
  });

  const get = async (user: { id: string }, url: string) =>
    (await injectAs(app, user, { method: 'GET', url })).statusCode;
  const builtInRoles = () =>
    testApp.db
      .select({
        builtinKey: roles.builtinKey,
        name: roles.name,
        description: roles.description,
        permissions: roles.permissions,
        updatedAt: roles.updatedAt,
      })
      .from(roles)
      .where(and(eq(roles.workspaceId, workspaceId), isNotNull(roles.builtinKey)));

  it('start-up makes the Care Hub workspace with the built-in roles from BUILT_IN_ROLES', async () => {
    expect(await getDefaultWorkspace(testApp.db)).toEqual({ id: workspaceId, name: 'Care Hub' });
    const rows = await builtInRoles();
    expect(rows).toHaveLength(BUILT_IN_ROLE_KEYS.length);
    for (const key of BUILT_IN_ROLE_KEYS) {
      expect(rows.find((role) => role.builtinKey === key)).toMatchObject({
        name: BUILT_IN_ROLES[key].name,
        description: BUILT_IN_ROLES[key].description,
        permissions: [...BUILT_IN_ROLES[key].permissions],
      });
    }
  });

  it('puts changed built-in roles back at start-up and leaves matching ones alone', async () => {
    const before = await builtInRoles();
    await testApp.db
      .update(roles)
      .set({ permissions: ['pages.edit'] })
      .where(and(eq(roles.workspaceId, workspaceId), eq(roles.builtinKey, 'editor')));
    await syncDefaultWorkspace(testApp.db);
    const after = await builtInRoles();
    const editor = after.find((role) => role.builtinKey === 'editor');
    expect(editor?.permissions).toEqual([...BUILT_IN_ROLES.editor.permissions]);
    const viewer = (rows: typeof before) => rows.find((role) => role.builtinKey === 'viewer');
    expect(viewer(after)?.updatedAt).toEqual(viewer(before)?.updatedAt);
    const [count] = await testApp.db.select({ n: sql<number>`count(*)::int` }).from(workspaces);
    expect(count?.n).toBe(1);
  });

  it('GET /api/auth/me shows guests without a role or permissions, and null for outsiders', async () => {
    const guest = await createUser(testApp.db, { kind: 'guest' });
    const me = await injectAs(app, guest, { method: 'GET', url: '/api/auth/me' });
    expect(me.json()).toMatchObject({
      member: {
        kind: 'guest',
        workspaceId,
        roleId: null,
        roleName: null,
        permissions: [],
        isAdmin: false,
      },
      workspace: { id: workspaceId, name: 'Care Hub' },
    });
    const outsider = await createUser(testApp.db, { role: null });
    const theirs = await injectAs(app, outsider, { method: 'GET', url: '/api/auth/me' });
    expect(theirs.json()).toMatchObject({ member: null, workspace: { id: workspaceId } });
  });

  it('requireMember: 401 signed out, 403 outside or removed, guests only where allowed', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/test/member' })).statusCode).toBe(401);
    const member = await createUser(testApp.db, { role: 'viewer' });
    const guest = await createUser(testApp.db, { kind: 'guest' });
    const outsider = await createUser(testApp.db, { role: null });
    expect(await get(member, '/api/test/member')).toBe(200);
    expect(await get(outsider, '/api/test/member')).toBe(403);
    expect(await get(guest, '/api/test/member')).toBe(403);
    expect(await get(guest, '/api/test/guests-too')).toBe(200);
    await testApp.db
      .update(workspaceMembers)
      .set({ removedAt: new Date() })
      .where(eq(workspaceMembers.userId, member.id));
    expect(await get(member, '/api/test/member')).toBe(403);
    const me = await injectAs(app, member, { method: 'GET', url: '/api/auth/me' });
    expect(me.json()).toMatchObject({ member: null });
  });

  it('getMembership finds members and guests of that workspace, and null for anyone else', async () => {
    const member = await createUser(testApp.db, { role: 'commenter' });
    const guest = await createUser(testApp.db, { kind: 'guest' });
    const outsider = await createUser(testApp.db, { role: null });
    const removed = await createUser(testApp.db, { role: 'viewer' });
    await testApp.db
      .update(workspaceMembers)
      .set({ removedAt: new Date() })
      .where(eq(workspaceMembers.userId, removed.id));
    const commenter = await getMembership(testApp.db, workspaceId, member.id);
    expect(commenter).toEqual({
      kind: 'member',
      workspaceId,
      roleId: member.roleId,
      roleName: BUILT_IN_ROLES.commenter.name,
      permissions: new Set(BUILT_IN_ROLES.commenter.permissions),
      isAdmin: false,
    });
    expect(await getCurrentMember(testApp.db, member.id)).toEqual(commenter);
    expect(await getMembership(testApp.db, workspaceId, guest.id)).toEqual({
      kind: 'guest',
      workspaceId,
      roleId: null,
      roleName: null,
      permissions: new Set(),
      isAdmin: false,
    });
    expect(await getMembership(testApp.db, workspaceId, outsider.id)).toBeNull();
    expect(await getMembership(testApp.db, workspaceId, removed.id)).toBeNull();

    const [second] = await testApp.db
      .insert(workspaces)
      .values({ name: 'Second' })
      .returning({ id: workspaces.id });
    const secondId = second?.id ?? '';
    const [visitor] = await testApp.db
      .insert(roles)
      .values({ workspaceId: secondId, name: 'Visitor', permissions: ['pages.comment'] })
      .returning({ id: roles.id });
    await testApp.db
      .insert(workspaceMembers)
      .values({ workspaceId: secondId, userId: outsider.id, roleId: visitor?.id ?? null });
    expect(await getMembership(testApp.db, secondId, outsider.id)).toEqual({
      kind: 'member',
      workspaceId: secondId,
      roleId: visitor?.id,
      roleName: 'Visitor',
      permissions: new Set(['pages.comment']),
      isAdmin: false,
    });
    expect(await getMembership(testApp.db, secondId, member.id)).toBeNull();
    expect(await getCurrentMember(testApp.db, outsider.id)).toBeNull();
    await testApp.db.delete(workspaces).where(eq(workspaces.id, secondId));
  });

  it('requirePermission answers every key as each built-in role allows, and no to guests (RP-12)', async () => {
    for (const role of BUILT_IN_ROLE_KEYS) {
      const user = await createUser(testApp.db, { role });
      const allowed: readonly PermissionKey[] = BUILT_IN_ROLES[role].permissions;
      for (const key of PERMISSION_KEYS) {
        expect(await get(user, `/api/test/can/${key}`), `${role} ${key}`).toBe(
          allowed.includes(key) ? 200 : 403,
        );
      }
    }
    const guest = await createUser(testApp.db, { kind: 'guest' });
    for (const key of PERMISSION_KEYS) {
      expect(await get(guest, `/api/test/guest-can/${key}`), `guest ${key}`).toBe(403);
    }
    const siteAdmin = await createUser(testApp.db, { siteAdmin: true, role: 'viewer' });
    expect(await get(siteAdmin, '/api/test/can/workspace.admin')).toBe(403);
  });

  it('a custom Trainer role (Editor plus Learning) works for its member (RP-02)', async () => {
    const permissions = [...BUILT_IN_ROLES.editor.permissions, ...LEARNING];
    const trainer = await createRole(testApp.db, { workspaceId, name: 'Trainer', permissions });
    expect(trainer).toMatchObject({ builtinKey: null, name: 'Trainer', permissions });
    const user = await createUser(testApp.db, { roleId: trainer.id });
    expect(user.roleId).toBe(trainer.id);
    expect(await get(user, '/api/test/can/learning.build')).toBe(200);
    expect(await get(user, '/api/test/can/pages.share')).toBe(200);
    expect(await get(user, '/api/test/can/workspace.admin')).toBe(403);
    const me = await injectAs(app, user, { method: 'GET', url: '/api/auth/me' });
    expect(me.json()).toMatchObject({ member: { roleName: 'Trainer', isAdmin: false } });
  });

  it('createUser({ permissions }) makes one custom role per set of permissions', async () => {
    const first = await createUser(testApp.db, {
      permissions: ['pages.comment', 'learning.assign'],
    });
    const second = await createUser(testApp.db, {
      permissions: ['learning.assign', 'pages.comment'],
    });
    expect(first.roleId).toEqual(expect.any(String));
    expect(second.roleId).toBe(first.roleId);
    expect(await get(first, '/api/test/can/learning.assign')).toBe(200);
    expect(await get(first, '/api/test/can/pages.edit')).toBe(403);
  });

  it('createRole refuses Admin settings, taken or long names, and a 21st custom role', async () => {
    const make = (name: string, permissions: PermissionKey[] = []) =>
      createRole(testApp.db, { workspaceId, name, permissions });
    await expect(make('Boss', ['workspace.admin'])).rejects.toThrow(/Admin settings/);
    await expect(make('x'.repeat(41))).rejects.toThrow();
    await expect(make(' trainer ')).rejects.toMatchObject({ statusCode: 409, code: 'conflict' });
    await expect(make('Editor')).rejects.toMatchObject({ statusCode: 409 });
    await expect(
      testApp.db
        .insert(roles)
        .values({ workspaceId, name: 'Sneaky', permissions: ['workspace.admin'] }),
    ).rejects.toThrow();
    const custom = await testApp.db
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.workspaceId, workspaceId), isNull(roles.builtinKey)));
    const made: string[] = [];
    for (let n = custom.length; n < 20; n++) made.push((await make(`Team ${n}`)).id);
    await expect(make('One too many')).rejects.toMatchObject({
      statusCode: 413,
      code: 'too_large',
    });
    for (const id of made) await testApp.db.delete(roles).where(eq(roles.id, id));
  });

  it('the database keeps members to one role of their own workspace, and guests to none', async () => {
    const person = await createUser(testApp.db, { role: null });
    const add = (values: {
      workspaceId: string;
      kind: 'member' | 'guest';
      roleId: string | null;
    }) => testApp.db.insert(workspaceMembers).values({ ...values, userId: person.id });
    const [viewer] = await testApp.db
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.workspaceId, workspaceId), eq(roles.builtinKey, 'viewer')));
    const [other] = await testApp.db
      .insert(workspaces)
      .values({ name: 'Elsewhere' })
      .returning({ id: workspaces.id });
    const [foreign] = await testApp.db
      .insert(roles)
      .values({ workspaceId: other?.id ?? '', name: 'Visitor' })
      .returning({ id: roles.id });
    await expect(add({ workspaceId, kind: 'member', roleId: null })).rejects.toThrow();
    await expect(add({ workspaceId, kind: 'guest', roleId: viewer?.id ?? null })).rejects.toThrow();
    await expect(
      add({ workspaceId, kind: 'member', roleId: foreign?.id ?? null }),
    ).rejects.toThrow();
    await add({ workspaceId, kind: 'member', roleId: viewer?.id ?? null });
    await testApp.db.delete(workspaces).where(eq(workspaces.id, other?.id ?? ''));
  });
});
