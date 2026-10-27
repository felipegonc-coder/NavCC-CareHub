import { describe, expect, it } from 'vitest';
import {
  formatUniqueId,
  highestUniqueNumber,
  nextUniqueNumbers,
  normalizeIdPrefix,
  numberExistingRows,
  uniqueIdSearchKeys,
} from './unique-id';

const row = (id: string, createdAt: string, uniqueNumber: number | null = null) => ({
  id,
  createdAt,
  uniqueNumber,
});

describe('showing IDs', () => {
  it('shows the prefix with a hyphen, or just the number', () => {
    expect(formatUniqueId('QA', 12)).toBe('QA-12');
    expect(formatUniqueId(null, 12)).toBe('12');
    expect(formatUniqueId('', 3)).toBe('3');
    expect(formatUniqueId('QA', null)).toBe('');
    expect(formatUniqueId(undefined, undefined)).toBe('');
  });

  it('saves prefixes trimmed and without a trailing hyphen', () => {
    expect(normalizeIdPrefix(' QA- ')).toBe('QA');
    expect(normalizeIdPrefix('QA--')).toBe('QA');
    expect(normalizeIdPrefix('Q-A')).toBe('Q-A');
    expect(normalizeIdPrefix('-')).toBeNull();
    expect(normalizeIdPrefix('   ')).toBeNull();
    expect(normalizeIdPrefix(null)).toBeNull();
  });

  it('is found by "QA-12" and "12"', () => {
    expect(uniqueIdSearchKeys('QA', 12)).toEqual(['qa-12', '12']);
    expect(uniqueIdSearchKeys(null, 12)).toEqual(['12']);
    expect(uniqueIdSearchKeys('QA', null)).toEqual([]);
  });
});

describe('numbering rows', () => {
  it('gives new rows the next numbers, in order', () => {
    expect(nextUniqueNumbers(0, 1)).toEqual([1]);
    expect(nextUniqueNumbers(5, 3)).toEqual([6, 7, 8]);
    expect(nextUniqueNumbers(5, 0)).toEqual([]);
  });

  it('refuses counts that are not whole numbers 0 or more', () => {
    for (const [highest, count] of [
      [-1, 1],
      [1.5, 1],
      [Number.NaN, 1],
      [0, -1],
      [0, 2.5],
      [0, Number.POSITIVE_INFINITY],
    ] as const) {
      expect(() => nextUniqueNumbers(highest, count)).toThrow(RangeError);
    }
  });

  it('never gives a number again after a delete (DB-40)', () => {
    const left = [row('r1', '2026-10-01T10:00:00Z', 1), row('r4', '2026-10-04T10:00:00Z', 4)];
    // QA-5 was deleted; the server recorded 5 as the highest number given.
    const highest = highestUniqueNumber(left, 5);
    expect(highest).toBe(5);
    const [next] = nextUniqueNumbers(highest, 1);
    expect(formatUniqueId('QA', next)).toBe('QA-6');
    expect(highestUniqueNumber(left)).toBe(4);
    expect(highestUniqueNumber([row('r9', '2026-10-09T10:00:00Z', 9)], 5)).toBe(9);
    expect(highestUniqueNumber([])).toBe(0);
  });

  it('numbers existing rows oldest first when the property is added', () => {
    const rows = [
      row('r-c', '2026-10-03T09:00:00.000Z'),
      row('r-a', '2026-10-01T09:00:00.000Z'),
      row('r-b1', '2026-10-02T09:00:00.000Z'),
      row('r-b2', '2026-10-02T09:00:00.000Z'),
    ];
    expect([...numberExistingRows(rows)]).toEqual([
      ['r-a', 1],
      ['r-b1', 2],
      ['r-b2', 3],
      ['r-c', 4],
    ]);
  });

  it('keeps numbers rows already have and carries on after the highest', () => {
    const rows = [
      row('r-new', '2026-10-05T09:00:00.000Z'),
      row('r-old', '2026-10-01T09:00:00.000Z', 7),
      row('r-odd', 'not a time'),
      row('r-mid', '2026-10-03T09:00:00.000Z'),
    ];
    expect([...numberExistingRows(rows)]).toEqual([
      ['r-mid', 8],
      ['r-new', 9],
      ['r-odd', 10],
    ]);
    expect([...numberExistingRows(rows, 20)]).toEqual([
      ['r-mid', 21],
      ['r-new', 22],
      ['r-odd', 23],
    ]);
    expect(numberExistingRows([]).size).toBe(0);
  });
});
