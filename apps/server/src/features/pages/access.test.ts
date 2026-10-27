import type { AccessLevel, PermissionKey } from '@carehub/shared';
import { describe, expect, it } from 'vitest';
import { limitByRole, type Membership } from './access';

const member = (permissions: PermissionKey[], kind: Membership['kind'] = 'member'): Membership => ({
  workspaceId: '00000000-0000-4000-8000-000000000001',
  kind,
  roleId: kind === 'guest' ? null : '00000000-0000-4000-8000-000000000002',
  permissions: new Set(permissions),
  isAdmin: permissions.includes('workspace.admin'),
});

const editor = member(['pages.edit', 'pages.create', 'pages.comment', 'pages.share']);
const commenter = member(['pages.comment']);
const viewer = member([]);
const levels: AccessLevel[] = ['none', 'view', 'comment', 'edit_content', 'edit', 'full'];

describe('limitByRole', () => {
  it('leaves an Editor every level', () => {
    expect(levels.map((level) => limitByRole(level, editor))).toEqual(levels);
  });

  it('keeps a Commenter at Can comment and a Viewer at Can view (RP-03)', () => {
    expect(levels.map((level) => limitByRole(level, commenter))).toEqual([
      'none',
      'view',
      'comment',
      'comment',
      'comment',
      'comment',
    ]);
    expect(levels.map((level) => limitByRole(level, viewer))).toEqual([
      'none',
      'view',
      'view',
      'view',
      'view',
      'view',
    ]);
  });

  it('turns Full access into Can edit without Share (RP-04)', () => {
    const noShare = member(['pages.edit', 'pages.comment']);
    expect(limitByRole('full', noShare)).toBe('edit');
    expect(limitByRole('edit_content', noShare)).toBe('edit_content');
  });

  it('turns Can comment into Can view without Comment, even with Edit', () => {
    const noComment = member(['pages.edit', 'pages.share']);
    expect(limitByRole('comment', noComment)).toBe('view');
    expect(limitByRole('edit', noComment)).toBe('edit');
  });

  it('never gives a guest Full access', () => {
    const guest = member([], 'guest');
    expect(limitByRole('full', guest)).toBe('edit');
    expect(limitByRole('comment', guest)).toBe('comment');
    expect(limitByRole('none', guest)).toBe('none');
  });
});
