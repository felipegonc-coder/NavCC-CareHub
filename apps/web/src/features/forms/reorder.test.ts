import { describe, expect, it } from 'vitest';
import { dropEdge, dropIndex, dropSlot } from './reorder';

/** Three cards, 200 px apart: middles at 90, 290 and 490. */
const cards = [0, 1, 2].map((index) => ({ index, middle: index * 200 + 90 }));

describe('dropSlot', () => {
  it('lands in front of the first card whose middle is below the pointer', () => {
    expect(dropSlot(cards, 10, 3)).toBe(0);
    expect(dropSlot(cards, 150, 3)).toBe(1);
    expect(dropSlot(cards, 300, 3)).toBe(2);
    expect(dropSlot(cards, 900, 3)).toBe(3);
  });
});

describe('dropIndex', () => {
  it("gives the dragged card's new place, or null when it stays put", () => {
    expect(dropIndex(0, 0)).toBeNull();
    expect(dropIndex(0, 1)).toBeNull();
    expect(dropIndex(0, 2)).toBe(1);
    expect(dropIndex(0, 3)).toBe(2);
    expect(dropIndex(2, 0)).toBe(0);
    expect(dropIndex(2, 2)).toBeNull();
  });
});

describe('dropEdge', () => {
  it('draws the line above the card it lands in front of, or below the last card', () => {
    expect(dropEdge(null, 0, 3)).toBeNull();
    expect(dropEdge({ from: 0, slot: 2 }, 2, 3)).toBe('top');
    expect(dropEdge({ from: 0, slot: 2 }, 1, 3)).toBeNull();
    expect(dropEdge({ from: 0, slot: 3 }, 2, 3)).toBe('bottom');
    expect(dropEdge({ from: 1, slot: 1 }, 1, 3)).toBeNull();
    expect(dropEdge({ from: 1, slot: 2 }, 2, 3)).toBeNull();
  });
});
