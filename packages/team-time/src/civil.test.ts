import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMinutes,
  addMonths,
  combine,
  datePart,
  dayOfWeek,
  daysBetween,
  daysInMonth,
  isCivilDate,
  isCivilDateTime,
  isCivilTime,
  minutesBetween,
  startOfWeek,
  timePart,
  weekNumber,
} from './index';

describe('checks', () => {
  it('accepts real dates only', () => {
    for (const ok of ['2026-10-26', '2024-02-29', '2000-02-29', '0001-01-01', '9999-12-31']) {
      expect(isCivilDate(ok)).toBe(true);
    }
    const bad = [
      '2026-02-29',
      '1900-02-29',
      '2026-13-01',
      '2026-00-10',
      '2026-04-31',
      '2026-10-32',
    ];
    for (const no of [
      ...bad,
      '0000-01-01',
      '2026-1-01',
      '26-10-26',
      '2026-10-26T09:00',
      '',
      20261026,
      null,
    ]) {
      expect(isCivilDate(no)).toBe(false);
    }
  });

  it('accepts times and date-times without seconds or zones', () => {
    for (const ok of ['00:00', '09:05', '12:00', '23:59']) expect(isCivilTime(ok)).toBe(true);
    for (const no of ['24:00', '9:00', '09:60', '09:00:00', '0900', 900]) {
      expect(isCivilTime(no)).toBe(false);
    }
    expect(isCivilDateTime('2026-10-26T15:30')).toBe(true);
    expect(isCivilDateTime('2024-02-29T00:00')).toBe(true);
    for (const no of [
      '2026-10-26 15:30',
      '2026-10-26T15:30:00',
      '2026-10-26T15:30Z',
      '2026-10-26T24:00',
      '2026-02-29T09:00',
      '2026-10-26',
      undefined,
    ]) {
      expect(isCivilDateTime(no)).toBe(false);
    }
  });
});

describe('parts', () => {
  it('splits and combines', () => {
    expect(datePart('2026-10-26T15:30')).toBe('2026-10-26');
    expect(timePart('2026-10-26T15:30')).toBe('15:30');
    expect(combine('2026-10-26', '09:00')).toBe('2026-10-26T09:00');
  });

  it('throws a RangeError on bad input', () => {
    expect(() => datePart('2026-10-26')).toThrow(RangeError);
    expect(() => timePart('2026-10-26T25:00')).toThrow(RangeError);
    expect(() => combine('2026-02-30', '09:00')).toThrow(RangeError);
    expect(() => combine('2026-10-26', '9:00')).toThrow(RangeError);
    expect(() => addDays('Oct 26', 1)).toThrow(RangeError);
    expect(() => addDays('2026-10-26', 1.5)).toThrow(RangeError);
    expect(() => addDays('9999-12-31', 1)).toThrow(RangeError);
  });
});

describe('addDays', () => {
  it('crosses month ends, year ends and Feb 29', () => {
    expect(addDays('2026-10-26', 6)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2024-02-29', 1)).toBe('2024-03-01');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2026-10-26', 0)).toBe('2026-10-26');
    expect(addDays('2026-10-26', 365)).toBe('2027-10-26');
  });

  it('ignores clock changes', () => {
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08');
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
  });
});

describe('addMonths', () => {
  it('clamps to the end of shorter months', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonths('2026-10-31', 1)).toBe('2026-11-30');
    expect(addMonths('2026-05-31', 4)).toBe('2026-09-30');
  });

  it('moves Feb 29 to Feb 28 in common years', () => {
    expect(addMonths('2024-02-29', 12)).toBe('2025-02-28');
    expect(addMonths('2024-02-29', 48)).toBe('2028-02-29');
    expect(addMonths('2024-02-29', -12)).toBe('2023-02-28');
  });

  it('crosses years both ways', () => {
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
    expect(addMonths('2026-10-26', -22)).toBe('2024-12-26');
    expect(addMonths('2026-10-26', 0)).toBe('2026-10-26');
  });
});

describe('addMinutes and minutesBetween', () => {
  it('works on the wall clock', () => {
    expect(addMinutes('2026-10-26T23:30', 45)).toBe('2026-10-27T00:15');
    expect(addMinutes('2026-10-31T23:59', 1)).toBe('2026-11-01T00:00');
    expect(addMinutes('2024-02-28T23:30', 60)).toBe('2024-02-29T00:30');
    expect(addMinutes('2027-01-01T00:10', -20)).toBe('2026-12-31T23:50');
    expect(addMinutes('2026-10-26T09:00', 1440 * 7)).toBe('2026-11-02T09:00');
  });

  it('has no clock changes: 01:30 + 60 is 02:30 even on a spring-forward day', () => {
    expect(addMinutes('2026-03-08T01:30', 60)).toBe('2026-03-08T02:30');
    expect(minutesBetween('2026-03-08T00:00', '2026-03-08T04:00')).toBe(240);
  });

  it('measures b minus a', () => {
    expect(minutesBetween('2026-10-26T09:00', '2026-10-26T17:30')).toBe(510);
    expect(minutesBetween('2026-10-26T17:30', '2026-10-26T09:00')).toBe(-510);
    expect(minutesBetween('2026-12-31T23:00', '2027-01-01T01:00')).toBe(120);
  });
});

describe('days', () => {
  it('knows the weekday (0 = Sunday)', () => {
    expect(dayOfWeek('2026-10-25')).toBe(0);
    expect(dayOfWeek('2026-10-26')).toBe(1);
    expect(dayOfWeek('2026-10-31')).toBe(6);
    expect(dayOfWeek('2024-02-29')).toBe(4);
    expect(dayOfWeek('2000-01-01')).toBe(6);
    expect(dayOfWeek('1969-12-31')).toBe(3);
  });

  it('counts days in a month (month 1 to 12)', () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(1900, 2)).toBe(28);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
    expect(() => daysInMonth(2026, 13)).toThrow(RangeError);
    expect(() => daysInMonth(2026, 0)).toThrow(RangeError);
  });

  it('counts days between dates (b minus a)', () => {
    expect(daysBetween('2026-10-26', '2026-11-01')).toBe(6);
    expect(daysBetween('2026-11-01', '2026-10-26')).toBe(-6);
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2);
    expect(daysBetween('2026-02-28', '2026-03-01')).toBe(1);
    expect(daysBetween('2026-01-01', '2027-01-01')).toBe(365);
    expect(daysBetween('2026-10-26', '2026-10-26')).toBe(0);
  });
});

describe('weeks', () => {
  it('starts weeks on Sunday, Monday or Saturday', () => {
    // Wednesday, Oct 28, 2026
    expect(startOfWeek('2026-10-28', 0)).toBe('2026-10-25');
    expect(startOfWeek('2026-10-28', 1)).toBe('2026-10-26');
    expect(startOfWeek('2026-10-28', 6)).toBe('2026-10-24');
    // A Sunday
    expect(startOfWeek('2026-10-25', 0)).toBe('2026-10-25');
    expect(startOfWeek('2026-10-25', 1)).toBe('2026-10-19');
    expect(startOfWeek('2026-10-25', 6)).toBe('2026-10-24');
    // A Saturday
    expect(startOfWeek('2026-10-31', 0)).toBe('2026-10-25');
    expect(startOfWeek('2026-10-31', 1)).toBe('2026-10-26');
    expect(startOfWeek('2026-10-31', 6)).toBe('2026-10-31');
    // Across a year end
    expect(startOfWeek('2027-01-01', 0)).toBe('2026-12-27');
    expect(startOfWeek('2027-01-01', 1)).toBe('2026-12-28');
    expect(startOfWeek('2027-01-01', 6)).toBe('2026-12-26');
  });

  it('numbers ISO weeks when weeks start on Monday', () => {
    expect(weekNumber('2026-10-26', 1)).toBe(44);
    expect(weekNumber('2025-12-29', 1)).toBe(1);
    expect(weekNumber('2026-01-04', 1)).toBe(1);
    expect(weekNumber('2026-12-27', 1)).toBe(52);
    expect(weekNumber('2027-01-01', 1)).toBe(53);
    expect(weekNumber('2027-01-04', 1)).toBe(1);
  });

  it('counts the week with January 1 as week 1 when weeks start on Sunday or Saturday', () => {
    expect(weekNumber('2026-10-26', 0)).toBe(44);
    expect(weekNumber('2026-01-03', 0)).toBe(1);
    expect(weekNumber('2026-01-04', 0)).toBe(2);
    expect(weekNumber('2026-12-27', 0)).toBe(1);
    expect(weekNumber('2026-12-26', 0)).toBe(52);
    expect(weekNumber('2026-01-02', 6)).toBe(1);
    expect(weekNumber('2026-01-03', 6)).toBe(2);
    expect(weekNumber('2026-12-26', 6)).toBe(1);
  });
});
