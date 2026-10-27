import { describe, expect, it } from 'vitest';
import {
  addDays,
  civilDate,
  epochMinute,
  isTimeZone,
  startOfDay,
  zoneOffsetMinutes,
  zonedInstant,
} from './time';

const ms = (iso: string) => Date.parse(iso);
const iso = (value: number) => new Date(value).toISOString();

describe('epochMinute', () => {
  it('counts whole minutes from the epoch, rounding down', () => {
    expect(epochMinute(0)).toBe(0);
    expect(epochMinute(59_999)).toBe(0);
    expect(epochMinute(60_000)).toBe(1);
    expect(epochMinute(-1)).toBe(-1);
    expect(epochMinute(ms('2026-10-27T08:00:30Z'))).toBe(ms('2026-10-27T08:00:00Z') / 60_000);
  });
});

describe('isTimeZone', () => {
  it('knows IANA names and nothing else', () => {
    expect(isTimeZone('America/Denver')).toBe(true);
    expect(isTimeZone('Asia/Kathmandu')).toBe(true);
    expect(isTimeZone('UTC')).toBe(true);
    expect(isTimeZone('Mars/Olympus_Mons')).toBe(false);
    expect(isTimeZone('')).toBe(false);
  });
});

describe('zoneOffsetMinutes', () => {
  it('follows summer and winter time', () => {
    expect(zoneOffsetMinutes(ms('2026-07-01T12:00:00Z'), 'America/Denver')).toBe(-360);
    expect(zoneOffsetMinutes(ms('2026-01-15T12:00:00Z'), 'America/Denver')).toBe(-420);
    expect(zoneOffsetMinutes(ms('2026-07-01T12:00:00Z'), 'Europe/Berlin')).toBe(120);
    expect(zoneOffsetMinutes(ms('2026-01-15T12:00:00Z'), 'Europe/Berlin')).toBe(60);
  });

  it('handles zones a quarter hour off and UTC', () => {
    expect(zoneOffsetMinutes(ms('2026-10-27T00:00:00Z'), 'Asia/Kathmandu')).toBe(345);
    expect(zoneOffsetMinutes(ms('2026-10-27T00:00:00Z'), 'UTC')).toBe(0);
  });

  it('changes exactly when the clocks do', () => {
    // Denver goes back from 02:00 to 01:00 at 08:00 UTC on November 1, 2026.
    expect(zoneOffsetMinutes(ms('2026-11-01T07:59:59Z'), 'America/Denver')).toBe(-360);
    expect(zoneOffsetMinutes(ms('2026-11-01T08:00:00Z'), 'America/Denver')).toBe(-420);
  });
});

describe('civilDate', () => {
  it('gives the date on the wall calendar of the zone', () => {
    // 00:30 UTC on October 27 is still the evening of October 26 in Denver.
    expect(civilDate(ms('2026-10-27T00:30:00Z'), 'America/Denver')).toBe('2026-10-26');
    expect(civilDate(ms('2026-10-27T00:30:00Z'), 'UTC')).toBe('2026-10-27');
    expect(civilDate(ms('2026-10-26T18:14:00Z'), 'Asia/Kathmandu')).toBe('2026-10-26');
    expect(civilDate(ms('2026-10-26T18:15:00Z'), 'Asia/Kathmandu')).toBe('2026-10-27');
  });
});

describe('addDays', () => {
  it('moves across months, years and leap days', () => {
    expect(addDays('2026-10-27', 1)).toBe('2026-10-28');
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-10-27', -29)).toBe('2026-09-28');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
  });

  it('refuses anything that is not a date', () => {
    expect(() => addDays('10/27/2026', 1)).toThrow('Not a date');
  });
});

describe('zonedInstant', () => {
  it('finds a wall-clock time in a zone', () => {
    expect(iso(zonedInstant('2026-10-27', '02:00', 'America/Denver'))).toBe(
      '2026-10-27T08:00:00.000Z',
    );
    expect(iso(zonedInstant('2026-01-15', '02:00', 'America/Denver'))).toBe(
      '2026-01-15T09:00:00.000Z',
    );
    expect(iso(zonedInstant('2026-10-27', '00:00', 'Asia/Kathmandu'))).toBe(
      '2026-10-26T18:15:00.000Z',
    );
    expect(iso(zonedInstant('2026-10-27', '23:59', 'UTC'))).toBe('2026-10-27T23:59:00.000Z');
  });

  it('takes the first of a time that happens twice when the clocks go back', () => {
    expect(iso(zonedInstant('2026-11-01', '01:30', 'America/Denver'))).toBe(
      '2026-11-01T07:30:00.000Z',
    );
    expect(iso(zonedInstant('2026-11-01', '02:00', 'America/Denver'))).toBe(
      '2026-11-01T09:00:00.000Z',
    );
    expect(iso(zonedInstant('2026-10-25', '02:30', 'Europe/Berlin'))).toBe(
      '2026-10-25T00:30:00.000Z',
    );
  });

  it('reads a skipped time with the offset from before the clocks went forward', () => {
    // On March 8, 2026 Denver skips from 02:00 to 03:00: 02:00 is the moment of the change.
    expect(iso(zonedInstant('2026-03-08', '02:00', 'America/Denver'))).toBe(
      '2026-03-08T09:00:00.000Z',
    );
    expect(iso(zonedInstant('2026-03-08', '02:30', 'America/Denver'))).toBe(
      '2026-03-08T09:30:00.000Z',
    );
    expect(iso(zonedInstant('2026-03-08', '03:00', 'America/Denver'))).toBe(
      '2026-03-08T09:00:00.000Z',
    );
    expect(iso(zonedInstant('2026-03-29', '02:30', 'Europe/Berlin'))).toBe(
      '2026-03-29T01:30:00.000Z',
    );
  });

  it('refuses times that are not HH:mm', () => {
    expect(() => zonedInstant('2026-10-27', '24:00', 'UTC')).toThrow('Not a time');
    expect(() => zonedInstant('2026-10-27', '2:00', 'UTC')).toThrow('Not a time');
  });
});

describe('startOfDay', () => {
  it('is local midnight, so days are 23 or 25 hours long when the clocks change', () => {
    expect(iso(startOfDay('2026-10-27', 'America/Denver'))).toBe('2026-10-27T06:00:00.000Z');
    const hours = (date: string) =>
      (startOfDay(addDays(date, 1), 'America/Denver') - startOfDay(date, 'America/Denver')) /
      3_600_000;
    expect(hours('2026-03-08')).toBe(23);
    expect(hours('2026-11-01')).toBe(25);
    expect(hours('2026-10-27')).toBe(24);
  });
});
