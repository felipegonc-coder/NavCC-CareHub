import { describe, expect, it } from 'vitest';
import { customRangeProblem, rangeChoice, readQuery, writeQuery } from './range';

const AVERY = '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b';
const CLINIC = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const read = (search: string) => readQuery(new URLSearchParams(search));

describe('range', () => {
  it('reads the range and filters from the address', () => {
    expect(read('')).toEqual({});
    expect(read('days=30')).toEqual({ days: '30' });
    expect(read('days=90')).toEqual({ days: '90' });
    expect(read(`days=30&person=${AVERY}&space=${CLINIC}`)).toEqual({
      days: '30',
      person: AVERY,
      space: CLINIC,
    });
    // Custom dates win over a preset.
    expect(read('days=30&from=2026-10-01&to=2026-10-15')).toEqual({
      from: '2026-10-01',
      to: '2026-10-15',
    });
  });

  it('leaves out what it cannot read, so the defaults apply', () => {
    // The default, 7 days, isn't kept in the address.
    expect(read('days=7')).toEqual({});
    expect(read('days=14')).toEqual({});
    expect(read('from=2026-10-01')).toEqual({});
    expect(read('from=October&to=2026-10-15')).toEqual({});
    expect(read('person=avery&space=1')).toEqual({});
  });

  it('writes the address for a range, without the default', () => {
    expect(writeQuery({}).toString()).toBe('');
    expect(writeQuery({ days: '7' }).toString()).toBe('');
    expect(writeQuery({ days: '90', person: AVERY }).toString()).toBe(`days=90&person=${AVERY}`);
    expect(writeQuery({ days: '30', from: '2026-10-01', to: '2026-10-15' }).toString()).toBe(
      'from=2026-10-01&to=2026-10-15',
    );
    const query = { days: '30', space: CLINIC } as const;
    expect(readQuery(writeQuery(query))).toEqual(query);
  });

  it('names the range a query shows', () => {
    expect(rangeChoice({})).toBe('7');
    expect(rangeChoice({ days: '30' })).toBe('30');
    expect(rangeChoice({ from: '2026-10-01', to: '2026-10-15' })).toBe('custom');
  });

  it('keeps custom ranges within the kept year, up to today', () => {
    const limits = { keptFrom: '2025-10-28', today: '2026-10-27' };
    expect(customRangeProblem('2026-10-01', '2026-10-15', limits)).toBeNull();
    expect(customRangeProblem('2025-10-28', '2026-10-27', limits)).toBeNull();
    expect(customRangeProblem('2026-10-15', '2026-10-15', limits)).toBeNull();
    expect(customRangeProblem('', '2026-10-15', limits)).toBe(
      'Choose a start date and an end date.',
    );
    expect(customRangeProblem('2026-10-16', '2026-10-15', limits)).toBe(
      'Choose a start date on or before the end date.',
    );
    expect(customRangeProblem('2025-10-27', '2026-10-15', limits)).toBe(
      'Choose dates within the last year, up to today.',
    );
    expect(customRangeProblem('2026-10-01', '2026-10-28', limits)).toBe(
      'Choose dates within the last year, up to today.',
    );
  });
});
