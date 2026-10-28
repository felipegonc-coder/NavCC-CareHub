import { describe, expect, it } from 'vitest';
import { rowDropAt, samePlace, stepPlace, type MeasuredSection } from './row-drop';

/** Rows 36 px high, after a 40 px group header. */
function section(key: string, top: number, rowIds: string[], more = false): MeasuredSection {
  const rows = rowIds.map((rowId, i) => ({
    rowId,
    top: top + 40 + i * 36,
    bottom: top + 40 + (i + 1) * 36,
  }));
  return { key, top, bottom: top + 40 + rowIds.length * 36 + 36, rows, more };
}

const todo = section('todo', 0, ['boiler', 'drain', 'tap']); // 0 to 184
const done = section('done', 184, ['roof']); // 184 to 296

describe('rowDropAt', () => {
  it('puts the row between the rows nearest the pointer', () => {
    expect(rowDropAt([todo, done], 60, true)).toEqual({
      sectionKey: 'todo',
      beforeRowId: 'drain',
      mark: { kind: 'line', y: 76 },
    });
    expect(rowDropAt([todo, done], 41, true)?.beforeRowId).toBe('boiler');
    // Past the last row: the end of the group.
    expect(rowDropAt([todo, done], 150, true)).toMatchObject({
      sectionKey: 'todo',
      beforeRowId: null,
      mark: { kind: 'line', y: 148 },
    });
    expect(rowDropAt([todo, done], 230, true)).toMatchObject({
      sectionKey: 'done',
      beforeRowId: 'roof',
    });
  });

  it('uses the first or last section above or below them all', () => {
    expect(rowDropAt([todo, done], -50, true)?.beforeRowId).toBe('boiler');
    expect(rowDropAt([todo, done], 900, true)).toMatchObject({
      sectionKey: 'done',
      beforeRowId: null,
    });
    expect(rowDropAt([], 10, true)).toBeNull();
  });

  it('has no place at the end of a group with more rows to load', () => {
    const more = section('todo', 0, ['boiler', 'drain'], true);
    expect(rowDropAt([more], 150, true)?.beforeRowId).toBe('drain');
  });

  it('skips rows a dragged row cannot land before (sub-items), but ends after the last line', () => {
    const nested: MeasuredSection = {
      ...todo,
      rows: todo.rows.map((r) => (r.rowId === 'drain' ? { ...r, place: false } : r)),
    };
    expect(rowDropAt([nested], 78, true)?.beforeRowId).toBe('tap');
    expect(rowDropAt([nested], 70, true)?.beforeRowId).toBe('boiler');
    expect(rowDropAt([nested], 150, true)).toMatchObject({
      beforeRowId: null,
      mark: { kind: 'line', y: 148 },
    });
  });

  it('only picks the group when sorted, or when the group shows no rows', () => {
    expect(rowDropAt([todo, done], 60, false)).toEqual({
      sectionKey: 'todo',
      beforeRowId: null,
      mark: { kind: 'box', top: 0, bottom: 184 },
    });
    const collapsed: MeasuredSection = {
      key: 'later',
      top: 296,
      bottom: 336,
      rows: [],
      more: true,
    };
    expect(rowDropAt([todo, done, collapsed], 300, true)).toEqual({
      sectionKey: 'later',
      beforeRowId: null,
      mark: { kind: 'box', top: 296, bottom: 336 },
    });
  });
});

describe('samePlace', () => {
  const ids = ['boiler', 'drain', 'tap'];

  it('is the same place right before itself or the next row', () => {
    const at = (beforeRowId: string | null) => ({ sectionKey: 'todo', beforeRowId });
    expect(samePlace(at('drain'), 'todo', ids, 'drain', true)).toBe(true);
    expect(samePlace(at('tap'), 'todo', ids, 'drain', true)).toBe(true);
    expect(samePlace(at('boiler'), 'todo', ids, 'drain', true)).toBe(false);
    expect(samePlace(at(null), 'todo', ids, 'tap', true)).toBe(true);
    expect(samePlace(at(null), 'todo', ids, 'drain', true)).toBe(false);
  });

  it('is a move when the group changes; sorted, only then', () => {
    expect(samePlace({ sectionKey: 'done', beforeRowId: null }, 'todo', ids, 'tap', true)).toBe(
      false,
    );
    expect(samePlace({ sectionKey: 'todo', beforeRowId: null }, 'todo', ids, 'boiler', false)).toBe(
      true,
    );
  });
});

describe('stepPlace', () => {
  const ids = ['boiler', 'drain', 'tap'];

  it('moves one place up or down', () => {
    expect(stepPlace(ids, 'drain', -1, false)).toBe('boiler');
    expect(stepPlace(ids, 'boiler', 1, false)).toBe('tap');
    expect(stepPlace(ids, 'drain', 1, false)).toBeNull();
  });

  it("can't go past the ends, or past the last loaded row", () => {
    expect(stepPlace(ids, 'boiler', -1, false)).toBeUndefined();
    expect(stepPlace(ids, 'tap', 1, false)).toBeUndefined();
    expect(stepPlace(ids, 'drain', 1, true)).toBeUndefined();
    expect(stepPlace(ids, 'missing', 1, false)).toBeUndefined();
  });
});
