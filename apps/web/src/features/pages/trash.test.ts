import { describe, expect, it } from 'vitest';
import type { TrashItem } from './api';
import {
  ago,
  deletesIn,
  describeItem,
  filterChoices,
  filterTrash,
  insideLabel,
  NO_FILTERS,
} from './trash';

const NOW = Date.parse('2026-10-27T12:00:00Z');
const DAY = 86_400_000;
const at = (offset: number) => new Date(NOW + offset).toISOString();

const item = (id: string, title: string, more: Partial<TrashItem> = {}): TrashItem => ({
  id,
  kind: 'page',
  title,
  icon: null,
  path: ['Support', 'Policies'],
  inside: 0,
  deletedBy: { id: 'sam', name: 'Sam Ortiz' },
  deletedAt: at(-DAY),
  deletesAt: at(29 * DAY),
  canDelete: true,
  ...more,
});

const items = [
  item('refunds', 'Refund steps', { inside: 12 }),
  item('rota', 'Weekend rota', {
    kind: 'database',
    path: ['Care team'],
    deletedBy: { id: 'ana', name: 'Ana Silva' },
    deletedAt: at(-60_000),
  }),
  item('row1', 'Call back Mrs Lee', { kind: 'row', path: ['Care team', 'Calls'] }),
];

describe('filterTrash', () => {
  it('lists the newest first and finds titles whatever their case', () => {
    expect(filterTrash(items, NO_FILTERS).map((entry) => entry.id)).toEqual([
      'rota',
      'refunds',
      'row1',
    ]);
    expect(filterTrash(items, { ...NO_FILTERS, query: ' REFUND ' })).toHaveLength(1);
  });

  it('keeps what the person, space and type filters ask for', () => {
    const ids = (filters: Partial<typeof NO_FILTERS>) =>
      filterTrash(items, { ...NO_FILTERS, ...filters }).map((entry) => entry.id);
    expect(ids({ deletedBy: 'sam' })).toEqual(['refunds', 'row1']);
    expect(ids({ space: 'Care team' })).toEqual(['rota', 'row1']);
    expect(ids({ kind: 'row' })).toEqual(['row1']);
    expect(ids({ space: 'Care team', kind: 'page' })).toEqual([]);
  });

  it('offers the people and spaces that are in Trash, sorted', () => {
    expect(filterChoices(items)).toEqual({
      people: [
        ['ana', 'Ana Silva'],
        ['sam', 'Sam Ortiz'],
      ],
      spaces: ['Care team', 'Support'],
    });
  });
});

describe('how an item reads', () => {
  it('says how long ago', () => {
    expect(ago(at(-20_000), NOW)).toBe('just now');
    expect(ago(at(-5 * 60_000), NOW)).toBe('5 minutes ago');
    expect(ago(at(-3 * 3_600_000), NOW)).toBe('3 hours ago');
    expect(ago(at(-DAY), NOW)).toBe('yesterday');
    expect(ago(at(-12 * DAY), NOW)).toBe('12 days ago');
  });

  it('counts the days left, in red for the last 3', () => {
    expect(deletesIn(item('a', 'A'), NOW)).toEqual({ label: 'Deletes in 29 days', soon: false });
    expect(deletesIn(item('a', 'A', { deletesAt: at(3 * DAY) }), NOW).soon).toBe(true);
    expect(deletesIn(item('a', 'A', { deletesAt: at(DAY / 2) }), NOW).label).toBe(
      'Deletes in 1 day',
    );
    expect(deletesIn(item('a', 'A', { deletesAt: at(-1) }), NOW).label).toBe('Deletes today');
  });

  it('counts what went with it', () => {
    expect(insideLabel(0)).toBe('');
    expect(insideLabel(1)).toBe('and 1 sub-page');
    expect(insideLabel(12)).toBe('and 12 sub-pages');
  });

  it('reads out the title, where it was, who deleted it and when it goes', () => {
    expect(describeItem(items[0] as TrashItem, NOW)).toBe(
      'Refund steps, in Support › Policies, deleted by Sam Ortiz yesterday, deletes in 29 days',
    );
    expect(describeItem(item('x', '  ', { path: [], deletedBy: null }), NOW)).toBe(
      'Untitled, deleted yesterday, deletes in 29 days',
    );
  });
});
