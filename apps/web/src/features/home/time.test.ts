import { describe, expect, it } from 'vitest';
import { chatTime, isStillOn, reminderDue, upcomingDay, upcomingTime } from './time';

// 12:00 noon in Denver on Tue, Oct 27 2026 (UTC-6).
const NOW = new Date('2026-10-27T18:00:00.000Z');
const DENVER = 'America/Denver';
const prefs = { timeZone: DENVER, use24h: false };

const timed = (start: string, end: string) => ({ allDay: false, start, end });
const allDay = (start: string, end: string) => ({ allDay: true, start, end });

describe('isStillOn', () => {
  it('keeps timed items until they end', () => {
    expect(
      isStillOn(timed('2026-10-27T17:30:00.000Z', '2026-10-27T18:30:00.000Z'), NOW, DENVER),
    ).toBe(true);
    expect(
      isStillOn(timed('2026-10-27T17:00:00.000Z', '2026-10-27T18:00:00.000Z'), NOW, DENVER),
    ).toBe(false);
  });

  it('keeps all-day items until their last day is over where the person is', () => {
    expect(isStillOn(allDay('2026-10-27', '2026-10-28'), NOW, DENVER)).toBe(true);
    expect(isStillOn(allDay('2026-10-25', '2026-10-27'), NOW, DENVER)).toBe(false);
    // 1:00 AM on Oct 28 in Tokyo: Oct 27's all-day item is over there.
    expect(isStillOn(allDay('2026-10-27', '2026-10-28'), NOW, 'Asia/Tokyo')).toBe(false);
  });
});

describe('upcomingDay', () => {
  it('puts what started already or starts today under Today', () => {
    expect(
      upcomingDay(timed('2026-10-26T23:00:00.000Z', '2026-10-27T20:00:00.000Z'), NOW, DENVER),
    ).toBe('Today');
    // 11:30 PM in Denver is still today there, though it's Oct 28 in UTC.
    expect(
      upcomingDay(timed('2026-10-28T05:30:00.000Z', '2026-10-28T06:00:00.000Z'), NOW, DENVER),
    ).toBe('Today');
    expect(upcomingDay(allDay('2026-10-26', '2026-10-29'), NOW, DENVER)).toBe('Today');
  });

  it('puts the rest under Tomorrow', () => {
    expect(
      upcomingDay(timed('2026-10-28T15:00:00.000Z', '2026-10-28T16:00:00.000Z'), NOW, DENVER),
    ).toBe('Tomorrow');
    expect(upcomingDay(allDay('2026-10-28', '2026-10-29'), NOW, DENVER)).toBe('Tomorrow');
  });
});

describe('upcomingTime', () => {
  it('shows the start in the person’s time zone and clock', () => {
    const later = timed('2026-10-27T20:30:00.000Z', '2026-10-27T21:00:00.000Z');
    expect(upcomingTime(later, NOW, prefs)).toBe('2:30 PM');
    expect(upcomingTime(later, NOW, { ...prefs, use24h: true })).toBe('14:30');
    expect(upcomingTime(later, NOW, { timeZone: 'America/New_York', use24h: false })).toBe(
      '4:30 PM',
    );
  });

  it('says Now once it has started, and All day for all-day items', () => {
    expect(
      upcomingTime(timed('2026-10-27T18:00:00.000Z', '2026-10-27T19:00:00.000Z'), NOW, prefs),
    ).toBe('Now');
    expect(upcomingTime(allDay('2026-10-27', '2026-10-28'), NOW, prefs)).toBe('All day');
  });
});

describe('reminderDue', () => {
  it('says Today, Tomorrow or Yesterday with the time where the person is', () => {
    expect(reminderDue('2026-10-27T21:00:00.000Z', NOW, prefs)).toBe('Today, 3:00 PM');
    expect(reminderDue('2026-10-28T15:00:00.000Z', NOW, prefs)).toBe('Tomorrow, 9:00 AM');
    expect(reminderDue('2026-10-26T15:00:00.000Z', NOW, prefs)).toBe('Yesterday, 9:00 AM');
    expect(reminderDue('2026-10-28T15:00:00.000Z', NOW, { ...prefs, use24h: true })).toBe(
      'Tomorrow, 09:00',
    );
    // 11:00 PM on Oct 27 in Denver is already Oct 28 in New York.
    const late = '2026-10-28T05:00:00.000Z';
    expect(reminderDue(late, NOW, prefs)).toBe('Today, 11:00 PM');
    expect(reminderDue(late, NOW, { timeZone: 'America/New_York', use24h: false })).toBe(
      'Tomorrow, 1:00 AM',
    );
  });

  it('gives the weekday and date further out, and the year when it is another year', () => {
    expect(reminderDue('2026-11-02T16:00:00.000Z', NOW, prefs)).toBe('Mon, Nov 2, 9:00 AM');
    expect(reminderDue('2027-01-04T16:00:00.000Z', NOW, prefs)).toBe('Mon, Jan 4, 2027, 9:00 AM');
  });
});

describe('chatTime', () => {
  it('gives the time today, then Yesterday, the weekday within a week, then the date', () => {
    expect(chatTime('2026-10-27T15:05:00.000Z', NOW, prefs)).toBe('9:05 AM');
    expect(chatTime('2026-10-27T15:05:00.000Z', NOW, { ...prefs, use24h: true })).toBe('09:05');
    expect(chatTime('2026-10-27T05:00:00.000Z', NOW, prefs)).toBe('Yesterday');
    expect(chatTime('2026-10-21T18:00:00.000Z', NOW, prefs)).toBe('Wed');
    expect(chatTime('2026-10-20T18:00:00.000Z', NOW, prefs)).toBe('Oct 20');
    expect(chatTime('2025-12-24T18:00:00.000Z', NOW, prefs)).toBe('Dec 24, 2025');
  });
});
