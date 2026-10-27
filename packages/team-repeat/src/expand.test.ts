import { describe, expect, it } from 'vitest';
import { MAX_OCCURRENCES, expand, occurrenceAt } from './expand';
import { isRepeatRule } from './rule';
import { RepeatError } from './types';
import type { Civil, RepeatRule, Series, WeekdayCode } from './types';

type Event = { title: string; location: string };

const weekly = (rule: Partial<RepeatRule> = {}): Series<Event> => ({
  start: '2026-10-26T10:00',
  end: '2026-10-26T10:30',
  rule: { freq: 'weekly', interval: 1, ...rule },
});

const starts = (series: Series<object>, from: Civil, to: Civil) =>
  expand(series, { from, to }).occurrences.map((o) => o.start);

const errorCode = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error instanceof RepeatError ? error.code : 'other';
  }
  return 'none';
};

describe('expand', () => {
  it('repeats daily, every n days', () => {
    const daily = { start: '2026-10-26', end: '2026-10-27', rule: { freq: 'daily', interval: 2 } };
    expect(starts(daily as Series, '2026-10-26', '2026-11-03')).toEqual([
      '2026-10-26',
      '2026-10-28',
      '2026-10-30',
      '2026-11-01',
    ]);
  });

  it('repeats weekly on chosen days, every 2 weeks', () => {
    const series = weekly({ interval: 2, byDay: [{ day: 'MO' }, { day: 'WE' }] });
    expect(starts(series, '2026-10-26', '2026-11-26')).toEqual([
      '2026-10-26T10:00',
      '2026-10-28T10:00',
      '2026-11-09T10:00',
      '2026-11-11T10:00',
      '2026-11-23T10:00',
      '2026-11-25T10:00',
    ]);
  });

  it('pairs weeks from the week start (RFC 5545 WKST example)', () => {
    const rule = (weekStart: WeekdayCode): RepeatRule => ({
      freq: 'weekly',
      interval: 2,
      count: 4,
      byDay: [{ day: 'TU' }, { day: 'SU' }],
      weekStart,
    });
    const series = (weekStart: WeekdayCode) => ({
      start: '1997-08-05T09:00',
      end: '1997-08-05T10:00',
      rule: rule(weekStart),
    });
    expect(starts(series('MO'), '1997-08-01', '1997-09-30')).toEqual([
      '1997-08-05T09:00',
      '1997-08-10T09:00',
      '1997-08-19T09:00',
      '1997-08-24T09:00',
    ]);
    expect(starts(series('SU'), '1997-08-01', '1997-09-30')).toEqual([
      '1997-08-05T09:00',
      '1997-08-17T09:00',
      '1997-08-19T09:00',
      '1997-08-31T09:00',
    ]);
  });

  it('skips months without day 31', () => {
    const series = {
      start: '2026-01-31',
      end: '2026-02-01',
      rule: { freq: 'monthly', interval: 1 },
    };
    expect(starts(series as Series, '2026-01-01', '2027-01-01')).toEqual([
      '2026-01-31',
      '2026-03-31',
      '2026-05-31',
      '2026-07-31',
      '2026-08-31',
      '2026-10-31',
      '2026-12-31',
    ]);
  });

  it('finds the last day of each month', () => {
    const series: Series = {
      start: '2026-01-31',
      end: '2026-02-01',
      rule: { freq: 'monthly', interval: 1, byMonthDay: [-1] },
    };
    expect(starts(series, '2026-01-01', '2026-05-01')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
  });

  it('repeats Feb 29 only in leap years', () => {
    const series = {
      start: '2024-02-29',
      end: '2024-03-01',
      rule: { freq: 'yearly', interval: 1 },
    };
    expect(starts(series as Series, '2024-01-01', '2034-01-01')).toEqual([
      '2024-02-29',
      '2028-02-29',
      '2032-02-29',
    ]);
  });

  it('finds the last and second-to-last weekday of the month', () => {
    const last: Series = {
      start: '2026-10-30T15:00',
      end: '2026-10-30T16:00',
      rule: { freq: 'monthly', interval: 1, byDay: [{ day: 'FR', nth: -1 }] },
    };
    expect(starts(last, '2026-10-01', '2027-02-01')).toEqual([
      '2026-10-30T15:00',
      '2026-11-27T15:00',
      '2026-12-25T15:00',
      '2027-01-29T15:00',
    ]);
    const secondToLast = { ...last, start: '2026-10-23T15:00', end: '2026-10-23T16:00' };
    secondToLast.rule = { ...last.rule, byDay: [{ day: 'FR', nth: -2 }] };
    expect(starts(secondToLast, '2026-10-01', '2027-01-01')).toEqual([
      '2026-10-23T15:00',
      '2026-11-20T15:00',
      '2026-12-18T15:00',
    ]);
  });

  it('skips months without a 5th Monday', () => {
    const series: Series = {
      start: '2026-11-30',
      end: '2026-12-01',
      rule: { freq: 'monthly', interval: 1, byDay: [{ day: 'MO', nth: 5 }] },
    };
    expect(starts(series, '2026-11-01', '2027-07-01')).toEqual([
      '2026-11-30',
      '2027-03-29',
      '2027-05-31',
    ]);
  });

  it('repeats yearly on the 4th Thursday of November', () => {
    const series: Series = {
      start: '2026-11-26',
      end: '2026-11-27',
      rule: { freq: 'yearly', interval: 1, byMonth: [11], byDay: [{ day: 'TH', nth: 4 }] },
    };
    expect(starts(series, '2026-01-01', '2029-01-01')).toEqual([
      '2026-11-26',
      '2027-11-25',
      '2028-11-23',
    ]);
  });

  it('ends after a count, or on an until date or time (inclusive)', () => {
    const daily = (rule: Partial<RepeatRule>): Series => ({
      start: '2026-10-26T09:00',
      end: '2026-10-26T09:15',
      rule: { freq: 'daily', interval: 1, ...rule },
    });
    const window = ['2026-10-01', '2027-01-01'] as const;
    expect(starts(daily({ count: 3 }), ...window)).toEqual([
      '2026-10-26T09:00',
      '2026-10-27T09:00',
      '2026-10-28T09:00',
    ]);
    expect(starts(daily({ until: '2026-10-28' }), ...window)).toHaveLength(3);
    expect(starts(daily({ until: '2026-10-28T09:00' }), ...window)).toHaveLength(3);
    expect(starts(daily({ until: '2026-10-28T08:59' }), ...window)).toHaveLength(2);
    expect(starts(daily({ until: '2026-10-25' }), ...window)).toEqual(['2026-10-26T09:00']);
  });

  it('counts removed occurrences toward the count, as iCalendar does', () => {
    const series: Series = {
      start: '2026-10-26T09:00',
      end: '2026-10-26T09:15',
      rule: { freq: 'daily', interval: 1, count: 3 },
      exceptions: ['2026-10-27T09:00'],
    };
    expect(starts(series, '2026-10-01', '2027-01-01')).toEqual([
      '2026-10-26T09:00',
      '2026-10-28T09:00',
    ]);
  });

  it('always counts the start, even off the rule', () => {
    const series = weekly({ byDay: [{ day: 'TU' }], count: 3 });
    expect(starts(series, '2026-10-01', '2027-01-01')).toEqual([
      '2026-10-26T10:00',
      '2026-10-27T10:00',
      '2026-11-03T10:00',
    ]);
  });

  it('applies exceptions and overrides by original start', () => {
    const series: Series<Event> = {
      ...weekly(),
      exceptions: ['2026-11-02T10:00', '2026-11-23T10:00'],
      overrides: {
        '2026-11-09T10:00': { start: '2026-11-10T14:00', end: '2026-11-10T15:00' },
        '2026-11-16T10:00': { changes: { title: 'Check-in with Riley Chen' } },
        '2026-11-23T10:00': { changes: { title: 'Removed anyway' } },
        '2026-12-07T10:00': { start: '2026-11-27T09:00', end: '2026-11-27T09:30' },
        '2026-11-30T10:00': { start: '2026-12-08T10:00', end: '2026-12-08T10:30' },
        '2026-11-25T10:00': { start: '2026-11-25T10:00' },
      },
    };
    expect(expand(series, { from: '2026-11-01', to: '2026-12-01' })).toEqual({
      occurrences: [
        { key: '2026-11-09T10:00', start: '2026-11-10T14:00', end: '2026-11-10T15:00' },
        {
          key: '2026-11-16T10:00',
          start: '2026-11-16T10:00',
          end: '2026-11-16T10:30',
          changes: { title: 'Check-in with Riley Chen' },
        },
        { key: '2026-12-07T10:00', start: '2026-11-27T09:00', end: '2026-11-27T09:30' },
      ],
      truncated: false,
    });
  });

  it('includes occurrences that started before the window and run into it', () => {
    const multiDay: Series = {
      start: '2026-10-26',
      end: '2026-10-29',
      rule: { freq: 'weekly', interval: 1 },
    };
    expect(starts(multiDay, '2026-10-28', '2026-10-29')).toEqual(['2026-10-26']);
    expect(starts(multiDay, '2026-10-29', '2026-11-02')).toEqual([]);
    const late: Series = {
      start: '2026-10-26T23:00',
      end: '2026-10-27T01:00',
      rule: { freq: 'daily', interval: 1, count: 2 },
    };
    expect(starts(late, '2026-10-27T00:30', '2026-10-27T01:00')).toEqual(['2026-10-26T23:00']);
    expect(starts(late, '2026-10-27T01:00', '2026-10-27T02:00')).toEqual([]);
    const reminderOnly = { ...late, end: '2026-10-26T23:00' };
    expect(starts(reminderOnly, '2026-10-26T23:00', '2026-10-26T23:30')).toEqual([
      '2026-10-26T23:00',
    ]);
  });

  it('jumps straight to a far window', () => {
    const series: Series = {
      start: '2026-10-26T08:00',
      end: '2026-10-26T08:30',
      rule: { freq: 'daily', interval: 3 },
    };
    // 36,524 days later: 2 past a multiple of 3.
    expect(starts(series, '2126-10-26', '2126-11-01')).toEqual([
      '2126-10-27T08:00',
      '2126-10-30T08:00',
    ]);
  });

  it('caps each call and says when it stopped early', () => {
    const series: Series = {
      start: '2026-01-01T08:00',
      end: '2026-01-01T08:30',
      rule: { freq: 'daily', interval: 1 },
    };
    const all = expand(series, { from: '2026-01-01', to: '2030-01-01' });
    expect(all.occurrences).toHaveLength(MAX_OCCURRENCES);
    expect(all.truncated).toBe(true);
    const few = expand(series, { from: '2026-01-01', to: '2030-01-01', limit: 10 });
    expect(few.occurrences.at(-1)?.start).toBe('2026-01-10T08:00');
    expect(few.truncated).toBe(true);
    const exact = expand(series, { from: '2026-01-01', to: '2026-01-11', limit: 10 });
    expect(exact.truncated).toBe(false);
  });

  it('stops quickly on a rule that hardly ever matches', () => {
    const series: Series = {
      start: '2026-10-26',
      end: '2026-10-27',
      rule: { freq: 'daily', interval: 1, byMonth: [2], byMonthDay: [30] },
    };
    const began = Date.now();
    const result = expand(series, { from: '2026-10-27', to: '9999-01-01' });
    expect(result).toEqual({ occurrences: [], truncated: true });
    expect(Date.now() - began).toBeLessThan(2000);
  });

  it('refuses bad input', () => {
    expect(errorCode(() => expand(weekly(), { from: 'soon', to: '2026-11-01' }))).toBe(
      'invalid-input',
    );
    const broken = { ...weekly(), rule: { freq: 'weekly', interval: 0 } } as Series;
    expect(errorCode(() => expand(broken, { from: '2026-10-01', to: '2026-11-01' }))).toBe(
      'invalid-input',
    );
    expect(expand(weekly(), { from: '2026-11-01', to: '2026-11-01' }).occurrences).toEqual([]);
  });

  it('stays inside years 1 to 9999', () => {
    // 0001-01-01 is a Monday, so its week (starting Saturday) began in year 0.
    const first = { ...weekly({ byDay: [{ day: 'SU' }], weekStart: 'SA' }), start: '0001-01-01' };
    expect(starts({ ...first, end: '0001-01-02' }, '0001-01-01', '0001-01-15')).toEqual([
      '0001-01-01',
      '0001-01-07',
      '0001-01-14',
    ]);
    const all = expand(weekly(), { from: '0001-01-01', to: '9999-12-31T23:59', limit: 2 });
    expect(all.occurrences.map((o) => o.start)).toEqual(['2026-10-26T10:00', '2026-11-02T10:00']);
    expect(all.truncated).toBe(true);
    // Ten days long: occurrences that would end after 9999-12-31 are left out.
    const long: Series = {
      start: '9999-12-01',
      end: '9999-12-11',
      rule: { freq: 'daily', interval: 1 },
    };
    const late = expand(long, { from: '9999-12-01', to: '9999-12-31' });
    expect(late.occurrences.at(-1)).toEqual({
      key: '9999-12-21',
      start: '9999-12-21',
      end: '9999-12-31',
    });
    expect(late.truncated).toBe(false);
    expect(occurrenceAt(long, '9999-12-22')).toBeNull();
  });
});

describe('occurrenceAt', () => {
  const series: Series<Event> = {
    ...weekly(),
    exceptions: ['2026-11-02T10:00'],
    overrides: { '2026-11-09T10:00': { changes: { location: 'Room 2' } } },
  };

  it('returns one occurrence as it shows', () => {
    expect(occurrenceAt(series, '2026-11-16T10:00')).toEqual({
      key: '2026-11-16T10:00',
      start: '2026-11-16T10:00',
      end: '2026-11-16T10:30',
    });
    expect(occurrenceAt(series, '2026-11-09T10:00')?.changes).toEqual({ location: 'Room 2' });
  });

  it('returns null for removed occurrences and keys the rule never makes', () => {
    expect(occurrenceAt(series, '2026-11-02T10:00')).toBeNull();
    expect(occurrenceAt(series, '2026-11-03T10:00')).toBeNull();
    expect(occurrenceAt(series, '2026-11-09T11:00')).toBeNull();
    expect(occurrenceAt(series, '2026-11-09')).toBeNull();
  });
});

// A slow, independent reading of the rules: test every day from the start. Expansion must agree.
const DAY_MS = 86_400_000;
const CODES: readonly WeekdayCode[] = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const ms = (date: string) =>
  Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
const isoDate = (time: number) => new Date(time).toISOString().slice(0, 10);

function referenceKeys(series: Series, from: string, to: string): string[] {
  const { rule, start } = series;
  const first = start.slice(0, 10);
  const time = start.slice(10);
  const [y0, m0, d0] = [first.slice(0, 4), first.slice(5, 7), first.slice(8, 10)].map(Number);
  const startDay = new Date(ms(first)).getUTCDay();
  const weekStart = CODES.indexOf(rule.weekStart ?? 'MO');
  const week0 = ms(first) - ((startDay - weekStart + 7) % 7) * DAY_MS;
  const until = rule.until && (rule.until.length === 10 ? `${rule.until}T23:59` : rule.until);
  const byMonth = rule.byMonth ?? [];
  const byMonthDay = rule.byMonthDay ?? [];
  const byDay = rule.byDay ?? [];

  function matches(date: string): boolean {
    const [y, m, d] = [date.slice(0, 4), date.slice(5, 7), date.slice(8, 10)].map(Number) as [
      number,
      number,
      number,
    ];
    const t = ms(date);
    const weekday = new Date(t).getUTCDay();
    const monthLength = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const yearDay = (t - Date.UTC(y, 0, 1)) / DAY_MS + 1;
    const yearLength = (Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1)) / DAY_MS;
    const isMonthDay = (n: number) => (n > 0 ? n : monthLength + 1 + n) === d;
    const isNth = (nth: number | undefined, n: number, length: number) =>
      nth === undefined ||
      (nth > 0 ? Math.ceil(n / 7) === nth : -Math.ceil((length - n + 1) / 7) === nth);
    const dayFits = (n: number, length: number) =>
      (byMonthDay.length === 0 || byMonthDay.some(isMonthDay)) &&
      (byDay.length === 0 ||
        byDay.some((b) => CODES.indexOf(b.day) === weekday && isNth(b.nth, n, length)));
    if (byMonth.length > 0 && !byMonth.includes(m)) return false;
    switch (rule.freq) {
      case 'daily':
        return (
          Math.round((t - ms(first)) / DAY_MS) % rule.interval === 0 && dayFits(d, monthLength)
        );
      case 'weekly': {
        const days = byDay.length > 0 ? byDay.map((b) => CODES.indexOf(b.day)) : [startDay];
        return (
          Math.floor((t - week0) / (7 * DAY_MS)) % rule.interval === 0 && days.includes(weekday)
        );
      }
      case 'monthly':
        if (((y - y0!) * 12 + m - m0!) % rule.interval !== 0) return false;
        return byMonthDay.length + byDay.length === 0 ? d === d0 : dayFits(d, monthLength);
      case 'yearly':
        if ((y - y0!) % rule.interval !== 0) return false;
        if (byMonthDay.length + byDay.length === 0) {
          return d === d0 && (byMonth.length > 0 || m === m0);
        }
        return byMonth.length > 0 ? dayFits(d, monthLength) : dayFits(yearDay, yearLength);
    }
  }

  const keys: string[] = [];
  let count = 0;
  const take = (key: string) => {
    count += 1;
    if (key.slice(0, 10) >= from && key.slice(0, 10) < to) keys.push(key);
  };
  take(start);
  for (let t = ms(first) + DAY_MS; ; t += DAY_MS) {
    const date = isoDate(t);
    const key = `${date}${time}`;
    if (date >= to || (rule.count !== undefined && count >= rule.count)) break;
    if (until && (time ? key : `${key}T00:00`) > until) break;
    if (matches(date)) take(key);
  }
  return keys;
}

/** A small seeded random generator (mulberry32), so failures can be replayed. */
function random(seed: number) {
  let state = seed;
  const next = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number) => Math.floor(next() * n);
  const pick = <T>(list: readonly T[]): T => list[int(list.length)] as T;
  const some = <T>(list: readonly T[], n: number): T[] =>
    [...list].sort(() => next() - 0.5).slice(0, n);
  return { next, int, pick, some };
}

function randomSeries(r: ReturnType<typeof random>): Series {
  const freq = r.pick(['daily', 'weekly', 'monthly', 'yearly'] as const);
  const rule: Record<string, unknown> = { freq, interval: r.pick([1, 1, 1, 2, 3]) };
  const days = () => r.some(CODES, 1 + r.int(3)).map((day) => ({ day }));
  const kind = r.int(4);
  if (freq === 'daily' && kind === 1) rule.byDay = days();
  if (freq === 'daily' && kind === 2) rule.byMonthDay = r.some([1, 15, 29, 30, 31, -1], 2);
  if (freq === 'weekly' && kind > 0) rule.byDay = days();
  if (freq === 'monthly' && kind === 1)
    rule.byMonthDay = r.some([1, 15, 28, 29, 30, 31, -1, -2], 2);
  if (freq === 'monthly' && kind === 2) {
    rule.byDay = r.some(CODES, 2).map((day) => ({ day, nth: r.pick([1, 2, 4, 5, -1, -2]) }));
  }
  if (freq === 'monthly' && kind === 3) {
    rule.byDay = days().slice(0, 1);
    if (r.next() < 0.5) rule.byMonthDay = [13];
  }
  if (freq === 'yearly') {
    if (kind > 0) rule.byMonth = r.some([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 1 + r.int(2));
    if (kind === 2) rule.byMonthDay = r.some([1, 29, 31, -1], 1);
    if (kind === 3) rule.byDay = [{ day: r.pick(CODES), nth: r.pick([1, 2, 4, -1]) }];
    if (kind === 0 && r.next() < 0.4) {
      rule.byDay = [{ day: r.pick(CODES), nth: r.pick([1, 10, 20, 53, -1]) }];
    }
  }
  if (freq !== 'yearly' && r.next() < 0.15) rule.byMonth = r.some([1, 2, 6, 7, 12], 2);
  if (r.next() < 0.3) rule.weekStart = r.pick(CODES);
  const date = isoDate(ms('2024-01-01') + r.int(1400) * DAY_MS);
  const allDay = r.next() < 0.4;
  const time = r.pick(['09:00', '17:45']);
  const start = allDay ? date : `${date}T${time}`;
  const end = allDay
    ? isoDate(ms(date) + DAY_MS)
    : `${date}T${time === '09:00' ? '09:30' : '18:15'}`;
  const ending = r.int(3);
  if (ending === 1) rule.count = 1 + r.int(40);
  if (ending === 2) {
    const last = isoDate(ms(date) + r.int(900) * DAY_MS);
    rule.until = r.next() < 0.5 ? last : `${last}T${r.pick(['00:00', '09:00', '23:59'])}`;
  }
  return { start, end, rule: rule as RepeatRule };
}

describe('expand against a day-by-day reading', () => {
  it('agrees on 400 random rules', () => {
    const r = random(20261026);
    let checked = 0;
    while (checked < 400) {
      const series = randomSeries(r);
      if (!isRepeatRule(series.rule)) continue;
      const from = isoDate(ms(series.start.slice(0, 10)) + (r.int(800) - 30) * DAY_MS);
      const to = isoDate(ms(from) + (1 + r.int(700)) * DAY_MS);
      const expected = referenceKeys(series, from, to);
      const result = expand(series, { from, to });
      const label = JSON.stringify({ series, from, to });
      expect({ label, keys: result.occurrences.map((o) => o.key) }).toEqual({
        label,
        keys: expected.slice(0, MAX_OCCURRENCES),
      });
      expect(result.truncated).toBe(expected.length > MAX_OCCURRENCES);
      checked += 1;
    }
  });
});
