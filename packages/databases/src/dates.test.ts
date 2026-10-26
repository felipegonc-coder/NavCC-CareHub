import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  dateValueDays,
  dayOfWeek,
  formatCalendarDate,
  formatDateValue,
  formatTime,
  instantToCalendarDate,
  isValidDateValue,
  parseCalendarDate,
  resolveDateRef,
  resolveDateWindow,
  startOfWeek,
  timeZoneOffsetMinutes,
  todayIn,
  zonedToInstant,
} from './dates';

describe('calendar dates', () => {
  it('parses only real dates', () => {
    expect(parseCalendarDate('2026-02-30')).toBeNull();
    expect(parseCalendarDate('2028-02-29')).toEqual({ y: 2028, m: 2, d: 29 });
    expect(parseCalendarDate('2026-1-05')).toBeNull();
  });
  it('knows weekdays and week starts', () => {
    expect(dayOfWeek('2026-10-26')).toBe(1);
    expect(startOfWeek('2026-10-26', 0)).toBe('2026-10-25');
    expect(startOfWeek('2026-10-26', 1)).toBe('2026-10-26');
    expect(startOfWeek('2026-10-25', 1)).toBe('2026-10-19');
  });
  it('adds days and months', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-03-15', -3)).toBe('2025-12-15');
  });
});

describe('time zones', () => {
  it('converts wall time to an exact moment', () => {
    expect(zonedToInstant('2026-10-26', 0, 0, 'America/Denver')).toBe('2026-10-26T06:00:00.000Z');
    expect(zonedToInstant('2026-12-01', 15, 30, 'America/Denver')).toBe('2026-12-01T22:30:00.000Z');
    expect(zonedToInstant('2026-10-27', 0, 0, 'Europe/London')).toBe('2026-10-27T00:00:00.000Z');
  });
  it('moves forward in a daylight-saving gap and picks the earlier moment in an overlap', () => {
    expect(zonedToInstant('2026-03-08', 2, 30, 'America/Denver')).toBe('2026-03-08T09:30:00.000Z');
    expect(zonedToInstant('2026-11-01', 1, 30, 'America/Denver')).toBe('2026-11-01T07:30:00.000Z');
  });
  it('reports offsets', () => {
    expect(timeZoneOffsetMinutes('2026-10-26T12:00:00Z', 'America/Denver')).toBe(-360);
    expect(timeZoneOffsetMinutes('2026-12-01T12:00:00Z', 'America/Denver')).toBe(-420);
  });
  it('puts a moment on the viewer’s calendar day (DB-04, around midnight)', () => {
    const now = new Date('2026-10-27T05:30:00Z');
    expect(todayIn({ now, timeZone: 'America/Denver' })).toBe('2026-10-26');
    expect(todayIn({ now, timeZone: 'Europe/London' })).toBe('2026-10-27');
    expect(
      resolveDateWindow('next_7_days', todayIn({ now, timeZone: 'America/Denver' }), 0),
    ).toEqual({ start: '2026-10-26', end: '2026-11-01' });
    expect(
      resolveDateWindow('next_7_days', todayIn({ now, timeZone: 'Europe/London' }), 0),
    ).toEqual({ start: '2026-10-27', end: '2026-11-02' });
    expect(instantToCalendarDate('2026-10-27T05:59:59Z', 'America/Denver')).toBe('2026-10-26');
    expect(instantToCalendarDate('2026-10-27T06:00:00Z', 'America/Denver')).toBe('2026-10-27');
  });
  it('never shifts dates without a time', () => {
    expect(
      dateValueDays({ start: '2026-10-26', end: '2026-10-28', hasTime: false }, 'Asia/Tokyo'),
    ).toEqual({ start: '2026-10-26', end: '2026-10-28' });
    expect(
      dateValueDays(
        { start: '2026-10-27T05:30:00.000Z', end: null, hasTime: true },
        'America/Denver',
      ),
    ).toEqual({ start: '2026-10-26', end: '2026-10-26' });
  });
});

describe('relative dates', () => {
  const today = '2026-10-26';
  it('resolves days', () => {
    expect(resolveDateRef({ relative: 'yesterday' }, today)).toBe('2026-10-25');
    expect(resolveDateRef({ relative: 'one_month_from_now' }, today)).toBe('2026-11-26');
    expect(resolveDateRef({ exact: '2026-01-02' }, today)).toBe('2026-01-02');
  });
  it('resolves windows', () => {
    expect(resolveDateWindow('past_7_days', today, 0)).toEqual({
      start: '2026-10-20',
      end: '2026-10-26',
    });
    expect(resolveDateWindow('this_week', today, 0)).toEqual({
      start: '2026-10-25',
      end: '2026-10-31',
    });
    expect(resolveDateWindow('this_week', today, 1)).toEqual({
      start: '2026-10-26',
      end: '2026-11-01',
    });
    expect(resolveDateWindow('last_week', today, 0)).toEqual({
      start: '2026-10-18',
      end: '2026-10-24',
    });
    expect(resolveDateWindow('last_month', today, 0)).toEqual({
      start: '2026-09-01',
      end: '2026-09-30',
    });
    expect(resolveDateWindow('next_30_days', today, 0)).toEqual({
      start: '2026-10-26',
      end: '2026-11-24',
    });
    expect(resolveDateWindow({ direction: 'past', count: 2, unit: 'week' }, today, 0)).toEqual({
      start: '2026-10-13',
      end: '2026-10-26',
    });
    expect(resolveDateWindow({ direction: 'next', count: 1, unit: 'month' }, today, 0)).toEqual({
      start: '2026-10-26',
      end: '2026-11-25',
    });
  });
});

describe('formatting', () => {
  const viewer = {
    timeZone: 'America/Denver',
    hour12: true,
    now: new Date('2026-10-26T18:00:00Z'),
  };
  it('formats dates', () => {
    expect(formatCalendarDate('2026-10-26', 'full')).toBe('Oct 26, 2026');
    expect(formatCalendarDate('2026-10-26', 'mdy')).toBe('10/26/2026');
    expect(formatCalendarDate('2026-10-26', 'dmy')).toBe('26/10/2026');
    expect(formatCalendarDate('2026-10-26', 'ymd')).toBe('2026-10-26');
    expect(formatCalendarDate('2026-10-27', 'relative', '2026-10-26')).toBe('Tomorrow');
    expect(formatCalendarDate('2026-11-27', 'relative', '2026-10-26')).toBe('Nov 27, 2026');
  });
  it('formats times', () => {
    expect(formatTime(15, 30, true)).toBe('3:30 PM');
    expect(formatTime(0, 5, true)).toBe('12:05 AM');
    expect(formatTime(12, 0, true)).toBe('12:00 PM');
    expect(formatTime(15, 30, false)).toBe('15:30');
  });
  it('formats values and ranges', () => {
    expect(
      formatDateValue(
        { start: '2026-10-26T21:30:00.000Z', end: '2026-10-26T22:00:00.000Z', hasTime: true },
        { format: 'full', viewer },
      ),
    ).toBe('Oct 26, 2026 3:30 PM → 4:00 PM');
    expect(
      formatDateValue(
        { start: '2026-10-26', end: '2026-10-28', hasTime: false },
        { format: 'full', viewer },
      ),
    ).toBe('Oct 26, 2026 → Oct 28, 2026');
    expect(
      formatDateValue(
        { start: '2026-10-26T21:30:00.000Z', end: null, hasTime: true },
        { format: 'relative', timeFormat: '24h', viewer },
      ),
    ).toBe('Today 15:30');
    expect(
      formatDateValue(
        { start: '2026-10-26T21:30:00.000Z', end: null, hasTime: true },
        { format: 'full', timeFormat: 'hidden', viewer },
      ),
    ).toBe('Oct 26, 2026');
  });
  it('validates date values', () => {
    expect(isValidDateValue({ start: '2026-10-26', end: '2026-10-25', hasTime: false })).toBe(
      false,
    );
    expect(isValidDateValue({ start: '2026-10-26', end: null, hasTime: true })).toBe(false);
    expect(
      isValidDateValue({
        start: '2026-10-26T10:00:00.000Z',
        end: '2026-10-26T11:00:00.000Z',
        hasTime: true,
      }),
    ).toBe(true);
  });
});
