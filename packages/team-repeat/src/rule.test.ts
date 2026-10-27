import { describe, expect, it } from 'vitest';
import { checkRule, checkSeries, isRepeatRule, normalizeRule } from './rule';
import { RepeatError } from './types';

describe('checkRule', () => {
  it('accepts the supported subset', () => {
    const rules = [
      { freq: 'daily', interval: 1 },
      { freq: 'weekly', interval: 2, byDay: [{ day: 'MO' }, { day: 'WE' }], weekStart: 'SU' },
      { freq: 'monthly', interval: 1, byMonthDay: [31] },
      { freq: 'monthly', interval: 1, byDay: [{ day: 'FR', nth: -1 }], count: 10 },
      { freq: 'yearly', interval: 1, byMonth: [11], byDay: [{ day: 'TH', nth: 4 }] },
      { freq: 'yearly', interval: 1, byDay: [{ day: 'MO', nth: 53 }] },
      { freq: 'daily', interval: 1000, until: '2026-12-31' },
      { freq: 'daily', interval: 1, until: '2026-12-31T17:00', byMonth: [6, 7] },
    ];
    for (const rule of rules) expect(checkRule(rule)).toEqual([]);
  });

  it('explains what is wrong in plain words', () => {
    expect(checkRule(null)).toEqual(['The repeat rule must be an object.']);
    expect(checkRule([{ freq: 'daily' }])).toEqual(['The repeat rule must be an object.']);
    expect(checkRule({ freq: 'hourly', interval: 1 })).toEqual([
      'freq must be daily, weekly, monthly or yearly.',
    ]);
    expect(checkRule({ freq: 'daily', interval: 1, colour: 'red' })).toEqual([
      'Unknown repeat field "colour".',
    ]);
    expect(checkRule({ freq: 'daily', interval: 1, count: 3, until: '2026-12-31' })).toEqual([
      'Use count or until, not both.',
    ]);
  });

  it.each([
    { freq: 'daily' },
    { freq: 'daily', interval: 0 },
    { freq: 'daily', interval: 1001 },
    { freq: 'daily', interval: 1.5 },
    { freq: 'daily', interval: 1, count: 0 },
    { freq: 'daily', interval: 1, until: '2026-02-30' },
    { freq: 'daily', interval: 1, until: 'next week' },
    { freq: 'daily', interval: 1, weekStart: 'MON' },
    { freq: 'daily', interval: 1, byMonth: [] },
    { freq: 'daily', interval: 1, byMonth: [13] },
    { freq: 'monthly', interval: 1, byMonthDay: [0] },
    { freq: 'monthly', interval: 1, byMonthDay: [32] },
    { freq: 'weekly', interval: 1, byMonthDay: [1] },
    { freq: 'weekly', interval: 1, byDay: [{ day: 'MO', nth: 1 }] },
    { freq: 'daily', interval: 1, byDay: [{ day: 'MO', nth: -1 }] },
    { freq: 'monthly', interval: 1, byDay: [{ day: 'MO', nth: 6 }] },
    { freq: 'monthly', interval: 1, byDay: [{ day: 'MO', nth: 0 }] },
    { freq: 'monthly', interval: 1, byDay: [{ day: 'XX' }] },
    { freq: 'monthly', interval: 1, byDay: [{ day: 'MO', when: 'always' }] },
    { freq: 'yearly', interval: 1, byMonth: [1], byDay: [{ day: 'MO', nth: 6 }] },
    { freq: 'yearly', interval: 1, byDay: [{ day: 'MO', nth: 54 }] },
  ])('rejects %j', (rule) => {
    expect(checkRule(rule).length).toBeGreaterThan(0);
    expect(isRepeatRule(rule)).toBe(false);
  });
});

describe('checkSeries', () => {
  const rule = { freq: 'weekly', interval: 1 };

  it('accepts a timed and an all-day series', () => {
    expect(checkSeries({ start: '2026-10-26T10:00', end: '2026-10-26T10:30', rule })).toEqual([]);
    expect(
      checkSeries({
        start: '2026-10-26',
        end: '2026-10-27',
        rule,
        exceptions: ['2026-11-02'],
        overrides: { '2026-11-09': { start: '2026-11-10', end: '2026-11-11', changes: {} } },
      }),
    ).toEqual([]);
  });

  it('rejects mixed kinds, backwards times and stray keys', () => {
    expect(checkSeries({ start: '2026-10-26', end: '2026-10-26T11:00', rule })).toHaveLength(1);
    expect(checkSeries({ start: '2026-10-26T10:00', end: '2026-10-26T09:00', rule })).toHaveLength(
      1,
    );
    const base = { start: '2026-10-26T10:00', end: '2026-10-26T10:30', rule };
    expect(checkSeries({ ...base, exceptions: ['2026-11-02'] })).toHaveLength(1);
    expect(checkSeries({ ...base, overrides: { '2026-11-02': {} } })).toHaveLength(1);
    expect(
      checkSeries({ ...base, overrides: { '2026-11-02T10:00': { start: '2026-11-03T10:00' } } }),
    ).toEqual([]);
    expect(
      checkSeries({
        ...base,
        overrides: {
          '2026-11-02T10:00': { start: '2026-11-03T10:00', end: '2026-11-03T09:00' },
        },
      }),
    ).toHaveLength(1);
    expect(checkSeries({ ...base, overrides: { '2026-11-02T10:00': { note: 'x' } } })).toHaveLength(
      1,
    );
    expect(checkSeries('weekly')).toEqual(['The series must be an object.']);
  });
});

describe('normalizeRule', () => {
  it('spells out what a rule leaves to its start', () => {
    expect(normalizeRule({ freq: 'weekly', interval: 1 }, '2026-10-26T10:00')).toEqual({
      freq: 'weekly',
      interval: 1,
      byDay: [{ day: 'MO' }],
    });
    expect(normalizeRule({ freq: 'monthly', interval: 1 }, '2026-01-31')).toEqual({
      freq: 'monthly',
      interval: 1,
      byMonthDay: [31],
    });
    expect(normalizeRule({ freq: 'yearly', interval: 1 }, '2024-02-29')).toEqual({
      freq: 'yearly',
      interval: 1,
      byMonth: [2],
      byMonthDay: [29],
    });
    expect(normalizeRule({ freq: 'yearly', interval: 1, byMonth: [3, 9] }, '2026-03-10')).toEqual({
      freq: 'yearly',
      interval: 1,
      byMonth: [3, 9],
      byMonthDay: [10],
    });
  });

  it('leaves explicit days alone', () => {
    const rule = {
      freq: 'monthly' as const,
      interval: 1,
      byDay: [{ day: 'FR' as const, nth: -1 }],
    };
    expect(normalizeRule(rule, '2026-10-30')).toEqual(rule);
  });

  it('refuses a bad rule or start', () => {
    const daily = { freq: 'daily' as const, interval: 1 };
    expect(() => normalizeRule(daily, '2026-02-30')).toThrow(RepeatError);
    expect(() => normalizeRule({ ...daily, interval: 0 }, '2026-10-30')).toThrow(RepeatError);
  });
});
