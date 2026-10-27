import { describe, expect, it } from 'vitest';
import { etagMatches, parseRange } from './serve';

describe('parseRange', () => {
  it('reads one byte range', () => {
    expect(parseRange('bytes=0-4', 10)).toEqual({ start: 0, end: 4 });
    expect(parseRange('bytes=5-', 10)).toEqual({ start: 5, end: 9 });
    expect(parseRange('bytes=-3', 10)).toEqual({ start: 7, end: 9 });
    expect(parseRange('bytes=-30', 10)).toEqual({ start: 0, end: 9 });
    expect(parseRange('bytes=8-100', 10)).toEqual({ start: 8, end: 9 });
  });

  it('sends the whole file for ranges it ignores', () => {
    expect(parseRange(undefined, 10)).toBeNull();
    expect(parseRange('bytes=5-2', 10)).toBeNull();
    expect(parseRange('bytes=0-1,4-5', 10)).toBeNull();
    expect(parseRange('items=0-4', 10)).toBeNull();
    expect(parseRange('bytes=-', 10)).toBeNull();
  });

  it('answers 416 for ranges outside the file', () => {
    expect(parseRange('bytes=10-', 10)).toBe('unsatisfiable');
    expect(parseRange('bytes=-0', 10)).toBe('unsatisfiable');
    expect(parseRange('bytes=0-0', 0)).toBe('unsatisfiable');
  });
});

describe('etagMatches', () => {
  it('compares If-None-Match weakly', () => {
    expect(etagMatches('"abc"', '"abc"')).toBe(true);
    expect(etagMatches('W/"abc"', '"abc"')).toBe(true);
    expect(etagMatches('"x", "abc"', '"abc"')).toBe(true);
    expect(etagMatches('*', '"abc"')).toBe(true);
    expect(etagMatches('"x"', '"abc"')).toBe(false);
    expect(etagMatches(undefined, '"abc"')).toBe(false);
  });
});
