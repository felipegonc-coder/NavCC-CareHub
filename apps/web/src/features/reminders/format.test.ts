import { describe, expect, it } from 'vitest';
import {
  allDayLabel,
  beforeLabel,
  formatWhen,
  fromInputs,
  minutesOf,
  reminderTitle,
  sentence,
  splitBefore,
  toInputs,
} from './format';

const denver = { timeZone: 'America/Denver', use24h: false };
// Tuesday, Oct 27, 2026, 9:00 AM in Denver (UTC-6 until Nov 1).
const now = new Date('2026-10-27T15:00:00.000Z');

describe('formatWhen', () => {
  it('says today, tomorrow and yesterday, in the person’s time zone', () => {
    expect(formatWhen('2026-10-27T21:30:00.000Z', denver, now)).toBe('today at 3:30 PM');
    expect(formatWhen('2026-10-28T15:00:00.000Z', denver, now)).toBe('tomorrow at 9:00 AM');
    expect(formatWhen('2026-10-26T23:00:00.000Z', denver, now)).toBe('yesterday at 5:00 PM');
    // 3:00 AM on Oct 28 in Kolkata, where it's already 8:30 PM on Oct 27.
    const kolkata = { timeZone: 'Asia/Kolkata', use24h: false };
    expect(formatWhen('2026-10-27T21:30:00.000Z', kolkata, now)).toBe('tomorrow at 3:00 AM');
  });

  it('gives other days with the weekday, and the year when it is not this one', () => {
    expect(formatWhen('2026-10-29T15:00:00.000Z', denver, now)).toBe('Thu, Oct 29 at 9:00 AM');
    expect(formatWhen('2026-10-20T15:00:00.000Z', denver, now)).toBe('Tue, Oct 20 at 9:00 AM');
    // Denver is UTC-7 in January.
    expect(formatWhen('2027-01-05T16:00:00.000Z', denver, now)).toBe('Tue, Jan 5, 2027 at 9:00 AM');
  });

  it('uses the 24-hour setting', () => {
    expect(formatWhen('2026-10-27T21:30:00.000Z', { ...denver, use24h: true }, now)).toBe(
      'today at 15:30',
    );
  });

  it('starts a sentence with a capital', () => {
    expect(sentence('today at 3:30 PM')).toBe('Today at 3:30 PM');
    expect(sentence('Thu, Oct 29 at 9:00 AM')).toBe('Thu, Oct 29 at 9:00 AM');
  });
});

describe('time before an event', () => {
  it('splits minutes into the largest unit that fits evenly', () => {
    expect(splitBefore(0)).toEqual({ amount: 0, unit: 'minutes' });
    expect(splitBefore(10)).toEqual({ amount: 10, unit: 'minutes' });
    expect(splitBefore(90)).toEqual({ amount: 90, unit: 'minutes' });
    expect(splitBefore(60)).toEqual({ amount: 1, unit: 'hours' });
    expect(splitBefore(1500)).toEqual({ amount: 25, unit: 'hours' });
    expect(splitBefore(2880)).toEqual({ amount: 2, unit: 'days' });
    expect(minutesOf(2, 'days')).toBe(2880);
    expect(minutesOf(25, 'hours')).toBe(1500);
    expect(minutesOf(90, 'minutes')).toBe(90);
  });

  it('labels it in words', () => {
    expect(beforeLabel(0, denver)).toBe('At the start');
    expect(beforeLabel(1, denver)).toBe('1 minute before');
    expect(beforeLabel(10, denver)).toBe('10 minutes before');
    expect(beforeLabel(60, denver)).toBe('1 hour before');
    expect(beforeLabel(120, denver)).toBe('2 hours before');
    expect(beforeLabel(1440, denver)).toBe('1 day before');
    expect(beforeLabel(40_320, denver)).toBe('28 days before');
  });

  it('names a time on the day of an all-day event with negative minutes', () => {
    expect(beforeLabel(-540, denver)).toBe('On the day at 9:00 AM');
    expect(beforeLabel(-540, { ...denver, use24h: true })).toBe('On the day at 09:00');
  });

  it('counts all-day reminders from 00:00 on the day', () => {
    expect(allDayLabel(-540, denver)).toBe('On the day at 9:00 AM');
    expect(allDayLabel(-1439, denver)).toBe('On the day at 11:59 PM');
    expect(allDayLabel(0, denver)).toBe('On the day at 12:00 AM');
    expect(allDayLabel(900, denver)).toBe('The day before at 9:00 AM');
    expect(allDayLabel(1440, { ...denver, use24h: true })).toBe('The day before at 00:00');
    expect(allDayLabel(2370, denver)).toBe('2 days before at 8:30 AM');
  });
});

describe('date and time inputs', () => {
  it('turns an instant into the inputs’ values and back', () => {
    expect(toInputs('2026-10-27T21:30:00.000Z', 'America/Denver')).toEqual({
      date: '2026-10-27',
      time: '15:30',
    });
    expect(fromInputs('2026-10-27', '15:30', 'America/Denver')).toBe('2026-10-27T21:30:00.000Z');
    expect(fromInputs('2026-10-28', '09:00', 'Asia/Kolkata')).toBe('2026-10-28T03:30:00.000Z');
  });

  it('takes the earlier time when the clocks go back, and null when an input is empty', () => {
    // 1:30 AM happens twice in Denver on Nov 1, 2026; the first is still UTC-6.
    expect(fromInputs('2026-11-01', '01:30', 'America/Denver')).toBe('2026-11-01T07:30:00.000Z');
    expect(fromInputs('', '15:30', 'America/Denver')).toBeNull();
    expect(fromInputs('2026-10-27', '', 'America/Denver')).toBeNull();
  });
});

describe('reminderTitle', () => {
  it('names what the person can no longer open', () => {
    const page = { type: 'page' as const, pageId: '5d1f0a52-8f1e-4c4b-9a52-0d6a3c1e7b10' };
    const event = { type: 'event' as const, eventId: '9b2c6e41-3d7a-4f0e-8c15-6a4e2f9d1c37' };
    expect(reminderTitle({ title: 'Shift handover', target: page })).toBe('Shift handover');
    expect(reminderTitle({ title: null, target: page })).toBe("A page you can't open");
    expect(reminderTitle({ title: null, target: event })).toBe("An event you can't open");
  });
});
