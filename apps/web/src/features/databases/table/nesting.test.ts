import { describe, expect, it } from 'vitest';
import { isOpen, isTopLevel, siblingIds, visibleRows, type NestedRow } from './nesting';

// sink > (heater > boiler), tap; drain
const rows: NestedRow[] = [
  { id: 'sink', depth: 0, parentId: null, childCount: 2 },
  { id: 'heater', depth: 1, parentId: 'sink', childCount: 1 },
  { id: 'boiler', depth: 2, parentId: 'heater', childCount: 0 },
  { id: 'tap', depth: 1, parentId: 'sink', childCount: 0 },
  { id: 'drain', depth: 0, parentId: null, childCount: 0 },
];
const ids = (list: readonly NestedRow[]) => list.map((r) => r.id);

describe('isOpen', () => {
  it('starts closed, except context rows; what the person chose wins', () => {
    expect(isOpen(rows[0] as NestedRow, new Map())).toBe(false);
    expect(isOpen({ id: 'x', childCount: 1, context: true }, new Map())).toBe(true);
    expect(isOpen({ id: 'x', childCount: 1, context: true }, new Map([['x', false]]))).toBe(false);
    expect(isOpen(rows[0] as NestedRow, new Map([['sink', true]]))).toBe(true);
    // No sub-items: never open.
    expect(isOpen(rows[4] as NestedRow, new Map([['drain', true]]))).toBe(false);
  });
});

describe('visibleRows', () => {
  it('shows sub-items only under open rows that show', () => {
    expect(ids(visibleRows(rows, () => false))).toEqual(['sink', 'drain']);
    expect(ids(visibleRows(rows, (r) => r.id === 'sink'))).toEqual([
      'sink',
      'heater',
      'tap',
      'drain',
    ]);
    expect(ids(visibleRows(rows, (r) => r.id !== 'drain'))).toEqual(ids(rows));
    // An open row under a closed one stays hidden.
    expect(ids(visibleRows(rows, (r) => r.id === 'heater'))).toEqual(['sink', 'drain']);
  });

  it('shows a row whose parent is not listed', () => {
    const page = [{ id: 'boiler', depth: 2, parentId: 'heater' }, { id: 'drain' }];
    expect(ids(visibleRows(page, () => false))).toEqual(['boiler', 'drain']);
  });
});

describe('siblingIds and isTopLevel', () => {
  it('lists the rows under the same parent', () => {
    expect(siblingIds(rows, rows[3] as NestedRow)).toEqual(['heater', 'tap']);
    expect(siblingIds(rows, rows[0] as NestedRow)).toEqual(['sink', 'drain']);
    expect(rows.filter(isTopLevel).map((r) => r.id)).toEqual(['sink', 'drain']);
    expect(isTopLevel({ id: 'flat' })).toBe(true);
  });
});
