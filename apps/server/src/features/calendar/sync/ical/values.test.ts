import { describe, expect, it } from 'vitest';
import {
  formatIcalUtc,
  formatUtcOffset,
  parseCivil,
  parseDuration,
  parseIcalDateTime,
  parseUtcOffset,
  weekday,
} from './values';

describe('parseIcalDateTime', () => {
  it('reads dates, local times and UTC times', () => {
    expect(parseIcalDateTime('20261224')).toEqual({
      civil: { year: 2026, month: 12, day: 24, hour: 0, minute: 0 },
      seconds: 0,
      dateOnly: true,
      utc: false,
    });
    expect(parseIcalDateTime('20261102T093015')).toMatchObject({
      civil: { year: 2026, month: 11, day: 2, hour: 9, minute: 30 },
      seconds: 15,
      utc: false,
    });
    expect(parseIcalDateTime('20261102T093000z')?.utc).toBe(true);
  });

  it('is lenient about missing seconds and 24:00', () => {
    expect(parseIcalDateTime('20261102T0930')?.civil.minute).toBe(30);
    expect(parseIcalDateTime('20261231T240000')?.civil).toEqual({
      year: 2027,
      month: 1,
      day: 1,
      hour: 0,
      minute: 0,
    });
  });

  it('rejects impossible values', () => {
    for (const value of ['20261302', '20260230', '20261102T250000', '2026-11-02', '']) {
      expect(parseIcalDateTime(value)).toBeUndefined();
    }
  });
});

describe('parseDuration', () => {
  it('keeps nominal days apart from exact time', () => {
    expect(parseDuration('PT1H30M')).toEqual({ sign: 1, days: 0, seconds: 5400 });
    expect(parseDuration('P1W')).toEqual({ sign: 1, days: 7, seconds: 0 });
    expect(parseDuration('P1DT2H')).toEqual({ sign: 1, days: 1, seconds: 7200 });
    expect(parseDuration('-PT15M')).toEqual({ sign: -1, days: 0, seconds: 900 });
  });

  it('rejects malformed durations', () => {
    for (const value of ['P', 'PT', 'P1DT', '1H', 'PT1.5H']) {
      expect(parseDuration(value)).toBeUndefined();
    }
  });
});

describe('UTC offsets', () => {
  it('reads and writes offsets in minutes', () => {
    expect(parseUtcOffset('-0700')).toBe(-420);
    expect(parseUtcOffset('+0530')).toBe(330);
    expect(parseUtcOffset('+051700')).toBe(317);
    expect(parseUtcOffset('0530')).toBeUndefined();
    expect(parseUtcOffset('+0575')).toBeUndefined();
    expect(formatUtcOffset(-420)).toBe('-0700');
    expect(formatUtcOffset(345)).toBe('+0545');
  });
});

describe('helpers', () => {
  it('formats UTC instants and reads Care Hub wall-clock strings', () => {
    expect(formatIcalUtc(Date.UTC(2026, 9, 27, 16, 0, 42))).toBe('20261027T160000Z');
    expect(formatIcalUtc(Date.UTC(2026, 9, 27, 16, 0, 42), true)).toBe('20261027T160042Z');
    expect(parseCivil('2026-10-27T16:00')).toEqual({
      year: 2026,
      month: 10,
      day: 27,
      hour: 16,
      minute: 0,
    });
    expect(parseCivil('2026-02-29')).toBeUndefined();
    expect(weekday(2026, 11, 1)).toBe(0); // a Sunday
  });
});
