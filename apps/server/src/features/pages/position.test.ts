import { describe, expect, it } from 'vitest';
import { isPositionKey, positionAt, positionBetween } from './position';

const isSorted = (keys: string[]) => keys.every((key, i) => i === 0 || keys[i - 1]! < key);

describe('positionBetween', () => {
  it('starts in the middle and leaves room on both sides', () => {
    expect(positionBetween(null, null)).toBe('V');
    expect(positionBetween(null, 'V') < 'V').toBe(true);
    expect(positionBetween('V', null) > 'V').toBe(true);
  });

  it('always finds a key between two neighbours', () => {
    expect(positionBetween('V', 'W')).toBe('VV');
    expect(positionBetween('a', 'a1')).toBe('a0V');
    const key = positionBetween('V1', 'V2');
    expect('V1' < key && key < 'V2').toBe(true);
  });

  it('rejects keys that are malformed or out of order', () => {
    expect(() => positionBetween('V0', null)).toThrow(RangeError);
    expect(() => positionBetween('', null)).toThrow(RangeError);
    expect(() => positionBetween('a b', null)).toThrow(RangeError);
    expect(() => positionBetween('W', 'V')).toThrow(RangeError);
    expect(() => positionBetween('V', 'V')).toThrow(RangeError);
  });
});

describe('positionAt', () => {
  it('appends by default and inserts at an index', () => {
    expect(positionAt([])).toBe('V');
    expect(positionAt(['V']) > 'V').toBe(true);
    expect(positionAt(['V'], 0) < 'V').toBe(true);
    const middle = positionAt(['V', 'X'], 1);
    expect('V' < middle && middle < 'X').toBe(true);
    expect(positionAt(['V'], 99) > 'V').toBe(true);
  });

  it('skips ties so the new key is unique', () => {
    const key = positionAt(['a', 'a', 'b'], 1);
    expect('a' < key && key < 'b').toBe(true);
  });

  it('keeps keys short for long runs of appends and prepends', () => {
    const appended: string[] = [];
    const prepended: string[] = [];
    for (let i = 0; i < 500; i += 1) {
      appended.push(positionAt(appended));
      prepended.unshift(positionAt(prepended, 0));
    }
    for (const keys of [appended, prepended]) {
      expect(isSorted(keys)).toBe(true);
      expect(Math.max(...keys.map((key) => key.length))).toBeLessThanOrEqual(10);
    }
  });

  it('stays sorted, unique and valid under random inserts', () => {
    let seed = 7;
    const random = () => (seed = (seed * 48_271) % 2_147_483_647) / 2_147_483_647;
    const keys: string[] = [];
    for (let i = 0; i < 2000; i += 1) {
      const index = Math.floor(random() * (keys.length + 1));
      keys.splice(index, 0, positionAt(keys, index));
    }
    expect(isSorted(keys)).toBe(true);
    expect(keys.every(isPositionKey)).toBe(true);
  });
});
