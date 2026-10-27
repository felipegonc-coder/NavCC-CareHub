import { describe, expect, it } from 'vitest';
import { cleanTitle, patchCached, startItems, tabTitle, TITLE_MAX } from './page';

describe('cleanTitle', () => {
  it('keeps a title on one line, up to 2,000 characters', () => {
    expect(cleanTitle('Refund\nsteps\r\nfor April')).toBe('Refund steps for April');
    expect(cleanTitle('x'.repeat(TITLE_MAX + 5))).toHaveLength(TITLE_MAX);
  });
});

describe('tabTitle', () => {
  it('shows the emoji and the title, or Untitled', () => {
    const rocket = { type: 'emoji', emoji: '🚀' } as const;
    expect(tabTitle({ title: 'Launch plan', icon: rocket })).toBe('Care Hub · 🚀 Launch plan');
    expect(tabTitle({ title: '  ', icon: null })).toBe('Care Hub · Untitled');
  });
});

describe('startItems', () => {
  it('picks the database views and Form from the "/" items, in the spec order', () => {
    const items = ['Form', 'Text', 'Board view', 'Table', 'Table view', 'Bulleted list'].map(
      (title) => ({ title }),
    );
    expect(startItems(items).map((choice) => choice.label)).toEqual(['Table', 'Board', 'Form']);
    expect(startItems(items)[0]?.item.title).toBe('Table view');
  });

  it('is empty without them', () => {
    expect(startItems([{ title: 'Text' }])).toEqual([]);
  });
});

describe('patchCached', () => {
  const policies = { id: 'p1', title: 'Policies', icon: null };

  it('renames the page in lists, in its own data and in breadcrumbs', () => {
    expect(patchCached([policies, { id: 'p2', title: 'Other' }], 'p1', { title: 'Rules' })).toEqual(
      [
        { id: 'p1', title: 'Rules', icon: null },
        { id: 'p2', title: 'Other' },
      ],
    );
    const sub = { id: 'p3', title: 'Refunds', path: [{ id: 's1', title: 'Support' }, policies] };
    expect(patchCached(sub, 'p1', { title: 'Rules' })).toEqual({
      ...sub,
      path: [
        { id: 's1', title: 'Support' },
        { ...policies, title: 'Rules' },
      ],
    });
  });

  it('sets only fields the data has, and leaves other data alone', () => {
    const rocket = { type: 'emoji', emoji: '🚀' } as const;
    expect(patchCached({ id: 'p1', title: 'Policies' }, 'p1', { icon: rocket })).toEqual({
      id: 'p1',
      title: 'Policies',
    });
    const trash = { items: [], retentionDays: 30 };
    expect(patchCached(trash, 'p1', { title: 'Rules' })).toBe(trash);
    expect(patchCached(undefined, 'p1', { title: 'Rules' })).toBeUndefined();
  });
});
