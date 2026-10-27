import { describe, expect, it, vi } from 'vitest';
import {
  LOOP_MESSAGE,
  TOO_DEEP_MESSAGE,
  checkSubItemEdits,
  storedParentId,
  subItemCounts,
  subItemLines,
  subItemTree,
} from './hierarchy';
import type { SubItemNode } from './hierarchy';
import type { Row } from './types';

const settings = { parentPropertyId: 'parent', childrenPropertyId: 'subs' };

function row(id: string, parent?: string | null, values: Row['values'] = {}): Row {
  return {
    id,
    title: id,
    values: parent ? { parent: [parent], ...values } : values,
    createdAt: '2026-10-01T15:00:00.000Z',
    createdBy: 'u-avery',
    editedAt: '2026-10-01T15:00:00.000Z',
    editedBy: 'u-avery',
    uniqueNumber: null,
  };
}

/** The tree as indented ids; "~" marks rows shown as context. */
function outline(nodes: readonly SubItemNode[]): string[] {
  return nodes.flatMap((n) => [
    `${'  '.repeat(n.depth)}${n.context ? '~' : ''}${n.row.id}`,
    ...outline(n.children),
  ]);
}

/** A chain r0 ← r1 ← … where each row is the parent of the next. */
function chain(count: number, prefix = 'r'): Row[] {
  return Array.from({ length: count }, (_, i) =>
    row(`${prefix}${i}`, i ? `${prefix}${i - 1}` : null),
  );
}

const done = (r: Row) => r.values.done === true;

describe('messages', () => {
  it('match the spec word for word', () => {
    expect(LOOP_MESSAGE).toBe('This would make a loop.');
    expect(TOO_DEEP_MESSAGE).toBe('Up to 10 levels deep.');
  });
});

describe('storedParentId', () => {
  it('reads the first link of Parent item', () => {
    expect(storedParentId(row('a', 'p'), settings)).toBe('p');
    expect(storedParentId(row('a', null, { parent: ['p', 'q'] }), settings)).toBe('p');
  });
  it('is null when the cell is empty or malformed', () => {
    expect(storedParentId(row('a'), settings)).toBeNull();
    expect(storedParentId(row('a', null, { parent: [] }), settings)).toBeNull();
    expect(storedParentId(row('a', null, { parent: 'p' }), settings)).toBeNull();
    expect(storedParentId(row('a', null, { parent: [3, ''] }), settings)).toBeNull();
  });
});

describe('subItemTree: nested', () => {
  it('puts sub-items under their parent and keeps the view order on every level', () => {
    const rows = [row('c2', 'p'), row('q'), row('p'), row('c1', 'p'), row('g', 'c1')];
    expect(outline(subItemTree(rows, settings))).toEqual(['q', 'p', '  c2', '  c1', '    g']);
  });
  it('gives depth, parent and the number of sub-items shown', () => {
    const [p, c1] = subItemTree(
      [row('p'), row('c1', 'p'), row('c2', 'p'), row('g', 'c1')],
      settings,
    );
    expect(p).toMatchObject({ depth: 0, parentId: null, childCount: 2, context: false });
    expect(c1).toBeUndefined();
    const first = p?.children[0];
    expect(first).toMatchObject({ depth: 1, parentId: 'p', childCount: 1 });
    expect(first?.children[0]).toMatchObject({ depth: 2, parentId: 'c1', childCount: 0 });
  });
  it('shows a row at the top level when its parent is not among the rows, without naming it', () => {
    const tree = subItemTree([row('a', 'deleted-or-hidden'), row('b')], settings);
    expect(outline(tree)).toEqual(['a', 'b']);
    expect(tree[0]?.parentId).toBeNull();
  });
  it('treats a row that names itself as its parent as a top-level row', () => {
    expect(outline(subItemTree([row('a', 'a'), row('b', 'a')], settings))).toEqual(['a', '  b']);
  });
  it('cuts a stored loop at its first row in view order and still shows every row once', () => {
    const rows = [row('b', 'a'), row('a', 'b'), row('c', 'a')];
    expect(outline(subItemTree(rows, settings))).toEqual(['b', '  a', '    c']);
  });
  it('moves rows stored deeper than 10 levels to the top level', () => {
    const tree = subItemTree(chain(12), settings);
    const lines = outline(tree);
    expect(lines).toHaveLength(12);
    expect(lines[9]).toBe(`${'  '.repeat(9)}r9`);
    expect(tree.map((n) => n.row.id)).toEqual(['r0', 'r10']);
    expect(outline(tree.slice(1))).toEqual(['r10', '  r11']);
  });
  it('uses each row once when the same row is passed twice', () => {
    const p = row('p');
    expect(outline(subItemTree([p, row('c', 'p'), p], settings))).toEqual(['p', '  c']);
  });
  it('shows every matching row on its own when sub-items are off', () => {
    const rows = [row('p', null, { done: true }), row('c', 'p', { done: true }), row('d', 'p')];
    expect(outline(subItemTree(rows, null, { matches: done }))).toEqual(['p', 'c']);
  });
});

describe('subItemTree: flattened and parents only', () => {
  const rows = [
    row('c', 'p', { done: true }),
    row('p'),
    row('q', null, { done: true }),
    row('orphan', 'hidden', { done: true }),
  ];
  it('flattened shows every matching row on its own, in the view order', () => {
    const tree = subItemTree(rows, settings, { mode: 'flattened', matches: done });
    expect(outline(tree)).toEqual(['c', 'q', 'orphan']);
    expect(tree.every((n) => n.depth === 0 && n.childCount === 0 && n.parentId === null)).toBe(
      true,
    );
    expect(outline(subItemTree(rows, settings, { mode: 'flattened' }))).toEqual([
      'c',
      'p',
      'q',
      'orphan',
    ]);
  });
  it('parents only shows matching top-level rows, counting rows whose parent is hidden', () => {
    expect(outline(subItemTree(rows, settings, { mode: 'parents_only' }))).toEqual([
      'p',
      'q',
      'orphan',
    ]);
    expect(outline(subItemTree(rows, settings, { mode: 'parents_only', matches: done }))).toEqual([
      'q',
      'orphan',
    ]);
  });
  it('is nested when no mode is given (or undefined is passed)', () => {
    expect(outline(subItemTree(rows, settings, { mode: undefined }))).toEqual([
      'p',
      '  c',
      'q',
      'orphan',
    ]);
  });
});

describe('subItemTree: filters', () => {
  const rows = [
    row('p', null, { done: true }),
    row('p1', 'p'),
    row('p2', 'p', { done: true }),
    row('q'),
    row('q1', 'q', { done: true }),
    row('q2', 'q'),
    row('r'),
    row('r1', 'r'),
    row('r1a', 'r1', { done: true }),
  ];
  it('by default filters top-level rows, which show with all their sub-items', () => {
    const tree = subItemTree(rows, settings, { matches: done });
    expect(outline(tree)).toEqual(['p', '  p1', '  p2']);
  });
  it('with filterSubItems, a matching sub-item shows under its parents, marked as context', () => {
    const tree = subItemTree(rows, settings, { matches: done, filterSubItems: true });
    expect(outline(tree)).toEqual(['p', '  p2', '~q', '  q1', '~r', '  ~r1', '    r1a']);
    expect(tree[1]).toMatchObject({ context: true, childCount: 1 });
  });
  it('with filterSubItems, a matching parent hides sub-items that do not match', () => {
    const tree = subItemTree([row('p', null, { done: true }), row('p1', 'p')], settings, {
      matches: done,
      filterSubItems: true,
    });
    expect(outline(tree)).toEqual(['p']);
    expect(tree[0]?.childCount).toBe(0);
  });
  it('shows every row when there is no filter, whatever filterSubItems says', () => {
    expect(outline(subItemTree(rows, settings, { filterSubItems: true }))).toHaveLength(9);
  });
  it('asks about each row once', () => {
    const matches = vi.fn(done);
    subItemTree(rows, settings, { matches, filterSubItems: true });
    expect(matches).toHaveBeenCalledTimes(rows.length);
  });
});

describe('subItemLines', () => {
  const tree = subItemTree(
    [row('p'), row('c', 'p'), row('g', 'c', { done: true }), row('q', null, { done: true })],
    settings,
    { matches: done, filterSubItems: true },
  );
  it('lists sub-items after an expanded parent only', () => {
    expect(subItemLines(tree, () => false).map((l) => l.row.id)).toEqual(['p', 'q']);
    const lines = subItemLines(tree, () => true);
    expect(lines.map((l) => [l.row.id, l.depth, l.expanded, l.childCount, l.context])).toEqual([
      ['p', 0, true, 1, true],
      ['c', 1, true, 1, true],
      ['g', 2, false, 0, false],
      ['q', 0, false, 0, false],
    ]);
  });
  it('lets the screen decide per row, for example expanding context rows', () => {
    const lines = subItemLines(tree, (n) => n.context);
    expect(lines.map((l) => l.row.id)).toEqual(['p', 'c', 'g', 'q']);
    expect(lines[2]?.parentId).toBe('c');
  });
});

describe('subItemCounts', () => {
  it('counts the sub-items each row has among the rows given', () => {
    const counts = subItemCounts(
      [row('p'), row('c1', 'p'), row('c2', 'p'), row('g', 'c1'), row('x', 'hidden')],
      settings,
    );
    expect([...counts]).toEqual([
      ['p', 2],
      ['c1', 1],
    ]);
  });
});

describe('checkSubItemEdits', () => {
  const rows = [row('a'), row('b', 'a'), row('c', 'b'), row('q')];
  const parentEdit = (rowId: string, parent: string | null) => ({
    rowId,
    propertyId: 'parent',
    value: parent ? [parent] : null,
  });
  it('refuses making a row its own parent or the parent of its ancestor', () => {
    expect(checkSubItemEdits(rows, settings, [parentEdit('a', 'a')])).toBe(LOOP_MESSAGE);
    expect(checkSubItemEdits(rows, settings, [parentEdit('a', 'b')])).toBe(LOOP_MESSAGE);
    expect(checkSubItemEdits(rows, settings, [parentEdit('a', 'c')])).toBe(LOOP_MESSAGE);
  });
  it('refuses adding a row or one of its ancestors to its own Sub-items', () => {
    const subs = (rowId: string, value: string[]) => ({ rowId, propertyId: 'subs', value });
    expect(checkSubItemEdits(rows, settings, [subs('c', ['a'])])).toBe(LOOP_MESSAGE);
    expect(checkSubItemEdits(rows, settings, [subs('q', ['q'])])).toBe(LOOP_MESSAGE);
    expect(checkSubItemEdits(rows, settings, [subs('q', ['b'])])).toBeNull();
  });
  it('allows moves that keep a tree, and clearing a parent', () => {
    expect(checkSubItemEdits(rows, settings, [parentEdit('c', 'q')])).toBeNull();
    expect(checkSubItemEdits(rows, settings, [parentEdit('q', 'c')])).toBeNull();
    expect(checkSubItemEdits(rows, settings, [parentEdit('b', null)])).toBeNull();
    expect(
      checkSubItemEdits(rows, settings, [{ rowId: 'b', propertyId: 'parent', value: [] }]),
    ).toBeNull();
  });
  it('checks edits saved together as one change', () => {
    expect(checkSubItemEdits(rows, settings, [parentEdit('q', 'a'), parentEdit('a', 'q')])).toBe(
      LOOP_MESSAGE,
    );
    expect(checkSubItemEdits(rows, settings, [parentEdit('q', 'c'), parentEdit('a', 'q')])).toBe(
      LOOP_MESSAGE,
    );
    expect(checkSubItemEdits(rows, settings, [parentEdit('a', 'c')])).toBe(LOOP_MESSAGE);
    expect(
      checkSubItemEdits(rows, settings, [parentEdit('b', null), parentEdit('a', 'c')]),
    ).toBeNull();
    expect(
      checkSubItemEdits(rows, settings, [parentEdit('c', null), parentEdit('a', 'c')]),
    ).toBeNull();
  });
  it('sends sub-items left out of a Sub-items edit to the top level', () => {
    const edit = { rowId: 'b', propertyId: 'subs', value: null };
    expect(checkSubItemEdits(rows, settings, [edit, parentEdit('b', 'c')])).toBeNull();
    expect(checkSubItemEdits(rows, settings, [parentEdit('b', 'c')])).toBe(LOOP_MESSAGE);
  });
  it('refuses chains deeper than 10 levels and allows exactly 10', () => {
    const deep = [...chain(10), ...chain(3, 's')];
    expect(checkSubItemEdits(deep, settings, [parentEdit('s0', 'r9')])).toBe(TOO_DEEP_MESSAGE);
    expect(checkSubItemEdits(deep, settings, [parentEdit('s2', 'r9')])).toBe(TOO_DEEP_MESSAGE);
    expect(checkSubItemEdits(deep, settings, [parentEdit('s2', 'r8')])).toBeNull();
    expect(checkSubItemEdits(deep, settings, [parentEdit('s0', 'r7')])).toBe(TOO_DEEP_MESSAGE);
    expect(checkSubItemEdits(deep, settings, [parentEdit('s0', 'r6')])).toBeNull();
    const subs = { rowId: 'r6', propertyId: 'subs', value: ['r7', 's0'] };
    expect(checkSubItemEdits(deep, settings, [subs])).toBeNull();
  });
  it('counts a parent missing from the rows as a top-level row', () => {
    const deep = chain(10);
    expect(checkSubItemEdits(deep, settings, [parentEdit('r9', 'hidden')])).toBeNull();
    expect(checkSubItemEdits(deep, settings, [parentEdit('r0', 'hidden')])).toBe(TOO_DEEP_MESSAGE);
  });
  it('ignores edits to other properties', () => {
    const other = { rowId: 'a', propertyId: 'blocking', value: ['c'] };
    expect(checkSubItemEdits(rows, settings, [other])).toBeNull();
  });
});
