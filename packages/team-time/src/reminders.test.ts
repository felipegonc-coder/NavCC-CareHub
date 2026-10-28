import { describe, expect, it } from 'vitest';
import {
  ALL_DAY_REMINDER_PRESETS,
  allDayMinutesBefore,
  allDayReminderTime,
  EVENT_REMINDER_PRESETS,
  pageReminderTimes,
} from './reminders';

const DENVER = 'America/Denver';
const times = (now: string, timeZone = DENVER) =>
  pageReminderTimes(new Date(now), timeZone).map(({ preset, at }) => [preset, at.toISOString()]);

describe('pageReminderTimes', () => {
  it('gives the four presets on a Tuesday morning, next Monday after the clocks go back', () => {
    // Tuesday, Oct 27, 2026, 9:00 AM in Denver (MDT). The clocks go back on Sunday, Nov 1.
    expect(times('2026-10-27T15:00:00.000Z')).toEqual([
      ['in-1-hour', '2026-10-27T16:00:00.000Z'],
      ['later-today', '2026-10-27T23:00:00.000Z'],
      ['tomorrow', '2026-10-28T15:00:00.000Z'],
      ['next-monday', '2026-11-02T16:00:00.000Z'],
    ]);
  });

  it('keeps "later today" up to 4:00 PM and leaves it out after', () => {
    expect(times('2026-10-27T22:00:30.000Z').map(([preset]) => preset)).toContain('later-today');
    expect(times('2026-10-27T22:01:00.000Z').map(([preset]) => preset)).toEqual([
      'in-1-hour',
      'tomorrow',
      'next-monday',
    ]);
  });

  it('goes a week on from a Monday, and to tomorrow from a Sunday', () => {
    // Monday, Oct 26 and Sunday, Oct 25, 2026, 10:00 AM in Denver.
    expect(times('2026-10-26T16:00:00.000Z').at(-1)).toEqual([
      'next-monday',
      '2026-11-02T16:00:00.000Z',
    ]);
    const sunday = times('2026-10-25T16:00:00.000Z');
    expect(sunday.at(-1)).toEqual(['next-monday', '2026-10-26T15:00:00.000Z']);
    expect(sunday.at(-2)).toEqual(['tomorrow', '2026-10-26T15:00:00.000Z']);
  });

  it('uses the given time zone', () => {
    // 8:30 PM in Kolkata (UTC+5:30), so no "later today".
    expect(times('2026-10-27T15:00:00.000Z', 'Asia/Kolkata')).toEqual([
      ['in-1-hour', '2026-10-27T16:00:00.000Z'],
      ['tomorrow', '2026-10-28T03:30:00.000Z'],
      ['next-monday', '2026-11-02T03:30:00.000Z'],
    ]);
  });
});

describe('event presets', () => {
  it('lists the timed and all-day choices in minutes before', () => {
    expect(EVENT_REMINDER_PRESETS).toEqual([0, 5, 10, 30, 60, 1440]);
    expect(ALL_DAY_REMINDER_PRESETS).toEqual([
      allDayMinutesBefore(0, '09:00'),
      allDayMinutesBefore(1, '09:00'),
    ]);
  });
});

describe('all-day reminder times', () => {
  const cases: [number, string, number][] = [
    [0, '09:00', -540],
    [1, '09:00', 900],
    [2, '08:30', 2370],
    [0, '00:00', 0],
    [1, '00:00', 1440],
    [0, '23:59', -1439],
    [28, '00:00', 40_320],
  ];

  it('turns days before and a time into minutes before 00:00 on the day, and back', () => {
    for (const [days, time, minutes] of cases) {
      expect(allDayMinutesBefore(days, time)).toBe(minutes);
      expect(allDayReminderTime(minutes)).toEqual({ days, time });
    }
  });

  it('refuses what is not a whole number of days or a time', () => {
    expect(() => allDayMinutesBefore(1.5, '09:00')).toThrow(RangeError);
    expect(() => allDayMinutesBefore(1, '9:00')).toThrow(RangeError);
  });
});
