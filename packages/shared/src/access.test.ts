import { describe, expect, it } from 'vitest';
import { ACCESS_LEVELS, atLeast, type GrantLevel } from './index';

describe('access levels', () => {
  it('go from none to full', () => {
    expect(ACCESS_LEVELS).toEqual(['none', 'view', 'comment', 'edit_content', 'edit', 'full']);
  });

  it('compare with atLeast', () => {
    expect(atLeast('edit', 'edit')).toBe(true);
    expect(atLeast('full', 'view')).toBe(true);
    expect(atLeast('comment', 'edit')).toBe(false);
    expect(atLeast('none', 'view')).toBe(false);
    expect(atLeast('view', 'none')).toBe(true);
  });

  it('put edit_content between comment and edit', () => {
    expect(atLeast('edit_content', 'comment')).toBe(true);
    expect(atLeast('edit_content', 'edit')).toBe(false);
    expect(atLeast('edit', 'edit_content')).toBe(true);
  });

  it('let grants also give rows_only', () => {
    const grants: GrantLevel[] = ['rows_only', 'edit_content', 'full'];
    expect(grants.filter((grant) => grant !== 'rows_only' && atLeast(grant, 'edit'))).toEqual([
      'full',
    ]);
  });
});
