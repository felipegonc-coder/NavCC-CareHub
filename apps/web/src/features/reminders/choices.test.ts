import { describe, expect, it } from 'vitest';
import {
  customAllDay,
  customAt,
  customBefore,
  eventDueAt,
  newReminder,
  remindMeChoices,
  type RemindMeTarget,
} from './choices';

const denver = { timeZone: 'America/Denver', use24h: false };
// Tuesday, Oct 27, 2026, 9:00 AM in Denver (UTC-6 until the clocks go back on Sunday, Nov 1).
const now = new Date('2026-10-27T15:00:00.000Z');

const PAGE_ID = '5d1f0a52-8f1e-4c4b-9a52-0d6a3c1e7b10';
const EVENT_ID = '9b2c6e41-3d7a-4f0e-8c15-6a4e2f9d1c37';
const page: RemindMeTarget = { type: 'page', pageId: PAGE_ID, title: 'Shift handover' };
const event = (start: string, allDay = false) => ({
  type: 'event' as const,
  eventId: EVENT_ID,
  title: 'Team standup',
  allDay,
  start,
});
// 10:30 AM today in Denver.
const standup = event('2026-10-27T16:30:00.000Z');

const shown = (target: RemindMeTarget, prefs = denver) =>
  remindMeChoices(target, prefs, now).map(({ label, dueAt }) => [label, dueAt.toISOString()]);

describe('remindMeChoices', () => {
  it('offers the page presets on the person’s clock', () => {
    expect(shown(page)).toEqual([
      ['In 1 hour', '2026-10-27T16:00:00.000Z'],
      ['Later today at 5:00 PM', '2026-10-27T23:00:00.000Z'],
      ['Tomorrow at 9:00 AM', '2026-10-28T15:00:00.000Z'],
      ['Next Monday at 9:00 AM', '2026-11-02T16:00:00.000Z'],
    ]);
    expect(shown(page, { ...denver, use24h: true })[1]?.[0]).toBe('Later today at 17:00');
    expect(remindMeChoices(page, denver, now)[0]?.time).toEqual({
      at: '2026-10-27T16:00:00.000Z',
    });
  });

  it('uses the time zone the person has, for HR-13', () => {
    const newYork = { timeZone: 'America/New_York', use24h: false };
    // 11:00 AM in New York.
    expect(shown(page, newYork)[2]).toEqual(['Tomorrow at 9:00 AM', '2026-10-28T13:00:00.000Z']);
  });

  it('offers the times before a timed event that are still to come', () => {
    expect(shown(standup)).toEqual([
      ['At the start', '2026-10-27T16:30:00.000Z'],
      ['5 minutes before', '2026-10-27T16:25:00.000Z'],
      ['10 minutes before', '2026-10-27T16:20:00.000Z'],
      ['30 minutes before', '2026-10-27T16:00:00.000Z'],
      ['1 hour before', '2026-10-27T15:30:00.000Z'],
    ]);
    expect(remindMeChoices(standup, denver, now)[2]?.time).toEqual({ minutesBefore: 10 });
    expect(shown(event('2026-10-29T16:30:00.000Z')).at(-1)?.[0]).toBe('1 day before');
  });

  it('counts an all-day event’s choices from its day on the wall clock', () => {
    // Monday, Nov 2: on the day and the day before are both at 9:00 AM, after the clocks go back.
    expect(shown(event('2026-11-02', true))).toEqual([
      ['On the day at 9:00 AM', '2026-11-02T16:00:00.000Z'],
      ['The day before at 9:00 AM', '2026-11-01T16:00:00.000Z'],
    ]);
    // Today at 9:00 AM is now, so it's gone; so is yesterday.
    expect(shown(event('2026-10-27', true))).toEqual([]);
  });
});

describe('custom times', () => {
  it('takes a page date and time on the person’s clock, in the future', () => {
    expect(customAt('2026-10-28', '14:15', denver, now)).toEqual({
      time: { at: '2026-10-28T20:15:00.000Z' },
      dueAt: new Date('2026-10-28T20:15:00.000Z'),
    });
    expect(customAt('', '14:15', denver, now)).toEqual({ problem: 'Enter a date and a time.' });
    expect(customAt('2026-10-27', '08:59', denver, now)).toEqual({
      problem: 'That time has already passed.',
    });
  });

  it('takes a whole number of minutes, hours or days before a timed event', () => {
    const later = event('2026-12-01T17:30:00.000Z');
    expect(customBefore(later, '15', 'minutes', denver, now)).toMatchObject({
      time: { minutesBefore: 15 },
    });
    expect(customBefore(later, '2', 'hours', denver, now)).toMatchObject({
      time: { minutesBefore: 120 },
    });
    expect(customBefore(later, '28', 'days', denver, now)).toMatchObject({
      time: { minutesBefore: 40_320 },
    });
    expect(customBefore(later, '29', 'days', denver, now)).toEqual({
      problem: 'Pick a time up to 28 days before.',
    });
    for (const amount of ['', '1.5', '-5']) {
      expect(customBefore(later, amount, 'minutes', denver, now)).toEqual({
        problem: 'Enter a whole number.',
      });
    }
    expect(customBefore(standup, '2', 'hours', denver, now)).toEqual({
      problem: 'That time has already passed.',
    });
  });

  it('takes days before an all-day event and a time', () => {
    const day = event('2026-11-02', true);
    expect(customAllDay(day, '2', '08:30', denver, now)).toEqual({
      time: { minutesBefore: 2370 },
      dueAt: new Date('2026-10-31T14:30:00.000Z'),
    });
    expect(customAllDay(day, '0', '23:59', denver, now)).toMatchObject({
      time: { minutesBefore: -1439 },
    });
    expect(customAllDay(day, '29', '09:00', denver, now)).toEqual({
      problem: 'Pick 0 to 28 days before.',
    });
    expect(customAllDay(day, '1', '', denver, now)).toEqual({ problem: 'Enter a time.' });
    expect(customAllDay(day, '7', '09:00', denver, now)).toEqual({
      problem: 'That time has already passed.',
    });
  });
});

describe('newReminder', () => {
  it('sends a page and its time, with the note trimmed', () => {
    expect(newReminder(page, { at: '2026-10-27T16:00:00.000Z' }, '  Check the queue ')).toEqual({
      target: { type: 'page', pageId: PAGE_ID },
      at: '2026-10-27T16:00:00.000Z',
      note: 'Check the queue',
    });
  });

  it('sends an event’s occurrence when it has one, and no empty note', () => {
    const occurrence = { ...standup, occurrenceStart: '2026-10-27T10:30' };
    expect(newReminder(occurrence, { minutesBefore: 10 }, ' ')).toEqual({
      target: { type: 'event', eventId: EVENT_ID, occurrenceStart: '2026-10-27T10:30' },
      minutesBefore: 10,
    });
    expect(newReminder(standup, { minutesBefore: 0 }, '')).toEqual({
      target: { type: 'event', eventId: EVENT_ID },
      minutesBefore: 0,
    });
  });
});

describe('eventDueAt', () => {
  it('counts back from a timed start, or from 00:00 on an all-day event’s day', () => {
    expect(eventDueAt(standup, 10, 'America/Denver').toISOString()).toBe(
      '2026-10-27T16:20:00.000Z',
    );
    expect(eventDueAt(event('2026-10-28', true), 900, 'Asia/Kolkata').toISOString()).toBe(
      '2026-10-27T03:30:00.000Z',
    );
  });
});
