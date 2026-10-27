import type { WeekStart } from '@carehub/team-time';
import { describe, expect, it } from 'vitest';
import { monthMatrix, navigate, viewRange } from './period';
import type { GridOptions } from './types';

const options = (weekStart: WeekStart, hideWeekends = false, phone = false): GridOptions => ({
  weekStart,
  hideWeekends,
  phone,
});

describe('viewRange', () => {
  it('shows the anchor date in Day view, even on a hidden weekend', () => {
    expect(viewRange('day', '2026-10-31', options(0, true))).toMatchObject({
      start: '2026-10-31',
      end: '2026-10-31',
      days: ['2026-10-31'],
      month: null,
    });
  });

  it.each([
    { weekStart: 0, start: '2026-10-25', end: '2026-10-31' },
    { weekStart: 1, start: '2026-10-26', end: '2026-11-01' },
    { weekStart: 6, start: '2026-10-24', end: '2026-10-30' },
  ] as const)('starts Week on the week start: %j', ({ weekStart, start, end }) => {
    const range = viewRange('week', '2026-10-28', options(weekStart));
    expect(range).toMatchObject({ start, end });
    expect(range.days).toHaveLength(7);
  });

  it.each([0, 1, 6] as const)('hides weekends in Week for week start %s', (weekStart) => {
    expect(viewRange('week', '2026-10-28', options(weekStart, true)).days).toEqual([
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
    ]);
  });

  it('shows 3 days from the anchor in the phone Week', () => {
    expect(viewRange('week', '2026-10-28', options(0, false, true)).days).toEqual([
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
    ]);
    expect(viewRange('week', '2026-10-30', options(0, true, true)).days).toEqual([
      '2026-10-30',
      '2026-11-02',
      '2026-11-03',
    ]);
    expect(viewRange('week', '2026-10-31', options(0, true, true)).days).toEqual([
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
    ]);
  });

  it('covers the whole month grid in Month view', () => {
    const range = viewRange('month', '2026-10-14', options(0));
    expect(range).toMatchObject({ start: '2026-09-27', end: '2026-10-31' });
    expect(range.month?.month).toBe('2026-10');
    expect(range.days).toHaveLength(35);
  });

  it('keeps 7 days in weeks with a clock change', () => {
    expect(viewRange('week', '2026-03-10', options(0)).days).toEqual([
      '2026-03-08',
      '2026-03-09',
      '2026-03-10',
      '2026-03-11',
      '2026-03-12',
      '2026-03-13',
      '2026-03-14',
    ]);
    expect(viewRange('week', '2026-11-01', options(1))).toMatchObject({
      start: '2026-10-26',
      end: '2026-11-01',
    });
  });
});

describe('monthMatrix', () => {
  it('builds a 6-week month (August 2026 from Sunday)', () => {
    const { month, weeks } = monthMatrix('2026-08-31', options(0));
    expect(month).toBe('2026-08');
    expect(weeks).toHaveLength(6);
    expect(weeks[0]?.[0]).toEqual({ date: '2026-07-26', inMonth: false });
    expect(weeks[5]?.map((c) => c.date)).toEqual([
      '2026-08-30',
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
      '2026-09-05',
    ]);
    expect(weeks.flat().filter((c) => c.inMonth)).toHaveLength(31);
  });

  it.each([
    { weekStart: 0, rows: 6, first: '2026-07-26' },
    { weekStart: 1, rows: 6, first: '2026-07-27' },
    { weekStart: 6, rows: 5, first: '2026-08-01' },
  ] as const)('starts August 2026 on the week start: %j', ({ weekStart, rows, first }) => {
    const { weeks } = monthMatrix('2026-08-01', options(weekStart));
    expect(weeks).toHaveLength(rows);
    expect(weeks[0]?.[0]?.date).toBe(first);
  });

  it('fits February 2026 in 4 weeks, or 6 for a fixed-height picker', () => {
    expect(monthMatrix('2026-02-10', options(0)).weeks).toHaveLength(4);
    const fixed = monthMatrix('2026-02-10', { ...options(0), sixWeeks: true }).weeks;
    expect(fixed).toHaveLength(6);
    expect(fixed[5]?.[6]?.date).toBe('2026-03-14');
  });

  it('drops rows with no weekday of the month when weekends are hidden', () => {
    // August 1, 2026 is a Saturday, so the first Sunday-start row has no August weekday.
    const { weeks } = monthMatrix('2026-08-01', options(0, true));
    expect(weeks).toHaveLength(5);
    expect(weeks.every((row) => row.length === 5)).toBe(true);
    expect(weeks[0]?.map((c) => c.date)).toEqual([
      '2026-08-03',
      '2026-08-04',
      '2026-08-05',
      '2026-08-06',
      '2026-08-07',
    ]);
  });
});

describe('navigate', () => {
  const today = '2026-10-26';

  it('goes to today', () => {
    expect(navigate('month', '2027-03-01', 'today', { ...options(0), today })).toBe(today);
  });

  it('steps a day, a week or a month', () => {
    const o = { ...options(0), today };
    expect(navigate('day', '2026-10-31', 'next', o)).toBe('2026-11-01');
    expect(navigate('day', '2026-11-01', 'previous', o)).toBe('2026-10-31');
    expect(navigate('week', '2026-10-28', 'next', o)).toBe('2026-11-04');
    expect(navigate('week', '2026-10-28', 'previous', o)).toBe('2026-10-21');
    expect(navigate('month', '2026-10-31', 'next', o)).toBe('2026-11-01');
    expect(navigate('month', '2026-10-31', 'previous', o)).toBe('2026-09-01');
    expect(navigate('month', '2026-12-15', 'next', o)).toBe('2027-01-01');
    expect(navigate('month', '2027-01-15', 'previous', o)).toBe('2026-12-01');
  });

  it('steps 3 shown days in the phone Week, skipping hidden weekends', () => {
    const o = { ...options(0, true, true), today };
    const next = navigate('week', '2026-10-30', 'next', o);
    expect(viewRange('week', next, o).days).toEqual(['2026-11-04', '2026-11-05', '2026-11-06']);
    const previous = navigate('week', '2026-10-30', 'previous', o);
    expect(viewRange('week', previous, o).days).toEqual(['2026-10-27', '2026-10-28', '2026-10-29']);
    expect(navigate('week', '2026-10-28', 'next', { ...options(0, false, true), today })).toBe(
      '2026-10-31',
    );
  });
});
