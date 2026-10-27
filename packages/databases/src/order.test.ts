import { describe, expect, it } from 'vitest';
import { effectiveOrder, moveInOrder } from './order';
import { EMPTY_GROUP } from './types';

describe('effectiveOrder', () => {
  it('keeps the saved order without missing or repeated ids, then adds new ones', () => {
    expect(effectiveOrder(['c', 'gone', 'a', 'c'], ['a', 'b', 'c', 'd'])).toEqual([
      'c',
      'a',
      'b',
      'd',
    ]);
    expect(effectiveOrder([], ['a', 'b'])).toEqual(['a', 'b']);
  });
});

describe('moveInOrder', () => {
  const all = ['a', 'b', 'c', 'd', 'e'];
  it('moves a row before another one, or to the end', () => {
    expect(moveInOrder(all, all, ['d'], 'b')).toEqual(['a', 'd', 'b', 'c', 'e']);
    expect(moveInOrder(all, all, ['e'], 'a')).toEqual(['e', 'a', 'b', 'c', 'd']);
    expect(moveInOrder(all, all, ['a'], null)).toEqual(['b', 'c', 'd', 'e', 'a']);
  });
  it('keeps several moved rows in their current order', () => {
    expect(moveInOrder(all, all, ['e', 'b'], 'a')).toEqual(['b', 'e', 'a', 'c', 'd']);
  });
  it('drops onto a moved row as before the next row that is not moving', () => {
    expect(moveInOrder(all, all, ['b', 'c'], 'c')).toEqual(all);
    expect(moveInOrder(all, all, ['a', 'e'], 'e')).toEqual(['b', 'c', 'd', 'a', 'e']);
  });
  it('works from an out-of-date saved order', () => {
    expect(moveInOrder(['c', 'gone', 'a'], ['a', 'b', 'c'], ['b'], 'c')).toEqual(['b', 'c', 'a']);
  });
  it('ignores unknown ids, and an unknown target means the end', () => {
    expect(moveInOrder(all, all, ['zz'], 'a')).toEqual(all);
    expect(moveInOrder(all, all, ['a'], 'zz')).toEqual(['b', 'c', 'd', 'e', 'a']);
  });
  it('lists every id exactly once', () => {
    expect(moveInOrder(['a', 'a', 'b'], all, ['c', 'c'], 'a')).toEqual(['c', 'a', 'b', 'd', 'e']);
  });
  it('orders group keys too', () => {
    const groups = [EMPTY_GROUP, 'o-hvac', 'o-plumbing'];
    expect(moveInOrder([], groups, ['o-plumbing'], EMPTY_GROUP)).toEqual([
      'o-plumbing',
      EMPTY_GROUP,
      'o-hvac',
    ]);
  });
});
