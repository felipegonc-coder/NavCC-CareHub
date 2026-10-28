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
const all: AccessLevel[] = ['none', 'view', 'comment', 'edit_content', 'edit', 'full'];
const limit = (who: Membership) => all.map((level) => limitByRole(level, who));

describe('limitByRole', () => {
  it('leaves an Editor every level', () => {
    expect(limit(editor)).toEqual(all);
  });

  it('keeps a Commenter at Can comment and a Viewer at Can view (RP-03)', () => {
    expect(limit(commenter)).toEqual(['none', 'view', 'comment', 'comment', 'comment', 'comment']);
    expect(limit(viewer)).toEqual(['none', 'view', 'view', 'view', 'view', 'view']);
  });

  it('turns Full access into Can edit without Share (RP-04)', () => {
    const noShare = member(['pages.edit', 'pages.comment']);
    expect(limitByRole('full', noShare)).toBe('edit');
    expect(limitByRole('edit_content', noShare)).toBe('edit_content');
  });

  it('turns Can comment into Can view without Comment, even with Edit', () => {
    expect(limitByRole('comment', member(['pages.edit']))).toBe('view');
    expect(limitByRole('edit', member(['pages.edit']))).toBe('edit');
  });

  it("lets a guest's grants decide, up to Can edit", () => {
    expect(limit(member([], 'guest'))).toEqual([
      'none',
      'view',
      'comment',
      'edit_content',
      'edit',
      'edit',
    ]);
  });
});
