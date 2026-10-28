import { describe, expect, it } from 'vitest';
import { BUILT_IN_ROLES, PERMISSION_KEYS, hasPermission, roleNameSchema } from './index';

describe('permissions', () => {
  it('gives the built-in roles the permissions in the spec table', () => {
    expect(BUILT_IN_ROLES.admin.permissions).toEqual(PERMISSION_KEYS);
    expect([...BUILT_IN_ROLES.editor.permissions].sort()).toEqual([
      'claude.use',
      'guests.add',
      'pages.comment',
      'pages.create',
      'pages.edit',
      'pages.share',
      'pages.shareLinks',
      'templates.manage',
    ]);
    expect(BUILT_IN_ROLES.commenter.permissions).toEqual(['pages.comment']);
    expect(BUILT_IN_ROLES.viewer.permissions).toEqual([]);
    expect(Object.values(BUILT_IN_ROLES).map((role) => role.name)).toEqual([
      'Admin',
      'Editor',
      'Commenter',
      'Viewer',
    ]);
  });

  it('keeps workspace.admin for the Admin role', () => {
    const others = [BUILT_IN_ROLES.editor, BUILT_IN_ROLES.commenter, BUILT_IN_ROLES.viewer];
    for (const role of others) expect(role.permissions).not.toContain('workspace.admin');
  });

  it('hasPermission reads a Set (server) or an array (web), and says no to non-members', () => {
    const editor = {
      kind: 'member',
      permissions: new Set(BUILT_IN_ROLES.editor.permissions),
    } as const;
    expect(hasPermission(editor, 'pages.edit')).toBe(true);
    expect(hasPermission(editor, 'workspace.admin')).toBe(false);
    expect(hasPermission({ permissions: ['pages.comment'] }, 'pages.comment')).toBe(true);
    expect(hasPermission({ permissions: [] }, 'pages.comment')).toBe(false);
    expect(hasPermission(null, 'pages.edit')).toBe(false);
    expect(hasPermission(undefined, 'pages.edit')).toBe(false);
  });

  it('hasPermission is false for guests, whatever they carry', () => {
    const guest = { kind: 'guest', permissions: PERMISSION_KEYS } as const;
    for (const key of PERMISSION_KEYS) expect(hasPermission(guest, key)).toBe(false);
  });

  it('limits role names to 1–40 characters', () => {
    expect(roleNameSchema.parse('  Trainer ')).toBe('Trainer');
    expect(roleNameSchema.safeParse(' ').success).toBe(false);
    expect(roleNameSchema.safeParse('x'.repeat(41)).success).toBe(false);
  });
});
