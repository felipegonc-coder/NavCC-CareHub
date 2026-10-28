import { describe, expect, it } from 'vitest';
import { edgeStep, scrollNear } from './drag';

describe('edgeStep', () => {
  it('scrolls back near the start and on near the end, faster closer to the edge', () => {
    expect(edgeStep(500, 0, 1000)).toBe(0);
    expect(edgeStep(48, 0, 1000)).toBe(0);
    expect(edgeStep(24, 0, 1000)).toBe(-8);
    expect(edgeStep(0, 0, 1000)).toBe(-16);
    expect(edgeStep(-30, 0, 1000)).toBe(-16);
    expect(edgeStep(976, 0, 1000)).toBe(8);
    expect(edgeStep(1200, 0, 1000)).toBe(16);
  });

  it('keeps edges to a quarter of a small box, and never scrolls one with no size', () => {
    expect(edgeStep(50, 0, 100)).toBe(0);
    expect(edgeStep(5, 0, 100)).toBe(-13);
    expect(edgeStep(10, 10, 10)).toBe(0);
  });
});

describe('scrollNear', () => {
  /** A board 600 px wide showing half of what it holds, scrolled `left` px. */
  function board(left = 0) {
    const el = document.createElement('div');
    let scrolled = left;
    Object.defineProperties(el, {
      scrollWidth: { configurable: true, value: 1200 },
      clientWidth: { configurable: true, value: 600 },
      scrollLeft: {
        configurable: true,
        get: () => scrolled,
        set: (value: number) => {
          scrolled = Math.min(Math.max(value, 0), 600);
        },
      },
    });
    el.getBoundingClientRect = () =>
      ({
        left: 0,
        right: 600,
        top: 0,
        bottom: 400,
        x: 0,
        y: 0,
        width: 600,
        height: 400,
      }) as DOMRect;
    return el;
  }

  it('scrolls the board sideways near its edges, and says when it moved', () => {
    const el = board(100);
    expect(scrollNear(el, 300, 200)).toBe(false);
    expect(el.scrollLeft).toBe(100);
    expect(scrollNear(el, 590, 200)).toBe(true);
    expect(el.scrollLeft).toBeGreaterThan(100);
    expect(scrollNear(el, 0, 200)).toBe(true);
    expect(el.scrollLeft).toBeLessThan(120);
  });

  it("doesn't move at the end of what there is to see", () => {
    const el = board(0);
    expect(scrollNear(el, 5, 200)).toBe(false);
    expect(el.scrollLeft).toBe(0);
  });
});
