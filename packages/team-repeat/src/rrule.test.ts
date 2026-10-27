import { describe, expect, it } from 'vitest';
import { isUnsupported, parseRRule, serializeRRule } from './rrule';
import { RepeatError } from './types';
import type { RepeatRule } from './types';

// The event's zone is 7 hours behind UTC in these tests (America/Denver in summer, say).
const toUtc = (civil: string) => new Date(`${civil}:00-07:00`).toISOString();
const fromUtc = (instant: string) =>
  new Date(new Date(instant).getTime() - 7 * 3_600_000).toISOString().slice(0, 16);

const errorCode = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error instanceof RepeatError ? error.code : 'other';
  }
  return 'none';
};

describe('parseRRule', () => {
  it('reads the supported subset, with or without the prefix, in any case', () => {
    expect(parseRRule('RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE')).toEqual({
      freq: 'weekly',
      interval: 2,
      byDay: [{ day: 'MO' }, { day: 'WE' }],
    });
    expect(parseRRule('freq=monthly;byday=-1fr')).toEqual({
      freq: 'monthly',
      interval: 1,
      byDay: [{ day: 'FR', nth: -1 }],
    });
    expect(parseRRule('FREQ=MONTHLY;BYDAY=2MO,+3TU;COUNT=10')).toEqual({
      freq: 'monthly',
      interval: 1,
      byDay: [
        { day: 'MO', nth: 2 },
        { day: 'TU', nth: 3 },
      ],
      count: 10,
    });
    expect(parseRRule('FREQ=YEARLY;BYMONTH=11;BYDAY=4TH')).toEqual({
      freq: 'yearly',
      interval: 1,
      byMonth: [11],
      byDay: [{ day: 'TH', nth: 4 }],
    });
    expect(parseRRule('FREQ=MONTHLY;BYMONTHDAY=1,15,-1;WKST=SU')).toEqual({
      freq: 'monthly',
      interval: 1,
      byMonthDay: [1, 15, -1],
      weekStart: 'SU',
    });
  });

  it('reads UNTIL as a date, a floating time or a UTC time', () => {
    expect(parseRRule('FREQ=DAILY;UNTIL=20261231')).toMatchObject({ until: '2026-12-31' });
    expect(parseRRule('FREQ=DAILY;UNTIL=20261231T170000')).toMatchObject({
      until: '2026-12-31T17:00',
    });
    expect(parseRRule('FREQ=DAILY;UNTIL=20270101T065959Z', { fromUtc })).toMatchObject({
      until: '2026-12-31T23:59',
    });
    expect(errorCode(() => parseRRule('FREQ=DAILY;UNTIL=20270101T065959Z'))).toBe(
      'needs-converter',
    );
  });

  it.each([
    'FREQ=HOURLY',
    'FREQ=MONTHLY;BYSETPOS=-1;BYDAY=MO,TU,WE,TH,FR',
    'FREQ=DAILY;BYHOUR=9,17',
    'FREQ=YEARLY;BYWEEKNO=20',
    'FREQ=DAILY;COUNT=3;COUNT=4',
    'FREQ=DAILY;COUNT=0',
    'FREQ=DAILY;COUNT=2;UNTIL=20261231',
    'FREQ=DAILY;INTERVAL=1001',
    'FREQ=DAILY;UNTIL=20261332',
    'FREQ=DAILY;UNTIL=2026-12-31',
    'FREQ=WEEKLY;BYDAY=2MO',
    'FREQ=MONTHLY;BYDAY=6MO',
    'FREQ=MONTHLY;BYMONTHDAY=0',
    'FREQ=MONTHLY;BYMONTH=13',
    'FREQ=DAILY;X-CAREHUB=1',
    'FREQ=DAILY;COUNT',
    'INTERVAL=2',
    'RRULE:FREQ=DAILY\nEXDATE:20261027',
    '',
  ])('passes %j through as unsupported', (text) => {
    const rule = parseRRule(text);
    expect(rule).toEqual({ unsupported: true, raw: text });
    expect(isUnsupported(rule)).toBe(true);
  });
});

describe('serializeRRule', () => {
  it('writes parts in a fixed order, leaving out INTERVAL=1', () => {
    const rule: RepeatRule = {
      byDay: [{ day: 'TH', nth: 4 }],
      byMonth: [11],
      interval: 1,
      freq: 'yearly',
      count: 5,
    };
    expect(serializeRRule(rule, { allDay: true })).toBe(
      'RRULE:FREQ=YEARLY;COUNT=5;BYMONTH=11;BYDAY=4TH',
    );
  });

  it('writes UNTIL as a date for all-day events and in UTC for timed ones', () => {
    const rule: RepeatRule = { freq: 'daily', interval: 2, until: '2026-12-31' };
    expect(serializeRRule(rule, { allDay: true })).toBe(
      'RRULE:FREQ=DAILY;INTERVAL=2;UNTIL=20261231',
    );
    expect(serializeRRule(rule, { allDay: false, toUtc })).toBe(
      'RRULE:FREQ=DAILY;INTERVAL=2;UNTIL=20270101T065959Z',
    );
    expect(serializeRRule({ ...rule, until: '2026-12-31T17:00' }, { allDay: false, toUtc })).toBe(
      'RRULE:FREQ=DAILY;INTERVAL=2;UNTIL=20270101T000059Z',
    );
    expect(errorCode(() => serializeRRule(rule, { allDay: false }))).toBe('needs-converter');
    expect(errorCode(() => serializeRRule(rule, { allDay: false, toUtc: () => 'soon' }))).toBe(
      'invalid-input',
    );
  });

  it('passes unsupported rules through and refuses invalid ones', () => {
    const raw = 'RRULE:FREQ=MONTHLY;BYSETPOS=-1;BYDAY=MO,TU,WE,TH,FR';
    expect(serializeRRule({ unsupported: true, raw }, { allDay: false })).toBe(raw);
    const broken = { freq: 'daily', interval: 0 } as RepeatRule;
    expect(errorCode(() => serializeRRule(broken, { allDay: true }))).toBe('invalid-input');
  });
});

describe('RRULE round trips', () => {
  it.each([
    'RRULE:FREQ=DAILY',
    'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
    'RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=4;BYDAY=TU,SU;WKST=SU',
    'RRULE:FREQ=MONTHLY;BYMONTHDAY=31',
    'RRULE:FREQ=MONTHLY;BYMONTHDAY=-1',
    'RRULE:FREQ=MONTHLY;COUNT=10;BYDAY=-1FR',
    'RRULE:FREQ=MONTHLY;BYDAY=2TU',
    'RRULE:FREQ=MONTHLY;BYMONTHDAY=13;BYDAY=FR',
    'RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29',
    'RRULE:FREQ=YEARLY;INTERVAL=4;UNTIL=20401231;BYMONTH=11;BYDAY=4TH',
    'RRULE:FREQ=YEARLY;BYDAY=20MO',
  ])('text → rule → text: %s', (text) => {
    expect(serializeRRule(parseRRule(text), { allDay: true })).toBe(text);
  });

  it('timed UNTIL survives the trip through UTC', () => {
    const text = 'RRULE:FREQ=WEEKLY;UNTIL=20261201T165959Z;BYDAY=MO,WE';
    const rule = parseRRule(text, { fromUtc });
    expect(rule).toMatchObject({ until: '2026-12-01T09:59' });
    expect(serializeRRule(rule, { allDay: false, toUtc })).toBe(text);
  });

  it('rule → text → rule', () => {
    const rules: RepeatRule[] = [
      { freq: 'daily', interval: 3, count: 7 },
      { freq: 'weekly', interval: 2, byDay: [{ day: 'MO' }, { day: 'WE' }], weekStart: 'SU' },
      { freq: 'monthly', interval: 1, byDay: [{ day: 'TU', nth: 2 }], until: '2027-06-30T09:00' },
      { freq: 'yearly', interval: 1, byMonth: [2], byMonthDay: [29], until: '2040-03-01' },
    ];
    for (const rule of rules) {
      const text = serializeRRule(rule, { allDay: false, toUtc });
      const back = parseRRule(text, { fromUtc });
      const until = rule.until?.length === 10 ? `${rule.until}T23:59` : rule.until;
      expect(back).toEqual(until === undefined ? rule : { ...rule, until });
    }
  });
});
