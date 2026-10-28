import { describe, expect, it } from 'vitest';
import { allTicked, extendTo, NO_SELECTION, selectAll, selectedNow, tick } from './selection';

const lines = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ key: `line-${id}`, row: { id } }));

describe('tick', () => {
  it('ticks and unticks one row and keeps it as the anchor', () => {
    const once = tick(NO_SELECTION, lines, 'line-b', false);
    expect([...once.ids]).toEqual(['b']);
    expect(once.anchor).toBe('line-b');
    expect(tick(once, lines, 'line-b', false).ids.size).toBe(0);
  });

  it('ticks every row between the anchor and a Shift-click, either way', () => {
    const start = tick(NO_SELECTION, lines, 'line-b', false);
    expect([...tick(start, lines, 'line-d', true).ids].sort()).toEqual(['b', 'c', 'd']);
    const up = tick(tick(NO_SELECTION, lines, 'line-d', false), lines, 'line-a', true);
    expect([...up.ids].sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('unticks the range when the Shift-clicked row was ticked', () => {
    const all = selectAll(lines);
    const anchored = tick(all, lines, 'line-a', false);
    expect([...tick(anchored, lines, 'line-c', true).ids].sort()).toEqual(['d', 'e']);
  });

  it('ticks only the row when the anchor has left the screen', () => {
    const start = { ids: new Set(['x']), anchor: 'line-x', base: new Set(['x']), end: null };
    expect([...tick(start, lines, 'line-c', true).ids].sort()).toEqual(['c', 'x']);
  });

  it('ignores a line that is not on screen', () => {
    expect(tick(NO_SELECTION, lines, 'line-z', false)).toBe(NO_SELECTION);
  });
});

describe('extendTo', () => {
  it('ticks from the anchor to the row moved to, and shrinks when moving back', () => {
    const start = tick(NO_SELECTION, lines, 'line-e', false);
    const down = extendTo(start, lines, 'line-b', 'line-c');
    expect([...down.ids].sort()).toEqual(['b', 'c', 'e']);
    expect(down.anchor).toBe('line-b');
    const further = extendTo(down, lines, 'line-c', 'line-d');
    expect([...further.ids].sort()).toEqual(['b', 'c', 'd', 'e']);
    const back = extendTo(further, lines, 'line-d', 'line-a');
    expect([...back.ids].sort()).toEqual(['a', 'b', 'e']);
  });

  it('starts a new range from where the move starts after other moves', () => {
    const start = { ids: new Set(['x']), anchor: 'line-x', base: new Set<string>(), end: null };
    expect([...extendTo(start, lines, 'line-a', 'line-b').ids].sort()).toEqual(['a', 'b', 'x']);
  });
});

describe('selection helpers', () => {
  it('selects every row on screen', () => {
    expect(selectAll(lines).ids.size).toBe(5);
  });

  it('drops rows that are no longer in the answer', () => {
    const selection = {
      ids: new Set(['a', 'b']),
      anchor: null,
      base: new Set<string>(),
      end: null,
    };
    expect([...selectedNow(selection, new Set(['b', 'c']))]).toEqual(['b']);
    expect(selectedNow(selection, new Set(['a', 'b']))).toBe(selection.ids);
  });

  it('says whether all, some or none of the rows are ticked', () => {
    expect(allTicked(lines, new Set())).toBe(false);
    expect(allTicked(lines, new Set(['a']))).toBe('indeterminate');
    expect(allTicked(lines, new Set(['a', 'b', 'c', 'd', 'e']))).toBe(true);
    expect(allTicked([], new Set(['a']))).toBe(false);
  });
});
