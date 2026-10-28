import { describe, expect, it } from 'vitest';
import { NO_SPAN, piecesOf, sameSpans, spanOnScreen } from './virtual';

const rows = (count: number, height = 40) => Array.from({ length: count }, () => height);

describe('spanOnScreen', () => {
  it('takes the lines on the screen and within the overscan of it', () => {
    // The list starts at the screen's top; the screen is 400 px high, 200 px drawn around it.
    expect(spanOnScreen(rows(100), 0, 0, 400, 200)).toEqual({ start: 0, end: 15 });
  });

  it('follows the list as it scrolls up past the screen', () => {
    // 2,000 px scrolled: lines 50 to 59 are on screen, 45 to 64 with the overscan.
    expect(spanOnScreen(rows(100), -2000, 0, 400, 200)).toEqual({ start: 45, end: 65 });
  });

  it('uses each line’s own height', () => {
    const heights = [100, 100, 40, 40, 40, 40];
    expect(spanOnScreen(heights, -150, 0, 100, 0)).toEqual({ start: 1, end: 4 });
  });

  it('is empty when the list is below or above the screen', () => {
    expect(spanOnScreen(rows(10), 2000, 0, 400, 200)).toEqual({ start: 0, end: 0 });
    expect(spanOnScreen(rows(10), -2000, 0, 400, 200)).toEqual({ start: 10, end: 10 });
  });

  it('takes every line of a short list on screen', () => {
    expect(spanOnScreen(rows(3), 0, 0, 400)).toEqual({ start: 0, end: 3 });
    expect(spanOnScreen([], 0, 0, 400)).toEqual(NO_SPAN);
  });
});

describe('piecesOf', () => {
  const height = (index: number) => (index === 2 ? 60 : 40);

  it('draws the span with a gap before and after it', () => {
    expect(piecesOf(8, height, { start: 3, end: 5 }, new Set())).toEqual([
      { gap: 0, height: 140 },
      { line: 3 },
      { line: 4 },
      { gap: 5, height: 120 },
    ]);
  });

  it('draws pinned lines outside the span in their place', () => {
    expect(piecesOf(8, height, { start: 0, end: 2 }, new Set([5]))).toEqual([
      { line: 0 },
      { line: 1 },
      { gap: 2, height: 140 },
      { line: 5 },
      { gap: 6, height: 80 },
    ]);
  });

  it('is one gap when nothing is drawn', () => {
    expect(piecesOf(3, () => 40, NO_SPAN, new Set())).toEqual([{ gap: 0, height: 120 }]);
  });
});

describe('sameSpans', () => {
  it('compares every list’s span', () => {
    const a = new Map([['', { start: 0, end: 10 }]]);
    expect(sameSpans(a, new Map([['', { start: 0, end: 10 }]]))).toBe(true);
    expect(sameSpans(a, new Map([['', { start: 1, end: 10 }]]))).toBe(false);
    expect(sameSpans(a, new Map([['done', { start: 0, end: 10 }]]))).toBe(false);
    expect(sameSpans(a, new Map())).toBe(false);
  });
});
