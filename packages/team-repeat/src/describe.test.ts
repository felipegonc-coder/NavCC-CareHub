import { describe, expect, it } from 'vitest';
import { describeRepeat } from './describe';
import type { RepeatRule } from './types';

const say = (rule: Omit<RepeatRule, 'interval'> & { interval?: number }, start?: string) =>
  describeRepeat({ interval: 1, ...rule }, start);

describe('describeRepeat', () => {
  it('daily and weekly', () => {
    expect(say({ freq: 'daily' })).toBe('Every day');
    expect(say({ freq: 'daily', interval: 3 })).toBe('Every 3 days');
    const weekdays = (['MO', 'TU', 'WE', 'TH', 'FR'] as const).map((day) => ({ day }));
    expect(say({ freq: 'weekly', byDay: weekdays })).toBe('Every weekday');
    expect(say({ freq: 'weekly', byDay: [{ day: 'TU' }] })).toBe('Every week on Tuesday');
    expect(say({ freq: 'weekly', interval: 2, byDay: [{ day: 'WE' }, { day: 'MO' }] })).toBe(
      'Every 2 weeks on Mon and Wed',
    );
    expect(say({ freq: 'weekly', byDay: [{ day: 'FR' }, { day: 'MO' }, { day: 'WE' }] })).toBe(
      'Every week on Mon, Wed and Fri',
    );
    expect(say({ freq: 'weekly' })).toBe('Every week');
    expect(say({ freq: 'weekly' }, '2026-10-26T10:00')).toBe('Every week on Monday');
  });

  it('orders days from the rule’s week start, Sunday unless set', () => {
    const byDay = [{ day: 'MO' as const }, { day: 'SU' as const }];
    expect(say({ freq: 'weekly', byDay })).toBe('Every week on Sun and Mon');
    expect(say({ freq: 'weekly', byDay, weekStart: 'MO' })).toBe('Every week on Mon and Sun');
  });

  it('monthly', () => {
    expect(say({ freq: 'monthly' }, '2026-10-26')).toBe('Every month on day 26');
    expect(say({ freq: 'monthly', byMonthDay: [1, 15] })).toBe('Every month on days 1 and 15');
    expect(say({ freq: 'monthly', byMonthDay: [-1] })).toBe('Every month on the last day');
    expect(say({ freq: 'monthly', byMonthDay: [1, -2] })).toBe(
      'Every month on day 1 and the 2nd-to-last day',
    );
    expect(say({ freq: 'monthly', byDay: [{ day: 'TU', nth: 2 }] })).toBe(
      'Every month on the 2nd Tuesday',
    );
    expect(say({ freq: 'monthly', interval: 3, byDay: [{ day: 'FR', nth: -1 }] })).toBe(
      'Every 3 months on the last Friday',
    );
    expect(say({ freq: 'monthly', byMonthDay: [13], byDay: [{ day: 'FR' }] })).toBe(
      "Every month on day 13 if it's a Friday",
    );
  });

  it('yearly', () => {
    expect(say({ freq: 'yearly' }, '2026-10-26T09:00')).toBe('Every year on Oct 26');
    expect(say({ freq: 'yearly' }, '2024-02-29')).toBe('Every year on Feb 29');
    expect(say({ freq: 'yearly', byMonth: [11], byDay: [{ day: 'TH', nth: 4 }] })).toBe(
      'Every year on the 4th Thursday of November',
    );
    expect(say({ freq: 'yearly', byMonth: [2], byMonthDay: [-1] })).toBe(
      'Every year on the last day of February',
    );
    expect(say({ freq: 'yearly', byMonth: [6, 7], byMonthDay: [1] })).toBe(
      'Every year on day 1 in Jun and Jul',
    );
    expect(say({ freq: 'yearly', byDay: [{ day: 'MO', nth: 21 }] })).toBe(
      'Every year on the 21st Monday of the year',
    );
    expect(say({ freq: 'yearly', interval: 2, byMonth: [3] })).toBe('Every 2 years in March');
  });

  it('says how it ends', () => {
    expect(say({ freq: 'daily', count: 1 })).toBe('Every day, once');
    expect(say({ freq: 'daily', count: 1000 })).toBe('Every day, 1,000 times');
    expect(say({ freq: 'weekly', byDay: [{ day: 'TU' }], until: '2026-12-31' })).toBe(
      'Every week on Tuesday, until Dec 31, 2026',
    );
    expect(say({ freq: 'daily', until: '2027-01-05T09:00' })).toBe('Every day, until Jan 5, 2027');
  });

  it('names months and day filters on daily and weekly rules', () => {
    expect(say({ freq: 'weekly', byDay: [{ day: 'SA' }], byMonth: [6, 7] })).toBe(
      'Every week on Saturday in Jun and Jul',
    );
    expect(say({ freq: 'daily', byDay: [{ day: 'MO' }, { day: 'WE' }] })).toBe(
      'Every week on Mon and Wed',
    );
    expect(say({ freq: 'daily', interval: 2, byDay: [{ day: 'MO' }, { day: 'WE' }] })).toBe(
      "Every 2 days when it's a Mon or Wed",
    );
  });

  it('calls rules outside the subset a custom repeat', () => {
    expect(describeRepeat({ unsupported: true, raw: 'RRULE:FREQ=HOURLY' })).toBe('Custom repeat');
    const broken = { freq: 'daily', interval: 1, until: 'soon' } as RepeatRule;
    expect(describeRepeat(broken)).toBe('Custom repeat');
    expect(describeRepeat({ freq: 'weekly', interval: 1 }, 'soon')).toBe('Every week');
  });
});
