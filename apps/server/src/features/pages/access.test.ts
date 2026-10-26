import { describe, expect, it } from 'vitest';
import { atLeast, resolveSpaceAccess, type AccessFacts } from './access';

const ME = '7d6f3c2a-0b1e-4c5d-8e9f-0a1b2c3d4e5f';
const SOMEONE_ELSE = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

const facts = (overrides: Partial<AccessFacts>): AccessFacts => ({
  kind: 'team',
  visibility: 'workspace',
  ownerId: null,
  workspaceRole: 'editor',
  spaceRole: null,
  ...overrides,
});

const levelOf = (overrides: Partial<AccessFacts>) => resolveSpaceAccess(ME, facts(overrides));

describe('resolveSpaceAccess', () => {
  it('hides every space from people outside the workspace', () => {
    expect(levelOf({ workspaceRole: null })).toBeNull();
    expect(
      levelOf({ workspaceRole: null, kind: 'private', visibility: null, ownerId: ME }),
    ).toBeNull();
  });

  it('shows a private space only to its owner, admins included', () => {
    const mine = { kind: 'private' as const, visibility: null, ownerId: ME };
    expect(levelOf({ ...mine, workspaceRole: 'editor' })).toEqual({
      level: 'edit',
      canCreatePages: true,
      canManage: true,
    });
    expect(levelOf({ ...mine, ownerId: SOMEONE_ELSE, workspaceRole: 'admin' })).toBeNull();
    // A viewer's own space still follows their role: they can rename it but not add pages.
    expect(levelOf({ ...mine, workspaceRole: 'viewer' })).toEqual({
      level: 'view',
      canCreatePages: false,
      canManage: true,
    });
  });

  it('gives everyone their role level in spaces the whole workspace sees', () => {
    expect(levelOf({ workspaceRole: 'admin' })).toEqual({
      level: 'edit',
      canCreatePages: true,
      canManage: true,
    });
    expect(levelOf({ workspaceRole: 'editor' })).toEqual({
      level: 'edit',
      canCreatePages: true,
      canManage: false,
    });
    expect(levelOf({ workspaceRole: 'commenter' })).toEqual({
      level: 'comment',
      canCreatePages: false,
      canManage: false,
    });
    expect(levelOf({ workspaceRole: 'viewer' })).toEqual({
      level: 'view',
      canCreatePages: false,
      canManage: false,
    });
  });

  it('shows members-only spaces to the people listed, capped by both roles', () => {
    const membersOnly = { visibility: 'members' as const };
    expect(levelOf({ ...membersOnly, workspaceRole: 'editor', spaceRole: null })).toBeNull();
    expect(levelOf({ ...membersOnly, workspaceRole: 'admin', spaceRole: null })).toEqual({
      level: 'edit',
      canCreatePages: true,
      canManage: true,
    });
    expect(levelOf({ ...membersOnly, workspaceRole: 'editor', spaceRole: 'editor' })).toEqual({
      level: 'edit',
      canCreatePages: true,
      canManage: false,
    });
    expect(levelOf({ ...membersOnly, workspaceRole: 'editor', spaceRole: 'commenter' })).toEqual({
      level: 'comment',
      canCreatePages: false,
      canManage: false,
    });
    expect(levelOf({ ...membersOnly, workspaceRole: 'editor', spaceRole: 'viewer' })).toEqual({
      level: 'view',
      canCreatePages: false,
      canManage: false,
    });
    // Being listed as an editor never lifts someone above their workspace role.
    expect(levelOf({ ...membersOnly, workspaceRole: 'viewer', spaceRole: 'editor' })).toEqual({
      level: 'view',
      canCreatePages: false,
      canManage: false,
    });
    expect(levelOf({ ...membersOnly, workspaceRole: 'commenter', spaceRole: 'editor' })).toEqual({
      level: 'comment',
      canCreatePages: false,
      canManage: false,
    });
  });
});

describe('atLeast', () => {
  it('orders none < view < comment < edit', () => {
    expect(atLeast('edit', 'comment')).toBe(true);
    expect(atLeast('comment', 'comment')).toBe(true);
    expect(atLeast('view', 'comment')).toBe(false);
    expect(atLeast('none', 'view')).toBe(false);
  });
});
