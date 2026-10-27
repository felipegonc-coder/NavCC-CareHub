import { describe, expect, it } from 'vitest';
import { itemsByDate, layoutAllDayRow, layoutMonth } from './lanes';
import type { LaneRow } from './lanes';
import { monthMatrix } from './period';
import type { CalendarItem, GridOptions } from './types';

const allDay = (id: string, start: string, end?: string): CalendarItem => ({
  id,
  allDay: true,
  start,
  end,
});
const timed = (id: string, start: string, end?: string): CalendarItem => ({
  id,
  allDay: false,
  start,
  end,
});
const week = [
  '2026-10-25',
  '2026-10-26',
  '2026-10-27',
  '2026-10-28',
  '2026-10-29',
  '2026-10-30',
  '2026-10-31',
];
const sunday: GridOptions = { weekStart: 0, hideWeekends: false };
/** Segments as [id, startIndex, endIndex, lane], for short assertions. */
const bars = (row: LaneRow | undefined) =>
  (row?.segments ?? []).map((s) => [s.item.id, s.startIndex, s.endIndex, s.lane]);

describe('layoutAllDayRow', () => {
  it('stacks overlapping all-day items in lanes and reuses free lanes', () => {
    const row = layoutAllDayRow(
      [
        allDay('training', '2026-10-26', '2026-10-28'),
        allDay('coaching', '2026-10-27'),
        allDay('qa-form', '2026-10-29'),
        timed('standup', '2026-10-27T09:00', '2026-10-27T09:15'),
      ],
      week,
    );
    expect(bars(row)).toEqual([
      ['training', 1, 3, 0],
      ['coaching', 2, 2, 1],
      ['qa-form', 4, 4, 0],
    ]);
    expect(row).toMatchObject({ laneCount: 2, visibleLanes: 2, more: [0, 0, 0, 0, 0, 0, 0] });
  });

  it('draws 3 lanes and counts the rest as "+N more" per day', () => {
    const row = layoutAllDayRow(
      [
        allDay('a', '2026-10-26', '2026-10-27'),
        allDay('b', '2026-10-26'),
        allDay('c', '2026-10-26'),
        allDay('d', '2026-10-26', '2026-10-28'),
        allDay('e', '2026-10-26'),
      ],
      week,
    );
    expect(row.laneCount).toBe(5);
    expect(row.visibleLanes).toBe(3);
    // Longer bars take the top lanes; the last two single days don't fit.
    expect(bars(row).slice(0, 3)).toEqual([
      ['d', 1, 3, 0],
      ['a', 1, 2, 1],
      ['b', 1, 1, 2],
    ]);
    expect(row.segments.filter((s) => !s.visible).map((s) => s.item.id)).toEqual(['c', 'e']);
    expect(row.more).toEqual([0, 2, 0, 0, 0, 0, 0]);
  });

  it('draws everything when expanded', () => {
    const items = ['a', 'b', 'c', 'd'].map((id) => allDay(id, '2026-10-26'));
    const row = layoutAllDayRow(items, week, { maxVisible: Infinity });
    expect(row).toMatchObject({ laneCount: 4, visibleLanes: 4, more: [0, 0, 0, 0, 0, 0, 0] });
  });

  it('clips items to the days shown and marks the cut ends', () => {
    const row = layoutAllDayRow([allDay('leave', '2026-10-20', '2026-11-03')], week);
    expect(row.segments).toMatchObject([
      {
        key: 'leave@2026-10-25',
        startIndex: 0,
        endIndex: 6,
        continuesBefore: true,
        continuesAfter: true,
      },
    ]);
  });

  it('works for a single Day column', () => {
    const row = layoutAllDayRow([allDay('leave', '2026-10-20', '2026-11-03')], ['2026-10-27']);
    expect(row.segments).toMatchObject([{ key: 'leave@2026-10-27', startIndex: 0, endIndex: 0 }]);
  });
});

describe('layoutMonth', () => {
  it('lays out a 6-week month from the week start, including leading and trailing days', () => {
    const matrix = monthMatrix('2026-08-14', sunday);
    const month = layoutMonth(
      [
        allDay('july', '2026-07-28'),
        allDay('september', '2026-09-04'),
        allDay('mid', '2026-08-14'),
      ],
      matrix,
    );
    expect(month.weeks).toHaveLength(6);
    expect(month.weeks.map((w) => w.cells[0]?.date)).toEqual([
      '2026-07-26',
      '2026-08-02',
      '2026-08-09',
      '2026-08-16',
      '2026-08-23',
      '2026-08-30',
    ]);
    expect(bars(month.weeks[0])).toEqual([['july', 2, 2, 0]]);
    expect(bars(month.weeks[2])).toEqual([['mid', 5, 5, 0]]);
    expect(bars(month.weeks[5])).toEqual([['september', 5, 5, 0]]);
    expect(month.weeks[0]?.cells[6]).toEqual({ date: '2026-08-01', inMonth: true });
    expect(month.weeks[0]?.cells[0]).toEqual({ date: '2026-07-26', inMonth: false });
  });

  it('splits multi-day bars at week breaks, including ones from before the grid', () => {
    const month = layoutMonth(
      [
        allDay('conference', '2026-10-15', '2026-10-20'),
        allDay('leave', '2026-10-08', '2026-10-27'),
        allDay('carry-over', '2026-09-20', '2026-10-02'),
      ],
      monthMatrix('2026-10-01', sunday),
    );
    const flags = month.weeks.map((w) =>
      w.segments.map((s) => [
        s.item.id,
        s.startIndex,
        s.endIndex,
        s.continuesBefore,
        s.continuesAfter,
      ]),
    );
    expect(flags).toEqual([
      [['carry-over', 0, 5, true, false]],
      [['leave', 4, 6, false, true]],
      [
        ['leave', 0, 6, true, true],
        ['conference', 4, 6, false, true],
      ],
      [
        ['leave', 0, 6, true, true],
        ['conference', 0, 2, true, false],
      ],
      [['leave', 0, 2, true, false]],
    ]);
  });

  it('shows up to 3 items a day, then "+N more"', () => {
    const items = ['a', 'b', 'c', 'd', 'e'].map((id) => allDay(id, '2026-10-14'));
    const month = layoutMonth(items, monthMatrix('2026-10-14', sunday));
    const row = month.weeks[2];
    expect(row?.visibleLanes).toBe(3);
    expect(row?.more).toEqual([0, 0, 0, 2, 0, 0, 0]);
    expect(row?.segments.filter((s) => s.visible).map((s) => s.item.id)).toEqual(['a', 'b', 'c']);
  });

  it('includes timed items: bars first, then all-day, then by time; overnight ones span both days', () => {
    const month = layoutMonth(
      [
        timed('late-standup', '2026-10-14T16:00', '2026-10-14T16:15'),
        timed('early-standup', '2026-10-14T09:00', '2026-10-14T09:15'),
        allDay('qa-form', '2026-10-14'),
        allDay('training', '2026-10-13', '2026-10-15'),
        timed('night-shift', '2026-10-15T22:00', '2026-10-16T06:00'),
      ],
      monthMatrix('2026-10-14', sunday),
    );
    expect(bars(month.weeks[2])).toEqual([
      ['training', 2, 4, 0],
      ['qa-form', 3, 3, 1],
      ['early-standup', 3, 3, 2],
      ['late-standup', 3, 3, 3],
      ['night-shift', 4, 5, 1],
    ]);
    expect(month.weeks[2]?.more).toEqual([0, 0, 0, 1, 0, 0, 0]);
  });

  it('with hidden weekends, drops weekend-only items and joins bars across the gap', () => {
    const options: GridOptions = { weekStart: 1, hideWeekends: true };
    const month = layoutMonth(
      [
        allDay('weekend-trip', '2026-10-17', '2026-10-18'),
        timed('saturday-shift', '2026-10-17T09:00', '2026-10-17T17:00'),
        allDay('long-weekend', '2026-10-16', '2026-10-19'),
      ],
      monthMatrix('2026-10-01', options),
    );
    expect(month.weeks.every((w) => w.days.length === 5)).toBe(true);
    const rows = month.weeks.map((w) =>
      w.segments.map((s) => [s.key, s.startIndex, s.endIndex, s.continuesBefore, s.continuesAfter]),
    );
    expect(rows.flat()).toEqual([
      ['long-weekend@2026-10-16', 4, 4, false, true],
      ['long-weekend@2026-10-19', 0, 0, true, false],
    ]);
  });
});

describe('itemsByDate', () => {
  it("lists each date's items in agenda order, with multi-day items on every date", () => {
    const lists = itemsByDate(
      [
        timed('standup', '2026-10-27T09:00', '2026-10-27T09:15'),
        timed('night-shift', '2026-10-26T22:00', '2026-10-27T06:00'),
        allDay('qa-form', '2026-10-27'),
        allDay('training', '2026-10-26', '2026-10-28'),
      ],
      ['2026-10-26', '2026-10-27', '2026-10-29'],
    );
    const ids = (date: string) => lists.get(date)?.map((item) => item.id);
    expect(ids('2026-10-26')).toEqual(['training', 'night-shift']);
    expect(ids('2026-10-27')).toEqual(['training', 'qa-form', 'night-shift', 'standup']);
    expect(ids('2026-10-29')).toEqual([]);
  });
});
