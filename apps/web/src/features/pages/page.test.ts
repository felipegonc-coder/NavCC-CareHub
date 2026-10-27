import { describe, expect, it } from 'vitest';
import {
  cleanTitle,
  editedLabel,
  editedWhen,
  foldCrumbs,
  patchCached,
  stampLabel,
  startItems,
  tabTitle,
  TITLE_MAX,
} from './page';

const NOW = Date.parse('2026-10-27T18:00:00Z');
const before = (ms: number) => new Date(NOW - ms).toISOString();
const MINUTE = 60_000;

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

describe('foldCrumbs', () => {
  it('shows up to 4 levels as they are', () => {
    expect(foldCrumbs(['Support', 'Policies', 'Refunds', 'April'])).toEqual({
      first: ['Support', 'Policies', 'Refunds', 'April'],
      folded: [],
      last: [],
    });
  });

  it('folds the middle past 4 levels, keeping the first and the last two', () => {
    expect(foldCrumbs(['Support', 'Policies', 'Refunds', 'April', 'Week 1'])).toEqual({
      first: ['Support'],
      folded: ['Policies', 'Refunds'],
      last: ['April', 'Week 1'],
    });
    expect(foldCrumbs(['a', 'b', 'c', 'd', 'e', 'f', 'g']).folded).toEqual(['b', 'c', 'd', 'e']);
  });
});

describe('editedLabel', () => {
  it('says how long ago, then the date after a week', () => {
    expect(editedLabel(before(20_000), NOW)).toBe('Edited just now');
    expect(editedLabel(before(2 * MINUTE), NOW)).toBe('Edited 2m ago');
    expect(editedLabel(before(185 * MINUTE), NOW)).toBe('Edited 3h ago');
    expect(editedLabel(before(4 * 24 * 60 * MINUTE), NOW)).toBe('Edited 4d ago');
    expect(editedLabel('2026-10-12T18:00:00Z', NOW)).toBe('Edited Oct 12, 2026');
  });
});

describe('stamps', () => {
  const stamp = { by: { id: 'u1', name: 'Sam Ortiz' }, at: '2026-10-20T18:00:00Z' };

  it('names who and when', () => {
    expect(editedWhen(stamp)).toMatch(/^Edited by Sam Ortiz, Oct 20, 2026, \d{1,2}:00\s[AP]M$/);
    expect(stampLabel('Archived', stamp)).toBe('Archived by Sam Ortiz on Oct 20, 2026');
    expect(stampLabel('Locked', stamp)).toBe('Locked by Sam Ortiz');
  });

  it('leaves the name out when nobody is known', () => {
    expect(stampLabel('Locked', { by: null, at: stamp.at })).toBe('Locked');
    expect(editedWhen({ by: null, at: stamp.at })).toMatch(/^Edited, Oct 20, 2026/);
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
