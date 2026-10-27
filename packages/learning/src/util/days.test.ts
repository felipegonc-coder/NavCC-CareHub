import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  compareDays,
  daysBetween,
  isIsoDate,
  isoDateInTimeZone,
  LEARNING_DAY_ZONE,
  learningToday,
  profileZone,
} from './index';

describe('isIsoDate', () => {
  it('accepts real calendar days', () => {
    for (const day of [
      '2026-10-27',
      '2024-02-29',
      '2000-02-29',
      '1970-01-01',
      '0001-01-01',
      '9999-12-31',
      '2026-04-30',
    ]) {
      expect(isIsoDate(day)).toBe(true);
    }
  });

  it('rejects everything else', () => {
    for (const day of [
      '2026-02-29',
      '1900-02-29',
      '2026-04-31',
      '2026-13-01',
      '2026-00-10',
      '2026-10-00',
      '2026-1-01',
      '26-10-27',
      '2026-10-27T00:00:00Z',
      ' 2026-10-27',
      '',
    ]) {
      expect(isIsoDate(day)).toBe(false);
    }
    for (const value of [null, undefined, 20261027, new Date(0), {}])
      expect(isIsoDate(value)).toBe(false);
  });
});

describe('addDays', () => {
  it('moves across months, years and leap days', () => {
    expect(addDays('2026-10-27', 5)).toBe('2026-11-01');
    expect(addDays('2026-10-27', 0)).toBe('2026-10-27');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2023-02-28', 1)).toBe('2023-03-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2027-01-01', -365)).toBe('2026-01-01');
    expect(addDays('2000-01-01', 146_097)).toBe('2400-01-01'); // one 400-year cycle
    expect(addDays('1969-12-31', 1)).toBe('1970-01-01');
    expect(addDays('1970-01-01', -1)).toBe('1969-12-31');
  });

  it('ignores daylight saving changes', () => {
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
  });

  it('throws a RangeError on bad input', () => {
    expect(() => addDays('2026-02-30', 1)).toThrow(RangeError);
    expect(() => addDays('27/10/2026', 1)).toThrow(RangeError);
    expect(() => addDays('2026-10-27', 1.5)).toThrow(RangeError);
    expect(() => addDays('9999-12-31', 1)).toThrow(RangeError);
  });
});

describe('addMonths', () => {
  it('keeps the day of the month when it exists', () => {
    expect(addMonths('2026-10-27', 1)).toBe('2026-11-27');
    expect(addMonths('2026-10-27', 12)).toBe('2027-10-27');
    expect(addMonths('2026-10-27', 120)).toBe('2036-10-27');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
    expect(addMonths('2026-10-27', -22)).toBe('2024-12-27');
    expect(addMonths('2026-10-27', 0)).toBe('2026-10-27');
  });

  it('clamps to the end of shorter months', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonths('2026-05-31', 1)).toBe('2026-06-30');
    expect(addMonths('2024-02-29', 12)).toBe('2025-02-28');
    expect(addMonths('2024-02-29', 48)).toBe('2028-02-29');
  });

  it('throws a RangeError on bad input', () => {
    expect(() => addMonths('2026-02-29', 1)).toThrow(RangeError);
    expect(() => addMonths('2026-10-27', 0.5)).toThrow(RangeError);
  });
});

describe('daysBetween and compareDays', () => {
  it('counts whole days', () => {
    expect(daysBetween('2026-10-30', '2026-11-02')).toBe(3);
    expect(daysBetween('2026-11-02', '2026-10-30')).toBe(-3);
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2);
    expect(daysBetween('2023-02-28', '2023-03-01')).toBe(1);
    expect(daysBetween('2026-01-01', '2027-01-01')).toBe(365);
    expect(daysBetween('2028-01-01', '2029-01-01')).toBe(366);
    expect(daysBetween('2026-10-27', '2026-10-27')).toBe(0);
    expect(daysBetween('1970-01-01', '2026-10-27')).toBe(Date.UTC(2026, 9, 27) / 86_400_000);
  });

  it('sorts days', () => {
    const days = ['2026-11-02', '2025-12-31', '2026-10-27', '2026-10-27', '2026-01-01'];
    expect([...days].sort(compareDays)).toEqual([
      '2025-12-31',
      '2026-01-01',
      '2026-10-27',
      '2026-10-27',
      '2026-11-02',
    ]);
    expect(compareDays('2026-10-27', '2026-10-28')).toBe(-1);
    expect(compareDays('2026-10-28', '2026-10-27')).toBe(1);
    expect(compareDays('2026-10-27', '2026-10-27')).toBe(0);
  });
});

describe('isoDateInTimeZone', () => {
  it('gives the calendar day in the workspace time zone', () => {
    expect(isoDateInTimeZone('2026-10-27T03:00:00Z', 'America/Denver')).toBe('2026-10-26');
    expect(isoDateInTimeZone('2026-10-27T03:00:00Z', 'UTC')).toBe('2026-10-27');
    expect(isoDateInTimeZone('2026-10-27T12:00:00Z', 'Pacific/Auckland')).toBe('2026-10-28');
    expect(isoDateInTimeZone('2026-10-27T23:30:00-05:00', 'Europe/London')).toBe('2026-10-28');
    expect(isoDateInTimeZone('2026-12-31T23:59:59.999Z', 'UTC')).toBe('2026-12-31');
  });

  it('throws a RangeError for bad instants and time zones', () => {
    expect(() => isoDateInTimeZone('not a date', 'UTC')).toThrow(RangeError);
    expect(() => isoDateInTimeZone('2026-10-27T03:00:00Z', 'Mars/Olympus_Mons')).toThrow(
      RangeError,
    );
  });
});

describe('learningToday', () => {
  it('is the day in America/Denver: just after midnight UTC it is still the day before', () => {
    expect(LEARNING_DAY_ZONE).toBe('America/Denver');
    expect(learningToday(new Date('2026-10-28T00:05:00Z'))).toBe('2026-10-27');
    expect(learningToday(new Date('2026-10-28T05:59:59Z'))).toBe('2026-10-27');
    expect(learningToday(new Date('2026-10-28T06:00:00Z'))).toBe('2026-10-28');
    expect(learningToday(new Date('2026-12-01T00:05:00Z'))).toBe('2026-11-30');
    expect(learningToday(new Date('2026-12-01T07:00:00Z'))).toBe('2026-12-01');
  });
});

describe('profileZone', () => {
  it('keeps a time zone Intl accepts', () => {
    expect(profileZone('Asia/Tokyo')).toBe('Asia/Tokyo');
    expect(profileZone('UTC')).toBe('UTC');
  });

  it('falls back to the Learning day zone for a bad, empty or missing zone', () => {
    for (const zone of ['Mars/Olympus_Mons', 'not a zone', '', null, undefined]) {
      expect(profileZone(zone)).toBe('America/Denver');
    }
  });
});
