import { describe, expect, it } from 'vitest';
import { isStillOn, upcomingDay, upcomingTime } from './time';

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
