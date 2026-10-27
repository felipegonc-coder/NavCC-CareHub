import { describe, expect, it } from 'vitest';
import {
  REPEAT_MESSAGES,
  afterRun,
  dueRuns,
  nextRuns,
  repeatTitle,
  shouldPause,
  validateSchedule,
} from './repeat';
import { LIMITS, type RepeatSchedule, type RowTemplate } from './types';

const schedule = (over: Partial<RepeatSchedule> = {}): RepeatSchedule => ({
  every: 'day',
  time: '09:00',
  timeZone: 'America/Denver',
  start: '2026-10-26',
  end: null,
  paused: false,
  ownerId: 'u-sam',
  ...over,
});
const utc = (over: Partial<RepeatSchedule>) =>
  schedule({ timeZone: 'UTC', time: '10:00', ...over });

describe('nextRuns', () => {
  it('runs every weekday at 9:00 AM Denver time, across the clock change', () => {
    const s = schedule({ every: 'weekday' });
    expect(nextRuns(s, '2026-10-29T12:00:00.000Z', 4)).toEqual([
      '2026-10-29T15:00:00.000Z',
      '2026-10-30T15:00:00.000Z',
      '2026-11-02T16:00:00.000Z',
      '2026-11-03T16:00:00.000Z',
    ]);
  });

  it('never skips or doubles a run when the clock changes', () => {
    const spring = schedule({ time: '02:30', start: '2026-03-07' });
    expect(nextRuns(spring, '2026-03-07T00:00:00.000Z', 3)).toEqual([
      '2026-03-07T09:30:00.000Z',
      '2026-03-08T09:30:00.000Z', // 2:30 doesn't exist that night: 3:30 AM
      '2026-03-09T08:30:00.000Z',
    ]);
    const fall = schedule({ time: '01:30', start: '2026-10-31' });
    expect(nextRuns(fall, '2026-10-31T00:00:00.000Z', 3)).toEqual([
      '2026-10-31T07:30:00.000Z',
      '2026-11-01T07:30:00.000Z', // 1:30 happens twice: the first one only
      '2026-11-02T08:30:00.000Z',
    ]);
  });

  it('runs every N days from the start through the end date', () => {
    const s = utc({ interval: 2, end: '2026-11-01' });
    expect(nextRuns(s, '2026-10-01T00:00:00.000Z', 10)).toEqual([
      '2026-10-26T10:00:00.000Z',
      '2026-10-28T10:00:00.000Z',
      '2026-10-30T10:00:00.000Z',
      '2026-11-01T10:00:00.000Z',
    ]);
  });

  it('gives only moments strictly after `after`, and takes a Date too', () => {
    const s = utc({});
    expect(nextRuns(s, '2026-10-27T10:00:00.000Z', 1)).toEqual(['2026-10-28T10:00:00.000Z']);
    expect(nextRuns(s, new Date('2026-10-27T09:59:00.000Z'), 1)).toEqual([
      '2026-10-27T10:00:00.000Z',
    ]);
  });

  it('runs weekly on the chosen days of every Nth week, counted from the start', () => {
    const s = utc({ every: 'week', interval: 2, weekDays: [3, 1], start: '2026-10-28' });
    expect(nextRuns(s, '2026-10-01T00:00:00.000Z', 5)).toEqual([
      '2026-10-28T10:00:00.000Z',
      '2026-11-09T10:00:00.000Z',
      '2026-11-11T10:00:00.000Z',
      '2026-11-23T10:00:00.000Z',
      '2026-11-25T10:00:00.000Z',
    ]);
    expect(nextRuns(s, '2026-11-10T00:00:00.000Z', 2)).toEqual([
      '2026-11-11T10:00:00.000Z',
      '2026-11-23T10:00:00.000Z',
    ]);
  });

  it('runs monthly on a day, on the last day, or on the start day kept within short months', () => {
    const after = '2026-01-01T00:00:00.000Z';
    const last = utc({ every: 'month', monthDay: 'last', start: '2026-01-15' });
    expect(nextRuns(last, after, 4).map((t) => t.slice(0, 10))).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
    const startDay = utc({ every: 'month', start: '2026-01-31' });
    expect(nextRuns(startDay, after, 3).map((t) => t.slice(0, 10))).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
    ]);
    const quarterly = utc({ every: 'month', interval: 3, monthDay: 15, start: '2026-01-20' });
    expect(nextRuns(quarterly, after, 3).map((t) => t.slice(0, 10))).toEqual([
      '2026-04-15',
      '2026-07-15',
      '2026-10-15',
    ]);
  });

  it('runs yearly on the chosen month and day, or on the start date', () => {
    const after = '2026-01-01T00:00:00.000Z';
    const feb = utc({ every: 'year', month: 2, monthDay: 'last', start: '2026-01-01' });
    expect(nextRuns(feb, after, 3).map((t) => t.slice(0, 10))).toEqual([
      '2026-02-28',
      '2027-02-28',
      '2028-02-29',
    ]);
    const everyOther = utc({ every: 'year', interval: 2 });
    expect(nextRuns(everyOther, after, 2).map((t) => t.slice(0, 10))).toEqual([
      '2026-10-26',
      '2028-10-26',
    ]);
  });

  it('gives no more runs than the times left', () => {
    const after = '2026-10-26T00:00:00.000Z';
    expect(nextRuns(schedule({ timesLeft: 2 }), after, 5)).toEqual([
      '2026-10-26T15:00:00.000Z',
      '2026-10-27T15:00:00.000Z',
    ]);
    expect(nextRuns(schedule({ timesLeft: null }), after, 3)).toHaveLength(3);
    expect(nextRuns(schedule({ timesLeft: 0 }), after, 3)).toEqual([]);
  });

  it('gives nothing for an invalid schedule, a bad moment or a count of 0', () => {
    expect(nextRuns(schedule({ time: '09:10' }), '2026-10-01T00:00:00.000Z', 3)).toEqual([]);
    expect(nextRuns(schedule({}), 'yesterday', 3)).toEqual([]);
    expect(nextRuns(schedule({}), '2026-10-01T00:00:00.000Z', 0)).toEqual([]);
  });
});

describe('dueRuns', () => {
  const daily = schedule({ start: '2026-03-01' });

  it('runs the run that just came, and says when the next one is', () => {
    const due = dueRuns(daily, '2026-10-25T15:00:00.000Z', new Date('2026-10-26T15:05:00.000Z'));
    expect(due).toEqual({
      run: '2026-10-26T15:00:00.000Z',
      skipped: false,
      next: '2026-10-27T15:00:00.000Z',
    });
  });

  it('waits when nothing is due yet', () => {
    const due = dueRuns(daily, '2026-10-25T15:00:00.000Z', new Date('2026-10-26T14:00:00.000Z'));
    expect(due).toEqual({ run: null, skipped: false, next: '2026-10-26T15:00:00.000Z' });
  });

  it('makes a run missed by less than 24 hours once, and skips older ones', () => {
    const now = new Date('2026-10-26T21:00:00.000Z');
    expect(dueRuns(daily, '2026-10-24T15:00:00.000Z', now)).toEqual({
      run: '2026-10-26T15:00:00.000Z',
      skipped: true,
      next: '2026-10-27T15:00:00.000Z',
    });
    const weekly = schedule({ every: 'week', weekDays: [1] });
    expect(
      dueRuns(weekly, '2026-10-19T15:00:00.000Z', new Date('2026-10-27T18:00:00.000Z')),
    ).toEqual({ run: null, skipped: true, next: '2026-11-02T16:00:00.000Z' });
  });

  it('skips a run missed by exactly 24 hours', () => {
    const due = dueRuns(daily, '2026-10-25T15:00:00.000Z', new Date('2026-10-27T15:00:00.000Z'));
    expect(due.run).toBe('2026-10-27T15:00:00.000Z');
    expect(due.skipped).toBe(true);
  });

  it('makes only the latest of two runs due within 24 hours (a 23-hour day)', () => {
    const due = dueRuns(daily, '2026-03-06T16:00:00.000Z', new Date('2026-03-08T15:30:00.000Z'));
    expect(due).toEqual({
      run: '2026-03-08T15:00:00.000Z',
      skipped: true,
      next: '2026-03-09T15:00:00.000Z',
    });
  });

  it('with no run yet, makes the run of the last 24 hours', () => {
    const due = dueRuns(daily, null, new Date('2026-10-27T15:30:00.000Z'));
    expect(due.run).toBe('2026-10-27T15:00:00.000Z');
    expect(due.skipped).toBe(false);
  });

  it('never runs a paused schedule, or one with no times left', () => {
    const now = new Date('2026-10-26T15:05:00.000Z');
    const nothing = { run: null, skipped: false, next: null };
    expect(dueRuns(schedule({ paused: true }), null, now)).toEqual(nothing);
    expect(dueRuns({ ...daily, timesLeft: 0 }, null, now)).toEqual(nothing);
  });

  it('has no next run after the last time, or after the end date', () => {
    const now = new Date('2026-10-26T15:05:00.000Z');
    expect(dueRuns({ ...daily, timesLeft: 1 }, null, now)).toEqual({
      run: '2026-10-26T15:00:00.000Z',
      skipped: false,
      next: null,
    });
    expect(dueRuns({ ...daily, timesLeft: 2 }, null, now).next).toBe('2026-10-27T15:00:00.000Z');
    expect(dueRuns(schedule({ end: '2026-10-26' }), null, now).next).toBeNull();
  });
});

describe('ending after a number of times', () => {
  it('counts down one time per row made', () => {
    const s = schedule({ timesLeft: 2 });
    expect(afterRun(s)).toEqual({ ...s, timesLeft: 1 });
    expect(afterRun(afterRun(s)).timesLeft).toBe(0);
    expect(afterRun(schedule({ timesLeft: 0 })).timesLeft).toBe(0);
    const endless = schedule();
    expect(afterRun(endless)).toBe(endless);
  });

  it('still makes the latest missed run when one time is left', () => {
    const last = schedule({ start: '2026-03-01', timesLeft: 1 });
    const due = dueRuns(last, '2026-03-06T16:00:00.000Z', new Date('2026-03-08T15:30:00.000Z'));
    expect(due).toEqual({ run: '2026-03-08T15:00:00.000Z', skipped: true, next: null });
  });

  it('TB-07: weekdays at 9:00 AM Denver across the clock change, stopping after 3 times', () => {
    let s = schedule({ every: 'weekday', start: '2026-10-29', timesLeft: 3 });
    let last: string | null = null;
    const made: string[] = [];
    const end = Date.parse('2026-11-06T00:00:00.000Z');
    for (let t = Date.parse('2026-10-29T00:00:00.000Z'); t < end; t += 15 * 60_000) {
      const due = dueRuns(s, last, new Date(t));
      expect(due.skipped).toBe(false);
      if (due.run === null) continue;
      made.push(due.run);
      last = due.run;
      s = afterRun(s);
    }
    expect(made).toEqual([
      '2026-10-29T15:00:00.000Z',
      '2026-10-30T15:00:00.000Z',
      '2026-11-02T16:00:00.000Z',
    ]);
    expect(s.timesLeft).toBe(0);
    expect(dueRuns(s, last, new Date('2026-11-09T16:00:00.000Z'))).toEqual({
      run: null,
      skipped: false,
      next: null,
    });
    // ...and it pauses, with a notice, when its setter loses access.
    expect(shouldPause({ active: true, access: 'view' })).toBe(true);
  });
});

describe('names and labels', () => {
  it('names new rows with the template name and the run date in the schedule time zone', () => {
    expect(repeatTitle('Weekly huddle', '2026-10-26T15:00:00.000Z', 'America/Denver')).toBe(
      'Weekly huddle – Oct 26',
    );
    expect(repeatTitle('Weekly huddle', '2026-10-27T02:00:00.000Z', 'America/Denver')).toBe(
      'Weekly huddle – Oct 26',
    );
    expect(repeatTitle('Weekly huddle', '2026-10-27T02:00:00.000Z', 'UTC')).toBe(
      'Weekly huddle – Oct 27',
    );
  });

  it('uses Untitled for an empty name and keeps long names within 2,000 characters', () => {
    expect(repeatTitle('  ', '2026-10-26T15:00:00.000Z', 'UTC')).toBe('Untitled – Oct 26');
    const long = repeatTitle('x'.repeat(2_500), '2026-10-26T15:00:00.000Z', 'UTC');
    expect(long).toHaveLength(2_000);
    expect(long.endsWith(' – Oct 26')).toBe(true);
  });

  it('labels repeating rows with the person they run as', () => {
    expect(REPEAT_MESSAGES.createdBy('Sam Ortiz')).toBe('Created by Sam Ortiz (repeating)');
  });

  it('has a pause notice that names no page', () => {
    expect(REPEAT_MESSAGES.paused).toBe(
      'A repeating template was paused because the person who set it up no longer has access.',
    );
  });
});

describe('shouldPause', () => {
  it('pauses when the person left or can no longer add rows', () => {
    expect(shouldPause({ active: false, access: 'full' })).toBe(true);
    expect(shouldPause({ active: true, access: 'view' })).toBe(true);
    expect(shouldPause({ active: true, access: null })).toBe(true);
    expect(shouldPause({ active: true, access: 'rows_only' })).toBe(true);
  });

  it('keeps going while they can add rows', () => {
    expect(shouldPause({ active: true, access: 'edit_content' })).toBe(false);
    expect(shouldPause({ active: true, access: 'rows_only', canAddRows: true })).toBe(false);
  });
});

describe('validateSchedule', () => {
  const M = REPEAT_MESSAGES;

  it('accepts a good schedule', () => {
    expect(validateSchedule(schedule({ every: 'week', weekDays: [1, 3], interval: 2 }))).toBeNull();
    expect(validateSchedule(schedule({ every: 'month', monthDay: 'last' }))).toBeNull();
    expect(validateSchedule(schedule({ every: 'year', month: 2, monthDay: 28 }))).toBeNull();
    expect(validateSchedule(schedule({ timesLeft: 1 }))).toBeNull();
    expect(validateSchedule(schedule({ timesLeft: 0 }))).toBeNull(); // ended, saved as it is
    expect(validateSchedule(schedule({ timesLeft: LIMITS.repeatTimes, end: null }))).toBeNull();
    expect(REPEAT_MESSAGES.times).toBe('Enter a number from 1 to 1,000.');
    expect(LIMITS.repeatTimes).toBe(1_000);
  });

  it.each([
    [{ every: 'hour' as RepeatSchedule['every'] }, M.every],
    [{ interval: 0 }, M.interval],
    [{ interval: 366 }, M.interval],
    [{ interval: 1.5 }, M.interval],
    [{ every: 'week' as const }, M.noDays],
    [{ every: 'week' as const, weekDays: [] }, M.noDays],
    [{ every: 'week' as const, weekDays: [1, 1] }, M.days],
    [{ every: 'week' as const, weekDays: [7 as 0] }, M.days],
    [{ monthDay: 29 }, M.monthDay],
    [{ monthDay: 0 }, M.monthDay],
    [{ month: 13 }, M.month],
    [{ time: '09:10' }, M.time],
    [{ time: '24:00' }, M.time],
    [{ timeZone: 'Mars/Olympus' }, M.timeZone],
    [{ start: '2026-02-30' }, M.date],
    [{ end: '2026-10-25' }, M.endBeforeStart],
    [{ timesLeft: -1 }, M.times],
    [{ timesLeft: 1_001 }, M.times],
    [{ timesLeft: 2.5 }, M.times],
    [{ timesLeft: 5, end: '2026-12-31' }, M.oneEnd],
  ] satisfies [Partial<RepeatSchedule>, string][])('refuses %j', (over, message) => {
    expect(validateSchedule(schedule(over))).toBe(message);
  });

  it('allows up to 10 repeating templates per database', () => {
    const template = (id: string, repeats: boolean): RowTemplate => ({
      id,
      name: `Template ${id}`,
      icon: null,
      values: {},
      repeat: repeats ? schedule() : null,
    });
    const ten = Array.from({ length: 10 }, (_, i) => template(`t${i}`, true));
    const templates = [...ten, template('plain', false)];
    expect(validateSchedule(schedule(), { templates, templateId: 'plain' })).toBe(M.tooMany);
    expect(validateSchedule(schedule(), { templates, templateId: 't3' })).toBeNull();
    expect(validateSchedule(schedule(), { templates: ten.slice(1), templateId: 'new' })).toBeNull();
  });
});
