import { describe, expect, it } from 'vitest';
import { meResponseSchema } from './index';

describe('meResponseSchema', () => {
  const user = {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'test.person@example.test',
    name: 'Test Person',
    avatarUrl: null,
    isSiteAdmin: false,
    timeZone: 'America/Denver',
    use24h: false,
    weekStart: 0,
    mustChangePassword: false,
  };
  const workspace = { id: '00000000-0000-4000-8000-000000000002', name: 'Care Hub' };
  const member = {
    workspaceId: workspace.id,
    kind: 'member',
    roleId: '00000000-0000-4000-8000-000000000003',
    roleName: 'Viewer',
    permissions: [],
    isAdmin: false,
  } as const;
  const guest = {
    workspaceId: workspace.id,
    kind: 'guest',
    roleId: null,
    roleName: null,
    permissions: [],
    isAdmin: false,
  } as const;

  it('describes GET /api/auth/me for members, guests and people outside the workspace', () => {
    for (const me of [
      { user, member, workspace },
      { user, member: guest, workspace },
      { user, member: null, workspace },
    ]) {
      expect(meResponseSchema.parse(me)).toEqual(me);
    }
  });

  it('rejects unknown permissions, guests with a role, permissions or admin, and odd week starts', () => {
    const bad = [
      { user, member: { ...member, permissions: ['pages.fly'] }, workspace },
      { user, member: { ...guest, permissions: ['pages.comment'] }, workspace },
      { user, member: { ...guest, roleId: member.roleId, roleName: 'Viewer' }, workspace },
      { user, member: { ...guest, isAdmin: true }, workspace },
      { user: { ...user, weekStart: 7 }, member: null, workspace },
    ];
    for (const me of bad) expect(meResponseSchema.safeParse(me).success).toBe(false);
  });
});
