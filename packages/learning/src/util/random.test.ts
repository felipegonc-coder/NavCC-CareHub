import { describe, expect, it } from 'vitest';
import { mulberry32, randomInt, sample, shuffle } from './index';
import type { Random } from './index';

// The published Mulberry32 reference, used as an independent check of the package version.
function reference(seed: number): Random {
  let a = seed;
  return () => {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const take = (random: Random, n: number) => Array.from({ length: n }, () => random());

// Always returns the same value, for edge cases.
const constant =
  (value: number): Random =>
  () =>
    value;

describe('mulberry32', () => {
  it('matches the reference sequence', () => {
    expect(take(mulberry32(42), 3)).toEqual([
      0.6011037519201636, 0.44829055899754167, 0.8524657934904099,
    ]);
    for (const seed of [0, 1, 42, 2026, -1, -123456, 2 ** 32 + 5, 2 ** 40]) {
      expect(take(mulberry32(seed), 1000)).toEqual(take(reference(seed), 1000));
    }
  });

  it('repeats for the same seed and differs for different seeds', () => {
    expect(take(mulberry32(7), 20)).toEqual(take(mulberry32(7), 20));
    expect(take(mulberry32(7), 20)).not.toEqual(take(mulberry32(8), 20));
  });

  it('stays in [0, 1)', () => {
    for (const value of take(mulberry32(99), 10_000)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('treats non-finite seeds as 0', () => {
    expect(take(mulberry32(Number.NaN), 5)).toEqual(take(mulberry32(0), 5));
    expect(take(mulberry32(Number.POSITIVE_INFINITY), 5)).toEqual(take(mulberry32(0), 5));
  });
});

describe('randomInt', () => {
  it('returns whole numbers from 0 to max - 1', () => {
    const random = mulberry32(3);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const n = randomInt(random, 5);
      expect(Number.isInteger(n)).toBe(true);
      seen.add(n);
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it('handles edge cases', () => {
    expect(randomInt(constant(0.999999999), 5)).toBe(4);
    expect(randomInt(constant(1), 5)).toBe(4); // a misbehaving source never escapes the range
    expect(randomInt(constant(-0.5), 5)).toBe(0);
    expect(randomInt(constant(0.5), 0)).toBe(0);
    expect(randomInt(constant(0.5), -3)).toBe(0);
    expect(randomInt(constant(0.5), Number.NaN)).toBe(0);
    expect(randomInt(constant(0.99), 2.9)).toBe(1);
  });
});

describe('shuffle', () => {
  it('returns a shuffled copy and leaves the input alone', () => {
    const items = ['a', 'b', 'c', 'd', 'e', 'f'];
    const shuffled = shuffle(items, mulberry32(1));
    expect(items).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(shuffled).not.toBe(items);
    expect([...shuffled].sort()).toEqual(items);
  });

  it('is repeatable with the same seed', () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    expect(shuffle(items, mulberry32(5))).toEqual(shuffle(items, mulberry32(5)));
    expect(shuffle(items, mulberry32(5))).not.toEqual(shuffle(items, mulberry32(6)));
  });

  it('handles empty and single-item lists', () => {
    expect(shuffle([], mulberry32(1))).toEqual([]);
    expect(shuffle(['only'], mulberry32(1))).toEqual(['only']);
  });

  it('makes every order about equally likely', () => {
    const random = mulberry32(2026);
    const counts = new Map<string, number>();
    for (let i = 0; i < 6000; i++) {
      const key = shuffle(['a', 'b', 'c'], random).join('');
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect(counts.size).toBe(6);
    for (const count of counts.values()) {
      expect(count).toBeGreaterThan(850);
      expect(count).toBeLessThan(1150);
    }
  });
});

describe('sample', () => {
  const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

  it('draws without repeats', () => {
    const picked = sample(items, 5, mulberry32(11));
    expect(picked).toHaveLength(5);
    expect(new Set(picked).size).toBe(5);
    for (const item of picked) expect(items).toContain(item);
    expect(items).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
  });

  it('keeps the original order when asked', () => {
    const picked = sample(items, 4, mulberry32(11), { keepOrder: true });
    expect(picked).toEqual([...picked].sort((x, y) => items.indexOf(x) - items.indexOf(y)));
    expect([...picked].sort()).toEqual([...sample(items, 4, mulberry32(11))].sort());
  });

  it('is repeatable with the same seed', () => {
    expect(sample(items, 3, mulberry32(4))).toEqual(sample(items, 3, mulberry32(4)));
  });

  it('clamps the count', () => {
    expect(sample(items, 0, mulberry32(1))).toEqual([]);
    expect(sample(items, -2, mulberry32(1))).toEqual([]);
    expect(sample(items, Number.NaN, mulberry32(1))).toEqual([]);
    expect([...sample(items, 50, mulberry32(1))].sort()).toEqual(items);
    expect(sample(items, 2.7, mulberry32(1))).toHaveLength(2);
    expect(sample([], 3, mulberry32(1))).toEqual([]);
  });

  it('gives every item a fair chance', () => {
    const random = mulberry32(77);
    const counts = new Map<string, number>();
    for (let i = 0; i < 4000; i++)
      for (const item of sample(items, 2, random)) counts.set(item, (counts.get(item) ?? 0) + 1);
    for (const item of items) {
      expect(counts.get(item) ?? 0).toBeGreaterThan(850);
      expect(counts.get(item) ?? 0).toBeLessThan(1150);
    }
  });
});
