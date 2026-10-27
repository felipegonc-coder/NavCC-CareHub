import { describe, expect, it } from 'vitest';
import { addMinutes, isValidTimeZone, timeZoneOffset, toCivil, toInstant, todayIn } from './index';

const NY = 'America/New_York';
const LONDON = 'Europe/London';
const SYDNEY = 'Australia/Sydney';
const KOLKATA = 'Asia/Kolkata';
const DENVER = 'America/Denver';

const iso = (dt: string, zone: string) => toInstant(dt, zone).toISOString();
const at = (isoString: string) => new Date(isoString);

describe('isValidTimeZone', () => {
  it('accepts IANA names that Intl knows', () => {
    for (const zone of [NY, LONDON, SYDNEY, KOLKATA, DENVER, 'UTC', 'Etc/GMT+5']) {
      expect(isValidTimeZone(zone)).toBe(true);
    }
  });

  it('rejects anything else, including UTC offsets', () => {
    for (const zone of ['Mars/Olympus', '', '+01:00', '-05:00', 'America/Denver ', 7, null]) {
      expect(isValidTimeZone(zone)).toBe(false);
    }
  });
});

describe('toInstant and toCivil', () => {
  it('converts ordinary times', () => {
    expect(iso('2026-10-26T09:00', DENVER)).toBe('2026-10-26T15:00:00.000Z');
    expect(iso('2026-12-01T09:00', DENVER)).toBe('2026-12-01T16:00:00.000Z');
    expect(iso('2026-10-26T09:00', KOLKATA)).toBe('2026-10-26T03:30:00.000Z');
    expect(iso('2026-10-26T09:00', 'UTC')).toBe('2026-10-26T09:00:00.000Z');
    expect(toCivil(at('2026-10-26T15:00:00Z'), DENVER)).toBe('2026-10-26T09:00');
    expect(toCivil(at('2026-10-26T15:00:00Z'), KOLKATA)).toBe('2026-10-26T20:30');
    expect(toCivil(at('2026-10-26T15:00:00Z'), SYDNEY)).toBe('2026-10-27T02:00');
  });

  it('drops seconds', () => {
    expect(toCivil(at('2026-10-26T15:00:59.999Z'), DENVER)).toBe('2026-10-26T09:00');
  });

  it('handles Asia/Kolkata (+5:30, no clock changes) at midnight', () => {
    expect(toCivil(at('2026-10-26T18:29:00Z'), KOLKATA)).toBe('2026-10-26T23:59');
    expect(toCivil(at('2026-10-26T18:30:00Z'), KOLKATA)).toBe('2026-10-27T00:00');
    expect(iso('2026-03-08T02:30', KOLKATA)).toBe('2026-03-07T21:00:00.000Z');
  });

  it('throws a RangeError on bad zones, dates and times', () => {
    expect(() => toInstant('2026-10-26T09:00', 'Mars/Olympus')).toThrow(RangeError);
    expect(() => toInstant('2026-10-26T9:00', 'UTC')).toThrow(RangeError);
    expect(() => toCivil(new Date(Number.NaN), 'UTC')).toThrow(RangeError);
    expect(() => toCivil(new Date(), '+01:00')).toThrow(RangeError);
  });
});

describe('America/New_York clock changes', () => {
  it('moves a time in the spring gap forward to 3:00 AM', () => {
    expect(iso('2026-03-08T01:59', NY)).toBe('2026-03-08T06:59:00.000Z');
    expect(iso('2026-03-08T02:00', NY)).toBe('2026-03-08T07:00:00.000Z');
    expect(iso('2026-03-08T02:30', NY)).toBe('2026-03-08T07:00:00.000Z');
    expect(iso('2026-03-08T03:00', NY)).toBe('2026-03-08T07:00:00.000Z');
    expect(iso('2026-03-08T03:30', NY)).toBe('2026-03-08T07:30:00.000Z');
    expect(toCivil(at('2026-03-08T06:59:00Z'), NY)).toBe('2026-03-08T01:59');
    expect(toCivil(at('2026-03-08T07:00:00Z'), NY)).toBe('2026-03-08T03:00');
  });

  it('takes the earlier of a time that happens twice in the autumn', () => {
    expect(iso('2026-11-01T00:59', NY)).toBe('2026-11-01T04:59:00.000Z');
    expect(iso('2026-11-01T01:00', NY)).toBe('2026-11-01T05:00:00.000Z');
    expect(iso('2026-11-01T01:30', NY)).toBe('2026-11-01T05:30:00.000Z');
    expect(iso('2026-11-01T01:59', NY)).toBe('2026-11-01T05:59:00.000Z');
    expect(iso('2026-11-01T02:00', NY)).toBe('2026-11-01T07:00:00.000Z');
    expect(toCivil(at('2026-11-01T05:30:00Z'), NY)).toBe('2026-11-01T01:30');
    expect(toCivil(at('2026-11-01T06:30:00Z'), NY)).toBe('2026-11-01T01:30');
  });
});

describe('Europe/London clock changes', () => {
  it('moves a time in the spring gap forward to 2:00 AM', () => {
    expect(iso('2026-03-29T00:59', LONDON)).toBe('2026-03-29T00:59:00.000Z');
    expect(iso('2026-03-29T01:00', LONDON)).toBe('2026-03-29T01:00:00.000Z');
    expect(iso('2026-03-29T01:30', LONDON)).toBe('2026-03-29T01:00:00.000Z');
    expect(iso('2026-03-29T02:30', LONDON)).toBe('2026-03-29T01:30:00.000Z');
  });

  it('takes the earlier 1:30 AM in October', () => {
    expect(iso('2026-10-25T00:30', LONDON)).toBe('2026-10-24T23:30:00.000Z');
    expect(iso('2026-10-25T01:30', LONDON)).toBe('2026-10-25T00:30:00.000Z');
    expect(iso('2026-10-25T02:00', LONDON)).toBe('2026-10-25T02:00:00.000Z');
    expect(toCivil(at('2026-10-25T01:30:00Z'), LONDON)).toBe('2026-10-25T01:30');
  });
});

describe('Australia/Sydney clock changes (southern hemisphere)', () => {
  it('takes the earlier 2:30 AM when clocks go back in April', () => {
    expect(iso('2026-04-05T01:59', SYDNEY)).toBe('2026-04-04T14:59:00.000Z');
    expect(iso('2026-04-05T02:30', SYDNEY)).toBe('2026-04-04T15:30:00.000Z');
    expect(iso('2026-04-05T03:00', SYDNEY)).toBe('2026-04-04T17:00:00.000Z');
    expect(toCivil(at('2026-04-04T16:30:00Z'), SYDNEY)).toBe('2026-04-05T02:30');
  });

  it('moves a time in the October gap forward to 3:00 AM', () => {
    expect(iso('2026-10-04T01:59', SYDNEY)).toBe('2026-10-03T15:59:00.000Z');
    expect(iso('2026-10-04T02:30', SYDNEY)).toBe('2026-10-03T16:00:00.000Z');
    expect(iso('2026-10-04T03:00', SYDNEY)).toBe('2026-10-03T16:00:00.000Z');
  });
});

describe('unusual gaps', () => {
  it('handles a gap at midnight (America/Sao_Paulo, Nov 4, 2018)', () => {
    expect(iso('2018-11-04T00:00', 'America/Sao_Paulo')).toBe('2018-11-04T03:00:00.000Z');
    expect(toCivil(at('2018-11-04T03:00:00Z'), 'America/Sao_Paulo')).toBe('2018-11-04T01:00');
  });

  it('handles a 30-minute change (Australia/Lord_Howe)', () => {
    expect(iso('2026-10-04T02:15', 'Australia/Lord_Howe')).toBe('2026-10-03T15:30:00.000Z');
  });
});

describe('round trips', () => {
  const days: [string, string][] = [
    [NY, '2026-03-07T00:00'],
    [NY, '2026-10-31T00:00'],
    [LONDON, '2026-03-28T00:00'],
    [LONDON, '2026-10-24T00:00'],
    [SYDNEY, '2026-04-04T00:00'],
    [SYDNEY, '2026-10-03T00:00'],
    [KOLKATA, '2026-10-25T00:00'],
  ];

  it('gives back every valid quarter hour, moves gap times forward, and never goes backwards', () => {
    for (const [zone, from] of days) {
      let previous = -Infinity;
      for (let step = 0; step < 4 * 24 * 3; step += 1) {
        const wall = addMinutes(from, step * 15);
        const instant = toInstant(wall, zone);
        const back = toCivil(instant, zone);
        if (back !== wall) {
          // Only a gap time may change, and only forwards.
          expect(back > wall).toBe(true);
          expect(toCivil(new Date(instant.getTime() - 60_000), zone) < wall).toBe(true);
        }
        expect(instant.getTime()).toBeGreaterThanOrEqual(previous);
        previous = instant.getTime();
      }
    }
  });
});

describe('timeZoneOffset and todayIn', () => {
  it('reports the offset in minutes (local minus UTC)', () => {
    expect(timeZoneOffset(at('2026-07-01T12:00:00Z'), NY)).toBe(-240);
    expect(timeZoneOffset(at('2026-12-01T12:00:00Z'), NY)).toBe(-300);
    expect(timeZoneOffset(at('2026-10-26T12:00:00Z'), DENVER)).toBe(-360);
    expect(timeZoneOffset(at('2026-10-26T12:00:00Z'), SYDNEY)).toBe(660);
    expect(timeZoneOffset(at('2026-10-26T12:00:00Z'), KOLKATA)).toBe(330);
    expect(timeZoneOffset(at('2026-10-26T12:00:00Z'), 'Asia/Kathmandu')).toBe(345);
  });

  it('gives today in the zone asked for', () => {
    const now = at('2026-10-27T05:30:00Z');
    expect(todayIn(DENVER, now)).toBe('2026-10-26');
    expect(todayIn(NY, now)).toBe('2026-10-27');
    expect(todayIn(KOLKATA, now)).toBe('2026-10-27');
    expect(todayIn('Pacific/Honolulu', now)).toBe('2026-10-26');
    expect(todayIn('UTC')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
