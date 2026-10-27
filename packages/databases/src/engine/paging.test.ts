import { describe, expect, it } from 'vitest';
import type { View } from '../types';
import { decodeCursor, encodeCursor, pageSize, pageStart, shareRows, takePage } from './paging';

describe('pageSize', () => {
  it.each([
    [10, 10],
    [25, 25],
    [50, 50],
    [100, 100],
    [200, 100],
    [7, 50],
  ])('load limit %s gives pages of %s', (loadLimit, size) => {
    expect(pageSize({ loadLimit } as Pick<View, 'loadLimit'>)).toBe(size);
  });
});

describe('cursors', () => {
  it('round-trip', () => {
    const cursor = { path: ['js-new', 'jp-high'], offset: 25, after: 'job-041' };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
    expect(decodeCursor(encodeCursor({ path: [], offset: 0, after: null }))).toEqual({
      path: [],
      offset: 0,
      after: null,
    });
  });

  it.each([
    [''],
    ['c1:'],
    ['c1:not json'],
    ['c2:[[],0,null]'],
    ['c1:{"path":[]}'],
    ['c1:[[],-1,null]'],
    ['c1:[[],1.5,null]'],
    ['c1:[["a","b","c"],0,null]'],
    ['c1:[[1],0,null]'],
    ['c1:[[],0,7]'],
    ['c1:[[],0]'],
  ])('rejects %s', (text) => {
    expect(decodeCursor(text)).toBeNull();
  });
});

describe('pageStart', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  it('starts just after the last row shown while it is still there', () => {
    expect(pageStart(ids, { path: [], offset: 1, after: 'c' })).toBe(3);
  });
  it('starts one place earlier than the offset when that row has gone', () => {
    expect(pageStart(ids, { path: [], offset: 3, after: 'zz' })).toBe(2);
    expect(pageStart(ids, { path: [], offset: 9, after: 'zz' })).toBe(5);
  });
  it('starts at the offset when nothing was shown yet', () => {
    expect(pageStart(ids, { path: [], offset: 0, after: null })).toBe(0);
    expect(pageStart(ids, { path: [], offset: 9, after: null })).toBe(5);
  });
});

describe('takePage', () => {
  const items = ['a', 'b', 'c', 'd', 'e'];
  const id = (x: string): string => x;
  it('gives a page and the cursor after it', () => {
    const { page, next } = takePage(items, id, ['g'], 1, 2);
    expect(page).toEqual(['b', 'c']);
    expect(next && decodeCursor(next)).toEqual({ path: ['g'], offset: 3, after: 'c' });
  });
  it('gives no cursor at the end', () => {
    expect(takePage(items, id, [], 3, 10)).toEqual({ page: ['d', 'e'], next: null });
    expect(takePage([], id, [], 0, 10)).toEqual({ page: [], next: null });
  });
  it('an empty page of a group with rows still gives a cursor to load them', () => {
    const { page, next } = takePage(items, id, ['hidden'], 0, 0);
    expect(page).toEqual([]);
    expect(next && decodeCursor(next)).toEqual({ path: ['hidden'], offset: 0, after: null });
  });
});

describe('shareRows', () => {
  it('gives everyone what they want when it fits', () => {
    expect(shareRows([10, 20, 30], 100)).toEqual([10, 20, 30]);
  });
  it('shares evenly, small wants leaving the rest to the others', () => {
    const got = shareRows([50, 5, 50, 50], 100);
    expect(got).toEqual([32, 5, 32, 31]);
    expect(got.reduce((a, b) => a + b, 0)).toBe(100);
  });
  it('never gives more than the cap or than wanted', () => {
    const wants = Array.from({ length: 150 }, (_, i) => i % 4);
    const got = shareRows(wants, 100);
    expect(got.reduce((a, b) => a + b, 0)).toBe(100);
    got.forEach((n, i) => expect(n).toBeLessThanOrEqual(wants[i] ?? 0));
  });
  it('handles nothing to share', () => {
    expect(shareRows([0, 0], 100)).toEqual([0, 0]);
    expect(shareRows([3, 3], 0)).toEqual([0, 0]);
  });
});
