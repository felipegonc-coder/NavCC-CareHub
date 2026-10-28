import type { RepeatRule } from '@carehub/team-repeat';
import { describe, expect, it } from 'vitest';
import { boundsOf, civilOf, occurrencesIn, whenOf, windowOf, type Schedule } from './model';

const denver = 'America/Denver';
const newYork = 'America/New_York';

const tuesdays: RepeatRule = { freq: 'weekly', interval: 1, byDay: [{ day: 'TU' }] };

/** A weekly Tuesday 10:00 to 11:00 meeting in Denver, from Oct 20, 2026. */
const weekly: Schedule = {
  allDay: false,
  timeZone: denver,
  start: '2026-10-20T10:00',
  end: '2026-10-20T11:00',
  rule: tuesdays,
  exceptions: [],
  overrides: {},
};

const single = (start: string, end: string, timeZone = denver): Schedule => ({
  ...weekly,
  allDay: !start.includes('T'),
  timeZone,
  start,
  end,
  rule: null,
});

const starts = (schedule: Schedule, from: string, to: string, zone = newYork) =>
  occurrencesIn(schedule, windowOf(from, to, zone)).occurrences.map((o) =>
    whenOf(o.start, schedule.timeZone),
  );

describe('civil values and instants', () => {
  it('reads instants in the event zone and writes them back', () => {
    expect(civilOf('2026-10-27T16:00:00.000Z', denver)).toBe('2026-10-27T10:00');
    expect(whenOf('2026-10-27T10:00', denver)).toBe('2026-10-27T16:00:00.000Z');
  });

  it('keeps dates as dates', () => {
    expect(civilOf('2026-11-05', denver)).toBe('2026-11-05');
    expect(whenOf('2026-11-05', denver)).toBe('2026-11-05');
  });

  it('turns a range of dates into the instants of the viewer zone', () => {
    const window = windowOf('2026-10-25', '2026-11-01', newYork);
    expect(window.start.toISOString()).toBe('2026-10-25T04:00:00.000Z');
    expect(window.end.toISOString()).toBe('2026-11-01T04:00:00.000Z');
  });
});

describe('occurrencesIn', () => {
  it('shows a weekly event at the same Denver time on both sides of the clock change', () => {
    // US clocks go back on Nov 1, 2026: 10:00 in Denver is 16:00 UTC before and 17:00 after.
    expect(starts(weekly, '2026-10-25', '2026-11-08')).toEqual([
      '2026-10-27T16:00:00.000Z',
      '2026-11-03T17:00:00.000Z',
    ]);
  });

  it('starts at the first occurrence and skips removed ones', () => {
    const series = { ...weekly, exceptions: ['2026-10-27T10:00'] };
    expect(starts(series, '2026-10-11', '2026-11-08')).toEqual([
      '2026-10-20T16:00:00.000Z',
      '2026-11-03T17:00:00.000Z',
    ]);
  });

  it('shows a moved occurrence where it moved to, with its own changes', () => {
    const series: Schedule = {
      ...weekly,
      overrides: {
        '2026-10-27T10:00': {
          start: '2026-10-29T14:00',
          end: '2026-10-29T15:00',
          changes: { title: 'Moved planning' },
        },
      },
    };
    const [moved] = occurrencesIn(
      series,
      windowOf('2026-10-25', '2026-11-01', newYork),
    ).occurrences;
    expect(moved).toEqual({
      key: '2026-10-27T10:00',
      start: '2026-10-29T14:00',
      end: '2026-10-29T15:00',
      changes: { title: 'Moved planning' },
    });
  });

  it('cuts at the edges of the window in the viewer zone', () => {
    // 10:00 to 11:00 in Denver is 12:00 to 13:00 in New York: inside Oct 27 there, not Oct 28.
    expect(starts(weekly, '2026-10-27', '2026-10-28')).toHaveLength(1);
    expect(starts(weekly, '2026-10-28', '2026-10-29')).toHaveLength(0);
    // In Tokyo the Denver Tuesday meeting is early on Wednesday.
    expect(starts(weekly, '2026-10-28', '2026-10-29', 'Asia/Tokyo')).toHaveLength(1);
  });

  it('shows an event that does not repeat once, if it overlaps the window', () => {
    const lunch = single('2026-10-27T12:00', '2026-10-27T13:00');
    expect(starts(lunch, '2026-10-27', '2026-10-28')).toEqual(['2026-10-27T18:00:00.000Z']);
    expect(starts(lunch, '2026-10-28', '2026-11-04')).toEqual([]);
  });

  it('counts a zero-length event at its start', () => {
    const call = single('2026-10-27T22:00', '2026-10-27T22:00', newYork);
    expect(starts(call, '2026-10-27', '2026-10-28')).toHaveLength(1);
    expect(starts(call, '2026-10-28', '2026-10-29')).toHaveLength(0);
    const midnight = single('2026-10-28T00:00', '2026-10-28T00:00', newYork);
    expect(starts(midnight, '2026-10-27', '2026-10-28')).toHaveLength(0);
    expect(starts(midnight, '2026-10-28', '2026-10-29')).toHaveLength(1);
  });

  it('keeps all-day events on their dates in every zone', () => {
    const audit = single('2026-11-05', '2026-11-06');
    for (const zone of [newYork, 'Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
      expect(starts(audit, '2026-11-05', '2026-11-06', zone)).toEqual(['2026-11-05']);
      expect(starts(audit, '2026-11-06', '2026-11-07', zone)).toEqual([]);
      expect(starts(audit, '2026-11-04', '2026-11-05', zone)).toEqual([]);
    }
  });

  it('repeats all-day events by date', () => {
    const rota: Schedule = {
      ...single('2026-11-02', '2026-11-03'),
      rule: { freq: 'daily', interval: 1, count: 3 },
    };
    expect(starts(rota, '2026-11-01', '2026-11-08')).toEqual([
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
    ]);
  });
});

describe('boundsOf', () => {
  it('uses the exact instants of a timed event', () => {
    expect(boundsOf(single('2026-10-27T12:00', '2026-10-27T13:00'))).toEqual({
      startAt: new Date('2026-10-27T18:00:00.000Z'),
      endAt: new Date('2026-10-27T19:00:00.000Z'),
    });
  });

  it('widens all-day dates by a day each side', () => {
    expect(boundsOf(single('2026-11-05', '2026-11-06'))).toEqual({
      startAt: new Date('2026-11-04T00:00:00.000Z'),
      endAt: new Date('2026-11-07T00:00:00.000Z'),
    });
  });

  it('has no end for a series that never ends', () => {
    expect(boundsOf(weekly)).toEqual({
      startAt: new Date('2026-10-20T16:00:00.000Z'),
      endAt: null,
    });
  });

  it('ends with the last occurrence of a series with a count', () => {
    const three = { ...weekly, rule: { ...tuesdays, count: 3 } };
    expect(boundsOf(three).endAt).toEqual(new Date('2026-11-03T18:00:00.000Z'));
  });

  it('takes in occurrences moved before the first one', () => {
    const series: Schedule = {
      ...weekly,
      rule: { ...tuesdays, count: 2 },
      overrides: { '2026-10-20T10:00': { start: '2026-10-19T08:00', end: '2026-10-19T09:00' } },
    };
    expect(boundsOf(series)).toEqual({
      startAt: new Date('2026-10-19T14:00:00.000Z'),
      endAt: new Date('2026-10-27T17:00:00.000Z'),
    });
  });
});
