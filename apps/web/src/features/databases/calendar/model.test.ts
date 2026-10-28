import { describe, expect, it } from 'vitest';
import type { DateValue } from '@carehub/databases';
import {
  calendarWeeks,
  datedRow,
  dayValue,
  itemsByDay,
  moveDateValue,
  moveStartTo,
  shiftDateValue,
  stepAnchor,
  stepDay,
  visibleItems,
  weekdayOrder,
  withEndDay,
} from './model';
import { CALENDAR_TEXT, dayName, dayNumber, monthTitle, weekTitle } from './messages';

const DENVER = 'America/Denver';
const days = (start: string, end: string | null = null): DateValue => ({
  start,
  end,
  hasTime: false,
});
const timed = (start: string, end: string | null = null, timeZone?: string): DateValue => ({
  start,
  end,
  hasTime: true,
  ...(timeZone ? { timeZone } : {}),
});

describe('calendarWeeks', () => {
  it('lays out October 2026 from Sunday', () => {
    const weeks = calendarWeeks('2026-10-27', 'month', 0, '2026-10-27', true);
    expect(weeks).toHaveLength(5);
    expect(weeks[0]?.[0]?.date).toBe('2026-09-27');
    expect(weeks[4]?.[6]?.date).toBe('2026-10-31');
    expect(weeks[0]?.[0]?.inMonth).toBe(false);
    expect(weeks[0]?.[4]).toMatchObject({ date: '2026-10-01', inMonth: true });
    const today = weeks.flat().filter((d) => d.today);
    expect(today.map((d) => d.date)).toEqual(['2026-10-27']);
  });

  it('starts weeks on Monday when the viewer does', () => {
    const weeks = calendarWeeks('2026-10-27', 'month', 1, '2026-10-27', true);
    expect(weeks[0]?.[0]?.date).toBe('2026-09-28');
    expect(weeks.at(-1)?.[6]?.date).toBe('2026-11-01');
    expect(weeks.every((w) => w.length === 7)).toBe(true);
  });

  it('shows one week in week mode, all in the month', () => {
    const [week, ...rest] = calendarWeeks('2026-10-28', 'week', 1, '2026-10-27', true);
    expect(rest).toHaveLength(0);
    expect(week?.map((d) => d.date)).toEqual([
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
    ]);
    expect(week?.every((d) => d.inMonth)).toBe(true);
  });

  it('leaves out Saturday and Sunday without weekends', () => {
    const weeks = calendarWeeks('2026-10-27', 'month', 0, '2026-10-27', false);
    expect(weeks.every((w) => w.length === 5)).toBe(true);
    expect(weeks.flat().some((d) => d.weekend)).toBe(false);
    expect(weekdayOrder(0, false)).toEqual([1, 2, 3, 4, 5]);
    expect(weekdayOrder(1, true)).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });
});

describe('steps', () => {
  it('moves a month or a week', () => {
    expect(stepAnchor('2026-10-27', 'month', 1)).toBe('2026-11-01');
    expect(stepAnchor('2026-01-31', 'month', -1)).toBe('2025-12-01');
    expect(stepAnchor('2026-10-27', 'week', -1)).toBe('2026-10-20');
  });

  it('moves between days with the arrow keys, over hidden weekends', () => {
    expect(stepDay('2026-10-28', 'ArrowRight', true)).toBe('2026-10-29');
    expect(stepDay('2026-10-28', 'ArrowUp', true)).toBe('2026-10-21');
    expect(stepDay('2026-10-30', 'ArrowRight', false)).toBe('2026-11-02');
    expect(stepDay('2026-11-02', 'ArrowLeft', false)).toBe('2026-10-30');
  });
});

describe('rows on days', () => {
  it('puts a late evening in Denver on that evening, not the next UTC day', () => {
    // 9:30 PM in Denver on Oct 28 is 03:30 UTC on Oct 29.
    const row = datedRow('r', timed('2026-10-29T03:30:00.000Z'), DENVER);
    expect(row).toEqual({
      id: 'r',
      start: '2026-10-28',
      end: '2026-10-28',
      time: { hour: 21, minute: 30 },
    });
  });

  it('reads a value with its own time zone there', () => {
    const row = datedRow('r', timed('2026-10-29T03:30:00.000Z', null, 'America/New_York'), DENVER);
    expect(row?.start).toBe('2026-10-28');
    expect(row?.time).toEqual({ hour: 23, minute: 30 });
  });

  it('has no place for an empty or broken value', () => {
    expect(datedRow('r', null, DENVER)).toBeNull();
    expect(datedRow('r', { start: 'soon' }, DENVER)).toBeNull();
  });

  it('spans a 3-day range over 3 days, and orders whole days before times', () => {
    const rows = [
      datedRow('visit', timed('2026-10-28T15:00:00.000Z'), DENVER),
      datedRow('early', timed('2026-10-28T14:00:00.000Z'), DENVER),
      datedRow('range', days('2026-10-27', '2026-10-29'), DENVER),
    ].flatMap((r) => (r ? [r] : []));
    const grid = calendarWeeks('2026-10-27', 'month', 0, '2026-10-27', true).flat();
    const byDay = itemsByDay(
      rows,
      grid.map((d) => d.date),
    );
    expect(byDay.get('2026-10-27')?.map((i) => [i.id, i.part])).toEqual([['range', 'start']]);
    expect(byDay.get('2026-10-28')?.map((i) => [i.id, i.part])).toEqual([
      ['range', 'middle'],
      ['early', 'single'],
      ['visit', 'single'],
    ]);
    expect(byDay.get('2026-10-29')?.map((i) => [i.id, i.part])).toEqual([['range', 'end']]);
    const covered = [...byDay].filter(([, items]) => items.some((i) => i.id === 'range'));
    expect(covered).toHaveLength(3);
  });

  it('keeps ranges that start before the grid', () => {
    const row = datedRow('long', days('2026-09-01', '2026-09-30'), DENVER);
    const byDay = itemsByDay(row ? [row] : [], ['2026-09-27', '2026-09-28', '2026-10-01']);
    expect(byDay.get('2026-09-27')?.[0]?.part).toBe('middle');
    expect(byDay.get('2026-10-01')).toEqual([]);
  });

  it('shows 3 items and "+N more" for the rest', () => {
    expect(visibleItems([1, 2, 3], 3)).toEqual({ shown: [1, 2, 3], more: 0 });
    expect(visibleItems([1, 2, 3, 4, 5], 3)).toEqual({ shown: [1, 2, 3], more: 2 });
    expect(visibleItems([1, 2, 3, 4], null)).toEqual({ shown: [1, 2, 3, 4], more: 0 });
    expect(CALENDAR_TEXT.more(2)).toBe('+2 more');
  });
});

describe('moving', () => {
  it('moves a range and keeps its length', () => {
    const moved = moveDateValue(
      days('2026-10-27', '2026-10-29'),
      '2026-10-28',
      '2026-11-02',
      DENVER,
    );
    expect(moved).toEqual(days('2026-11-01', '2026-11-03'));
  });

  it('keeps the time on the clock across the end of daylight saving', () => {
    // 3:30 PM in Denver on Oct 30 (MDT), moved 3 days to Nov 2 (MST).
    const value = timed('2026-10-30T21:30:00.000Z', '2026-10-30T22:30:00.000Z');
    expect(shiftDateValue(value, 3, DENVER)).toEqual(
      timed('2026-11-02T22:30:00.000Z', '2026-11-02T23:30:00.000Z'),
    );
  });

  it('moves the start to a picked day', () => {
    expect(moveStartTo(days('2026-10-27', '2026-10-29'), '2026-10-30', DENVER)).toEqual(
      days('2026-10-30', '2026-11-01'),
    );
    expect(moveStartTo(timed('2026-10-29T03:30:00.000Z'), '2026-10-30', DENVER)).toEqual(
      timed('2026-10-31T03:30:00.000Z'),
    );
  });

  it('changes only the end, never before the start', () => {
    expect(withEndDay(days('2026-10-27'), '2026-10-30', DENVER)).toEqual(
      days('2026-10-27', '2026-10-30'),
    );
    expect(withEndDay(days('2026-10-27', '2026-10-29'), '2026-10-20', DENVER)).toEqual(
      days('2026-10-27', '2026-10-27'),
    );
    expect(withEndDay(days('2026-10-27'), '2026-10-27', DENVER)).toEqual(days('2026-10-27'));
    expect(
      withEndDay(
        timed('2026-10-27T15:00:00.000Z', '2026-10-27T16:00:00.000Z'),
        '2026-10-28',
        DENVER,
      ),
    ).toEqual(timed('2026-10-27T15:00:00.000Z', '2026-10-28T16:00:00.000Z'));
  });

  it('gives a row from "No date" the whole day', () => {
    expect(dayValue('2026-10-30')).toEqual(days('2026-10-30'));
  });
});

describe('text', () => {
  it('names months, weeks and days', () => {
    expect(monthTitle('2026-10-27')).toBe('October 2026');
    expect(weekTitle('2026-10-25', '2026-10-31')).toBe('Oct 25 – 31, 2026');
    expect(weekTitle('2026-10-26', '2026-11-01')).toBe('Oct 26 – Nov 1, 2026');
    expect(weekTitle('2026-12-27', '2027-01-02')).toBe('Dec 27, 2026 – Jan 2, 2027');
    expect(dayName('2026-10-28')).toBe('Wednesday, Oct 28, 2026');
    expect(dayNumber('2026-11-01')).toBe('Nov 1');
    expect(dayNumber('2026-11-02')).toBe('2');
    expect(CALENDAR_TEXT.moved('Fix kitchen sink leak', '2026-10-30')).toBe(
      "Moved 'Fix kitchen sink leak' to Friday, Oct 30, 2026",
    );
    expect(CALENDAR_TEXT.newOnDay('2026-10-28')).toBe('New row on Wednesday, Oct 28, 2026');
  });
});
