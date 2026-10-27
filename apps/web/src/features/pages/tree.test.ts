import { describe, expect, it } from 'vitest';
import {
  FIRST_STEP,
  groupChildren,
  keyAction,
  nestRows,
  parentRow,
  pathTo,
  stepFocus,
  visibleRows,
  type TreeEntry,
} from './tree';

const entry = (id: string, parentId: string | null, position: string): TreeEntry => ({
  id,
  parentId,
  position,
});

// Fictional pages: Onboarding > Week 1 > Day 1, plus Refund steps and Holiday rota.
const nodes = [
  entry('rota', null, 'c'),
  entry('onboarding', null, 'a'),
  entry('week1', 'onboarding', 'a'),
  entry('day1', 'week1', 'a'),
  entry('refunds', null, 'b'),
];

const byParent = groupChildren(nodes);

describe('groupChildren', () => {
  it('sorts siblings by plain string order of position', () => {
    expect(byParent.get(null)?.map((n) => n.id)).toEqual(['onboarding', 'refunds', 'rota']);
  });

  it('puts entries whose parent is hidden at the top level', () => {
    const grouped = groupChildren([entry('day1', 'week1', 'a'), entry('refunds', null, 'b')]);
    expect(grouped.get(null)?.map((n) => n.id)).toEqual(['day1', 'refunds']);
  });

  it('breaks position ties by ID so the order is stable', () => {
    const grouped = groupChildren([entry('b', null, 'a'), entry('a', null, 'a')]);
    expect(grouped.get(null)?.map((n) => n.id)).toEqual(['a', 'b']);
  });
});

describe('visibleRows', () => {
  it('shows only the top level when nothing is open', () => {
    const rows = visibleRows(byParent, { expanded: new Set() });
    expect(rows.map((r) => r.key)).toEqual(['onboarding', 'refunds', 'rota']);
    expect(rows[0]).toEqual(
      expect_node({ key: 'onboarding', level: 1, posInSet: 1, setSize: 3, expandable: true }),
    );
    expect(rows[1]?.kind === 'node' && rows[1].expandable).toBe(false);
  });

  it('shows open entries with their children one level down', () => {
    const rows = visibleRows(byParent, { expanded: new Set(['onboarding', 'week1']) });
    expect(rows.map((r) => `${r.key}@${r.level}`)).toEqual([
      'onboarding@1',
      'week1@2',
      'day1@3',
      'refunds@1',
      'rota@1',
    ]);
  });

  it('shows "No pages inside" for an open entry without sub-pages', () => {
    const rows = visibleRows(byParent, { expanded: new Set(['refunds']) });
    expect(rows.map((r) => r.kind)).toEqual(['node', 'node', 'empty', 'node']);
    expect(rows[1]?.kind === 'node' && rows[1].expandable).toBe(true);
  });

  it('shows the extra row (database views) instead of "No pages inside"', () => {
    const rows = visibleRows(byParent, {
      expanded: new Set(['refunds']),
      hasExtra: (node) => node.id === 'refunds',
    });
    expect(rows.map((r) => r.kind)).toEqual(['node', 'node', 'extra', 'node']);
  });

  it('keys rows by scope so the same page can be open in one section only', () => {
    const rows = visibleRows(byParent, { expanded: new Set(['fav:onboarding']), scope: 'fav' });
    expect(rows.map((r) => r.key)).toEqual([
      'fav:onboarding',
      'fav:week1',
      'fav:refunds',
      'fav:rota',
    ]);
  });

  it('starts from an entry when asked', () => {
    const rows = visibleRows(byParent, {
      expanded: new Set(),
      rootId: 'onboarding',
      firstLevel: 2,
    });
    expect(rows.map((r) => `${r.key}@${r.level}`)).toEqual(['week1@2']);
  });

  it('shows 50 entries per level, then "Show 20 more"', () => {
    const many = Array.from({ length: 75 }, (_, i) =>
      entry(`p${i}`, null, String(i).padStart(3, '0')),
    );
    const grouped = groupChildren(many);
    let rows = visibleRows(grouped, { expanded: new Set() });
    expect(rows).toHaveLength(FIRST_STEP + 1);
    expect(rows.at(-1)).toEqual({
      kind: 'more',
      key: 'top:more',
      parentId: null,
      level: 1,
      posInSet: 51,
    });
    rows = visibleRows(grouped, { expanded: new Set(), shown: new Map([[null, 70]]) });
    expect(rows).toHaveLength(71);
    rows = visibleRows(grouped, { expanded: new Set(), shown: new Map([[null, 90]]) });
    expect(rows).toHaveLength(75);
  });

  it('never loops on a cycle in bad data', () => {
    const loop = groupChildren([entry('a', 'b', 'a'), entry('b', 'a', 'a'), entry('c', null, 'a')]);
    const rows = visibleRows(loop, { expanded: new Set(['a', 'b', 'c']) });
    expect(rows.length).toBeLessThan(10);
  });
});

describe('keyboard', () => {
  const rows = visibleRows(byParent, { expanded: new Set(['onboarding']) });
  // onboarding@1 (open), week1@2 (closed, has day1), refunds@1, rota@1

  it('moves with the arrows, Home and End', () => {
    expect(stepFocus(rows, 0, 1)).toBe(1);
    expect(stepFocus(rows, 0, -1)).toBe(0);
    expect(keyAction(rows, 1, 'ArrowDown')).toEqual({ type: 'focus', index: 2 });
    expect(keyAction(rows, 3, 'Home')).toEqual({ type: 'focus', index: 0 });
    expect(keyAction(rows, 0, 'End')).toEqual({ type: 'focus', index: 3 });
  });

  it('opens with → then goes to the first child; ← closes then goes to the parent', () => {
    expect(keyAction(rows, 1, 'ArrowRight')).toEqual({ type: 'expand', key: 'week1' });
    expect(keyAction(rows, 0, 'ArrowRight')).toEqual({ type: 'focus', index: 1 });
    expect(keyAction(rows, 0, 'ArrowLeft')).toEqual({ type: 'collapse', key: 'onboarding' });
    expect(keyAction(rows, 1, 'ArrowLeft')).toEqual({ type: 'focus', index: 0 });
    expect(parentRow(rows, 2)).toBe(-1);
    expect(keyAction(rows, 2, 'ArrowRight')).toBeNull();
  });

  it('opens with Enter, shows the menu with Shift+F10 and renames with F2', () => {
    expect(keyAction(rows, 2, 'Enter')).toEqual({ type: 'open', index: 2 });
    expect(keyAction(rows, 2, 'F10', { shift: true })).toEqual({ type: 'menu', index: 2 });
    expect(keyAction(rows, 2, 'F10')).toBeNull();
    expect(keyAction(rows, 2, 'F2')).toEqual({ type: 'rename', index: 2 });
  });
});

describe('nesting rows', () => {
  it('puts the deeper rows that follow a row inside it', () => {
    const rows = [
      { id: 'a', level: 1 },
      { id: 'b', level: 2 },
      { id: 'c', level: 3 },
      { id: 'd', level: 2 },
      { id: 'e', level: 1 },
    ];
    const shape = nestRows(rows, (row, inside: string[]): string =>
      inside.length > 0 ? `${row.id}(${inside.join(' ')})` : row.id,
    );
    expect(shape).toEqual(['a(b(c) d)', 'e']);
    expect(nestRows([], (row, inside) => inside)).toEqual([]);
  });
});

describe('finding entries', () => {
  it('gives the path from the top down to the parent, or null when missing', () => {
    expect(pathTo(byParent, 'day1')).toEqual(['onboarding', 'week1']);
    expect(pathTo(byParent, 'rota')).toEqual([]);
    expect(pathTo(byParent, 'nowhere')).toBeNull();
  });
});

function expect_node(partial: Record<string, unknown>) {
  const row = visibleRows(byParent, { expanded: new Set() }).find((r) => r.key === partial.key);
  return { ...row, ...partial };
}
