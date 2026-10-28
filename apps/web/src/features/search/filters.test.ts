import { describe, expect, it } from 'vitest';
import { cleanFilters, hasFilters, toggled, typeLabel } from './filters';

describe('the filter chips', () => {
  it('send only the filters that are on', () => {
    expect(
      cleanFilters({ titleOnly: false, in: [], types: ['page'], includeArchived: true }),
    ).toEqual({ types: ['page'], includeArchived: true });
    expect(hasFilters({ titleOnly: false, createdBy: [] })).toBe(false);
    expect(hasFilters({ titleOnly: true })).toBe(true);
    expect(toggled(['a', 'b'], 'a')).toEqual(['b']);
    expect(toggled(undefined, 'a')).toEqual(['a']);
  });

  it('say what is picked', () => {
    expect(typeLabel(['row', 'page'])).toBe('Type: Pages, Rows');
    expect(typeLabel(undefined)).toBe('Type');
  });
});
