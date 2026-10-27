import type { Weekday } from '@carehub/team-time';
import { DEFAULT_TIME_PREFS } from '@carehub/team-time';
import { describe, expect, it } from 'vitest';
import type { Schedule } from './schedule';
import {
  catchUp,
  describeRunTiming,
  describeSchedule,
  nextRun,
  planNextRun,
  runTiming,
  scheduleProblems,
} from './schedule';

const at = (iso: string) => new Date(iso);
const iso = (date: Date | null) => date?.toISOString() ?? null;
const denver = 'America/Denver';

const weekdays: Schedule = { kind: 'weekdays', time: '09:00', timeZone: denver, endDate: null };
const daily = (time: string, timeZone: string, endDate: string | null = null): Schedule => ({
  kind: 'daily',
  time,
  timeZone,
  endDate,
});

/** The next `count` runs after `from`. */
function runs(schedule: Schedule, from: string, count: number): (string | null)[] {
  const out: (string | null)[] = [];
  let after: Date | null = at(from);
  for (let i = 0; i < count && after; i += 1) {
    after = nextRun(schedule, after);
    out.push(iso(after));
  }
  return out;
}

describe('nextRun', () => {
  it('runs weekdays at 9:00 AM Denver time, skipping the weekend (AU-01)', () => {
    // Monday Oct 26, 2026 is in summer time (UTC-6); clocks go back on Sunday Nov 1.
    expect(runs(weekdays, '2026-10-29T15:00:00Z', 3)).toEqual([
      '2026-10-30T15:00:00.000Z',
      '2026-11-02T16:00:00.000Z',
      '2026-11-03T16:00:00.000Z',
    ]);
  });

  it('stays at 9:00 local time across both clock changes (AU-03)', () => {
    const schedule = daily('09:00', denver);
    expect(runs(schedule, '2026-10-31T12:00:00Z', 2)).toEqual([
      '2026-10-31T15:00:00.000Z',
      '2026-11-01T16:00:00.000Z',
    ]);
    // Clocks go forward on Sunday Mar 14, 2027.
    expect(runs(schedule, '2027-03-13T12:00:00Z', 2)).toEqual([
      '2027-03-13T16:00:00.000Z',
      '2027-03-14T15:00:00.000Z',
    ]);
  });

  it('runs a time that does not exist at the next valid time, once (AU-03)', () => {
    // 2:30 AM doesn't happen in New York on Mar 14, 2027: clocks jump from 2:00 to 3:00.
    expect(runs(daily('02:30', 'America/New_York'), '2027-03-13T00:00:00Z', 3)).toEqual([
      '2027-03-13T07:30:00.000Z',
      '2027-03-14T07:00:00.000Z',
      '2027-03-15T06:30:00.000Z',
    ]);
  });

  it('runs a time that happens twice only once (AU-03)', () => {
    // 1:30 AM happens twice in New York on Nov 1, 2026; the first one counts.
    expect(runs(daily('01:30', 'America/New_York'), '2026-10-31T00:00:00Z', 3)).toEqual([
      '2026-10-31T05:30:00.000Z',
      '2026-11-01T05:30:00.000Z',
      '2026-11-02T06:30:00.000Z',
    ]);
  });

  it('runs on the chosen days of the week', () => {
    const schedule: Schedule = {
      kind: 'weekly',
      days: [4, 2],
      time: '14:30',
      timeZone: 'Europe/Lisbon',
      endDate: null,
    };
    expect(runs(schedule, '2026-10-26T12:00:00Z', 3)).toEqual([
      '2026-10-27T14:30:00.000Z',
      '2026-10-29T14:30:00.000Z',
      '2026-11-03T14:30:00.000Z',
    ]);
  });

  it('runs on a day of the month, or on its last day', () => {
    const monthly = (dayOfMonth: number | 'last'): Schedule => ({
      kind: 'monthly',
      dayOfMonth,
      time: '09:00',
      timeZone: 'UTC',
      endDate: null,
    });
    expect(runs(monthly(15), '2026-10-26T00:00:00Z', 2)).toEqual([
      '2026-11-15T09:00:00.000Z',
      '2026-12-15T09:00:00.000Z',
    ]);
    expect(runs(monthly('last'), '2026-10-26T00:00:00Z', 2)).toEqual([
      '2026-10-31T09:00:00.000Z',
      '2026-11-30T09:00:00.000Z',
    ]);
    expect(iso(nextRun(monthly('last'), at('2028-02-01T00:00:00Z')))).toBe(
      '2028-02-29T09:00:00.000Z',
    );
  });

  it('runs a Once schedule once, and stops after the end date', () => {
    const once: Schedule = { kind: 'once', date: '2026-10-30', time: '09:00', timeZone: denver };
    expect(runs(once, '2026-10-26T00:00:00Z', 2)).toEqual(['2026-10-30T15:00:00.000Z', null]);
    expect(runs(daily('09:00', denver, '2026-10-31'), '2026-10-30T12:00:00Z', 3)).toEqual([
      '2026-10-30T15:00:00.000Z',
      '2026-10-31T15:00:00.000Z',
      null,
    ]);
  });
});

describe('planNextRun', () => {
  it('keeps at least 15 minutes after the last run (AU-11)', () => {
    const schedule = daily('09:15', 'UTC');
    const now = at('2026-10-26T09:06:00Z');
    expect(iso(planNextRun(schedule, now))).toBe('2026-10-26T09:15:00.000Z');
    expect(iso(planNextRun(schedule, now, at('2026-10-26T09:00:00Z')))).toBe(
      '2026-10-26T09:15:00.000Z',
    );
    expect(iso(planNextRun(schedule, now, at('2026-10-26T09:05:00Z')))).toBe(
      '2026-10-27T09:15:00.000Z',
    );
  });
});

describe('runTiming', () => {
  const planned = at('2026-10-26T15:00:00Z');
  const timing = (iso: string) => describeRunTiming(runTiming(planned, at(iso)));

  it('marks runs late within the hour and missed after it (AU-05)', () => {
    expect(timing('2026-10-26T15:00:30Z')).toBeNull();
    expect(timing('2026-10-26T15:01:00Z')).toBe('Ran 1 minute late');
    expect(timing('2026-10-26T15:25:10Z')).toBe('Ran 25 minutes late');
    expect(timing('2026-10-26T15:59:59Z')).toBe('Ran 59 minutes late');
    expect(timing('2026-10-26T16:00:00Z')).toBe('Missed: the server was off');
  });
});

describe('catchUp', () => {
  const schedule = daily('09:00', denver);
  const planned = at('2026-10-27T15:00:00Z');

  it('runs a run that is less than an hour late, once (AU-05)', () => {
    const result = catchUp(schedule, planned, at('2026-10-27T15:20:00Z'));
    expect(result.due.map(iso)).toEqual(['2026-10-27T15:00:00.000Z']);
    expect(result.missed).toEqual([]);
    expect(iso(result.next)).toBe('2026-10-28T15:00:00.000Z');
  });

  it('logs older runs as missed (AU-05)', () => {
    const result = catchUp(schedule, planned, at('2026-10-27T17:00:00Z'));
    expect(result.due).toEqual([]);
    expect(result.missed.map(iso)).toEqual(['2026-10-27T15:00:00.000Z']);
    expect(iso(result.next)).toBe('2026-10-28T15:00:00.000Z');
  });

  it('lists each run while the server was off, keeping the latest missed ones', () => {
    const now = at('2026-10-30T15:10:00Z');
    expect(catchUp(schedule, planned, now).missed.length).toBe(3);
    const result = catchUp(schedule, planned, now, 2);
    expect(result.missed.map(iso)).toEqual([
      '2026-10-28T15:00:00.000Z',
      '2026-10-29T15:00:00.000Z',
    ]);
    expect(result.due.map(iso)).toEqual(['2026-10-30T15:00:00.000Z']);
    expect(iso(result.next)).toBe('2026-10-31T15:00:00.000Z');
  });

  it('has nothing next for a Once schedule', () => {
    const once: Schedule = { kind: 'once', date: '2026-10-27', time: '09:00', timeZone: denver };
    expect(catchUp(once, planned, at('2026-10-27T15:05:00Z')).next).toBeNull();
  });
});

describe('scheduleProblems', () => {
  const now = at('2026-10-26T18:00:00Z'); // 12:00 PM in Denver

  it('accepts a good schedule', () => {
    expect(scheduleProblems(weekdays, now)).toEqual([]);
  });

  it('names the field for each problem', () => {
    const weekly: Schedule = {
      kind: 'weekly',
      days: [],
      time: '09:07',
      timeZone: 'Mars/Base',
      endDate: null,
    };
    expect(scheduleProblems(weekly, now)).toEqual([
      { field: 'time', message: 'Pick a time on the quarter hour, like 9:00 or 9:15.' },
      { field: 'timeZone', message: 'Pick a time zone.' },
      { field: 'days', message: 'Pick at least one day.' },
    ]);
    const monthly: Schedule = {
      kind: 'monthly',
      dayOfMonth: 31,
      time: '09:00',
      timeZone: denver,
      endDate: null,
    };
    expect(scheduleProblems(monthly, now)).toEqual([
      { field: 'dayOfMonth', message: 'Pick a day from 1 to 28, or the last day.' },
    ]);
  });

  it('refuses times that have already passed', () => {
    const once: Schedule = { kind: 'once', date: '2026-10-26', time: '11:45', timeZone: denver };
    expect(scheduleProblems(once, now)).toEqual([
      { field: 'time', message: 'That time has already passed.' },
    ]);
    expect(scheduleProblems({ ...once, time: '12:15' }, now)).toEqual([]);
    expect(scheduleProblems(daily('09:00', denver, '2026-10-25'), now)).toEqual([
      { field: 'endDate', message: 'That end date has already passed.' },
    ]);
    expect(scheduleProblems(daily('09:00', denver, '2026-10-26'), now)).toEqual([
      { field: 'endDate', message: 'No runs are left before the end date.' },
    ]);
  });
});

describe('describeSchedule', () => {
  const prefs = DEFAULT_TIME_PREFS; // Denver, 12-hour times, weeks start on Sunday
  const weekly = (days: Weekday[]): Schedule => ({
    kind: 'weekly',
    days,
    time: '09:00',
    timeZone: denver,
    endDate: null,
  });
  const monthly = (dayOfMonth: number | 'last'): Schedule => ({
    kind: 'monthly',
    dayOfMonth,
    time: '09:00',
    timeZone: denver,
    endDate: null,
  });

  it('reads the schedule back in plain words', () => {
    expect(describeSchedule(weekdays, prefs)).toBe('Weekdays at 9:00 AM');
    expect(describeSchedule(daily('14:30', 'Europe/Lisbon'), prefs)).toBe(
      'Every day at 2:30 PM (Lisbon time)',
    );
    expect(describeSchedule(daily('09:00', 'UTC'), prefs)).toBe('Every day at 9:00 AM (UTC)');
    expect(describeSchedule({ ...weekdays, endDate: '2026-12-18' }, prefs)).toBe(
      'Weekdays at 9:00 AM until Dec 18, 2026',
    );
    expect(
      describeSchedule(
        { kind: 'once', date: '2026-10-30', time: '16:45', timeZone: denver },
        prefs,
      ),
    ).toBe('Once on Oct 30, 2026 at 4:45 PM');
    expect(describeSchedule(weekdays, { ...prefs, use24h: true })).toBe('Weekdays at 09:00');
  });

  it('names the days of a weekly schedule in week order', () => {
    expect(describeSchedule(weekly([4, 1]), prefs)).toBe('Every Monday and Thursday at 9:00 AM');
    expect(describeSchedule(weekly([5, 1, 3]), prefs)).toBe(
      'Every Monday, Wednesday and Friday at 9:00 AM',
    );
    expect(describeSchedule(weekly([1, 0]), prefs)).toBe('Every Sunday and Monday at 9:00 AM');
    expect(describeSchedule(weekly([1, 0]), { ...prefs, weekStart: 1 })).toBe(
      'Every Monday and Sunday at 9:00 AM',
    );
    expect(describeSchedule(weekly([1, 2, 3, 4, 5]), prefs)).toBe('Weekdays at 9:00 AM');
    expect(describeSchedule(weekly([0, 1, 2, 3, 4, 5, 6]), prefs)).toBe('Every day at 9:00 AM');
  });

  it('names the day of a monthly schedule', () => {
    expect(describeSchedule(monthly(1), prefs)).toBe('Every month on the 1st at 9:00 AM');
    expect(describeSchedule(monthly(13), prefs)).toBe('Every month on the 13th at 9:00 AM');
    expect(describeSchedule(monthly(22), prefs)).toBe('Every month on the 22nd at 9:00 AM');
    expect(describeSchedule(monthly('last'), prefs)).toBe('Every month on the last day at 9:00 AM');
  });
});
