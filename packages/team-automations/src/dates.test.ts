import { DEFAULT_TIME_PREFS } from '@carehub/team-time';
import { describe, expect, it } from 'vitest';
import type { DateArrivesTrigger, DateOffset, RowDate } from './dates';
import {
  arrivalsBetween,
  arrivalTime,
  dateArrivesProblems,
  datesToCheck,
  describeDateArrives,
} from './dates';
import { automationInput, automationProblems } from './validate';

const denver = 'America/Denver';
const at = (iso: string) => new Date(iso);
const trigger = (
  offset: DateOffset | null,
  time = '09:00',
  timeZone = denver,
): DateArrivesTrigger => ({
  kind: 'dateArrives',
  databaseId: 'qa-reviews',
  propertyId: 'review-date',
  offset,
  time,
  timeZone,
});
const dayBefore = trigger({ amount: 1, unit: 'days', direction: 'before' });
const day = (start: string): RowDate => ({ allDay: true, start });
const timed = (start: string): RowDate => ({ allDay: false, start });
const arrival = (t: DateArrivesTrigger, date: RowDate) => arrivalTime(t, date)?.toISOString();

describe('arrivalTime', () => {
  it('fires 1 day before a date without a time at 9:00 AM in the zone (AU-15)', () => {
    // Denver is on summer time (UTC-6) until Sunday Nov 1, 2026.
    expect(arrival(dayBefore, day('2026-10-30'))).toBe('2026-10-29T15:00:00.000Z');
    expect(arrival(trigger(null), day('2026-10-30'))).toBe('2026-10-30T15:00:00.000Z');
    expect(arrival(trigger(null, '07:30'), day('2026-10-30'))).toBe('2026-10-30T13:30:00.000Z');
  });

  it('keeps 9:00 AM across the clock change', () => {
    // Nov 2 and Nov 1 are on standard time (UTC-7); Oct 31 is still summer time.
    expect(arrival(dayBefore, day('2026-11-02'))).toBe('2026-11-01T16:00:00.000Z');
    const twoDays = trigger({ amount: 2, unit: 'days', direction: 'before' });
    expect(arrival(twoDays, day('2026-11-02'))).toBe('2026-10-31T15:00:00.000Z');
  });

  it('moves days on the wall clock for dates with a time, keeping their seconds', () => {
    const twoDays = trigger({ amount: 2, unit: 'days', direction: 'before' });
    // 2:30 PM on Nov 2 (UTC-7) → 2:30 PM on Oct 31 (UTC-6): 49 hours earlier.
    expect(arrival(twoDays, timed('2026-11-02T21:30:00.000Z'))).toBe('2026-10-31T20:30:00.000Z');
    const dayAfter = trigger({ amount: 1, unit: 'days', direction: 'after' });
    expect(arrival(dayAfter, timed('2026-10-20T15:00:30.000Z'))).toBe('2026-10-21T15:00:30.000Z');
  });

  it('fires at the time itself, or exact minutes and hours away from it', () => {
    expect(arrival(trigger(null), timed('2026-10-30T15:00:00.000Z'))).toBe(
      '2026-10-30T15:00:00.000Z',
    );
    const twoHours = trigger({ amount: 2, unit: 'hours', direction: 'before' });
    expect(arrival(twoHours, timed('2026-10-30T15:00:00.000Z'))).toBe('2026-10-30T13:00:00.000Z');
    // A date without a time counts from 9:00 AM.
    expect(arrival(twoHours, day('2026-10-30'))).toBe('2026-10-30T13:00:00.000Z');
    const halfHour = trigger({ amount: 30, unit: 'minutes', direction: 'after' });
    expect(arrival(halfHour, timed('2026-10-30T15:00:00.000Z'))).toBe('2026-10-30T15:30:00.000Z');
  });

  it('moves a time that does not exist to the next valid one, and takes the first of two', () => {
    // Clocks go forward at 2:00 AM on Mar 8, 2026 and back at 2:00 AM on Nov 1.
    expect(arrival(trigger(null, '02:30'), day('2026-03-08'))).toBe('2026-03-08T09:00:00.000Z');
    expect(arrival(trigger(null, '01:30'), day('2026-11-01'))).toBe('2026-11-01T07:30:00.000Z');
  });

  it('returns null for dates, times or zones that do not read', () => {
    expect(arrivalTime(dayBefore, day('2026-02-30'))).toBeNull();
    expect(arrivalTime(dayBefore, timed('2026-10-30'))).toBeNull();
    expect(arrivalTime(dayBefore, timed('soon'))).toBeNull();
    expect(arrivalTime(trigger(null, '9am'), day('2026-10-30'))).toBeNull();
    expect(arrivalTime(trigger(null, '09:00', 'Mars/Base'), day('2026-10-30'))).toBeNull();
  });
});

describe('datesToCheck', () => {
  it('covers the dates whose arrival can fall in the window, with a day to spare', () => {
    // 1 day before: arrivals on Oct 29 come from dates on Oct 30.
    expect(datesToCheck(dayBefore, at('2026-10-29T14:59:00Z'), at('2026-10-29T15:00:00Z'))).toEqual(
      { from: '2026-10-29', to: '2026-11-01' },
    );
    const twoHoursAfter = trigger({ amount: 2, unit: 'hours', direction: 'after' });
    // 8:00 UTC minus 2 hours is midnight on Oct 30 in Denver.
    expect(
      datesToCheck(twoHoursAfter, at('2026-10-30T08:00:00Z'), at('2026-10-30T09:00:00Z')),
    ).toEqual({ from: '2026-10-29', to: '2026-11-01' });
  });
});

describe('arrivalsBetween', () => {
  it('keeps arrivals after `since` and up to `now`, soonest first', () => {
    const rows = [
      { rowId: 'later', ...day('2026-10-31') },
      { rowId: 'timed', ...timed('2026-10-30T14:00:00.000Z') },
      { rowId: 'at-since', ...timed('2026-10-30T13:00:00.000Z') },
      { rowId: 'day', ...day('2026-10-30') },
      { rowId: 'unreadable', ...day('someday') },
    ];
    const due = arrivalsBetween(
      dayBefore,
      rows,
      at('2026-10-29T13:00:00Z'),
      at('2026-10-29T15:00:00Z'),
    );
    expect(due.map(({ row, at: when }) => [row.rowId, when.toISOString()])).toEqual([
      ['timed', '2026-10-29T14:00:00.000Z'],
      ['day', '2026-10-29T15:00:00.000Z'],
    ]);
  });
});

describe('describeDateArrives', () => {
  it('reads the trigger in plain words', () => {
    const prefs = DEFAULT_TIME_PREFS;
    expect(describeDateArrives(trigger(null), 'Review date', prefs)).toBe(
      'When Review date arrives',
    );
    expect(describeDateArrives(dayBefore, 'Review date', prefs)).toBe(
      '1 day before Review date at 9:00 AM',
    );
    const hours = trigger({ amount: 2, unit: 'hours', direction: 'after' });
    expect(describeDateArrives(hours, 'Review date', prefs)).toBe('2 hours after Review date');
    const minute = trigger({ amount: 1, unit: 'minutes', direction: 'before' });
    expect(describeDateArrives(minute, undefined, prefs)).toBe('1 minute before a date');
    expect(describeDateArrives(dayBefore, 'Due', { use24h: true })).toBe(
      '1 day before Due at 09:00',
    );
  });
});

describe('dateArrivesProblems', () => {
  it('names the field of each problem', () => {
    expect(dateArrivesProblems(dayBefore)).toEqual([]);
    expect(
      dateArrivesProblems({
        ...trigger({ amount: 0, unit: 'days', direction: 'before' }, '9am', 'Mars/Base'),
        propertyId: ' ',
      }),
    ).toEqual([
      { field: 'propertyId', message: 'Pick a date property.' },
      { field: 'offset', message: 'Pick 1 to 365 days.' },
      { field: 'time', message: 'Pick a time, like 9:00 AM.' },
      { field: 'timeZone', message: 'Pick a time zone.' },
    ]);
    const tooMany = trigger({ amount: 1_441, unit: 'minutes', direction: 'after' });
    expect(dateArrivesProblems(tooMany)).toEqual([
      { field: 'offset', message: 'Pick 1 to 1,440 minutes.' },
    ]);
    const half = trigger({ amount: 1.5, unit: 'hours', direction: 'after' });
    expect(dateArrivesProblems(half)).toEqual([
      { field: 'offset', message: 'Pick 1 to 720 hours.' },
    ]);
  });

  it('is part of the save checks', () => {
    const input = automationInput.parse({
      name: 'Review reminder',
      trigger: { ...dayBefore, propertyId: '' },
      actions: [
        {
          kind: 'sendMessage',
          recipients: [{ kind: 'personProperty', propertyId: 'reviewer' }],
          text: 'Your review is tomorrow.',
          pageIds: [],
        },
      ],
    });
    expect(input.trigger.kind).toBe('dateArrives');
    expect(automationProblems(input, at('2026-10-28T12:00:00Z'))).toEqual([
      { path: ['trigger', 'propertyId'], message: 'Pick a date property.' },
    ]);
    expect(
      automationInput.safeParse({ ...input, trigger: { ...dayBefore, offset: 1 } }).success,
    ).toBe(false);
  });
});
