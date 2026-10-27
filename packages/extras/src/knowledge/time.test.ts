import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  dayOfWeek,
  daysBetween,
  formatDay,
  formatDayLong,
  isCivilDate,
  isValidTimeZone,
  todayIn,
  zonedInstant,
} from './time';

describe('calendar days', () => {
  it('accepts only real dates', () => {
    expect(isCivilDate('2026-10-27')).toBe(true);
    expect(isCivilDate('2028-02-29')).toBe(true);
    expect(isCivilDate('2026-02-29')).toBe(false);
    expect(isCivilDate('2026-13-01')).toBe(false);
    expect(isCivilDate('Oct 1')).toBe(false);
    expect(isCivilDate('0050-01-01')).toBe(false);
  });

  it('adds days and months, keeping month ends', () => {
    expect(addDays('2026-10-27', 90)).toBe('2027-01-25');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2027-08-31', 6)).toBe('2028-02-29');
    expect(addMonths('2026-10-27', 12)).toBe('2027-10-27');
    expect(addMonths('2026-12-15', -12)).toBe('2025-12-15');
  });

  it('counts days and knows Mondays', () => {
    expect(daysBetween('2026-10-01', '2026-10-15')).toBe(14);
    expect(daysBetween('2026-10-15', '2026-10-01')).toBe(-14);
    expect(daysBetween('2026-11-01', '2026-11-02')).toBe(1);
    expect(dayOfWeek('2026-10-26')).toBe(1);
    expect(dayOfWeek('2026-11-01')).toBe(0);
  });
});

describe('time zones', () => {
  it('finds today in the person’s time zone', () => {
    const now = new Date('2026-10-28T03:30:00Z');
    expect(todayIn('America/Denver', now)).toBe('2026-10-27');
    expect(todayIn('Asia/Tokyo', now)).toBe('2026-10-28');
    expect(todayIn('UTC', now)).toBe('2026-10-28');
  });

  it('turns 9:00 AM on a date into an instant, across daylight saving', () => {
    expect(zonedInstant('2026-10-01', '09:00', 'America/Denver').toISOString()).toBe(
      '2026-10-01T15:00:00.000Z',
    );
    expect(zonedInstant('2026-12-01', '09:00', 'America/Denver').toISOString()).toBe(
      '2026-12-01T16:00:00.000Z',
    );
    expect(zonedInstant('2026-11-01', '09:00', 'America/Denver').toISOString()).toBe(
      '2026-11-01T16:00:00.000Z',
    );
    expect(zonedInstant('2027-01-20', '09:00', 'Asia/Kolkata').toISOString()).toBe(
      '2027-01-20T03:30:00.000Z',
    );
    expect(zonedInstant('2027-01-20', '09:00', 'UTC').toISOString()).toBe(
      '2027-01-20T09:00:00.000Z',
    );
  });

  it('checks time zone names', () => {
    expect(isValidTimeZone('America/Denver')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });
});

describe('dates in words', () => {
  it('leaves out this year', () => {
    expect(formatDay('2026-10-01', '2026-10-27')).toBe('Oct 1');
    expect(formatDay('2027-01-20', '2026-10-27')).toBe('Jan 20, 2027');
    expect(formatDayLong('2027-01-20')).toBe('January 20, 2027');
  });
});
