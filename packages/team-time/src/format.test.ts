import { describe, expect, it } from 'vitest';
import {
  defaultZoneLabel,
  formatDate,
  formatDateRange,
  formatDayDivider,
  formatGreeting,
  formatHourLabel,
  formatPeriod,
  formatRelative,
  formatTime,
  formatTimeRange,
  secondZoneHourLabels,
  timeOfDay,
  weekdayName,
} from './index';

const DENVER = { timeZone: 'America/Denver' };
const H12 = { use24h: false };
const H24 = { use24h: true };
const at = (isoString: string) => new Date(isoString);

describe('formatDate', () => {
  it('reads like the specs', () => {
    expect(formatDate('2026-10-26')).toBe('Oct 26, 2026');
    expect(formatDate('2026-10-26', { weekday: 'long', year: false })).toBe('Monday, Oct 26');
    expect(formatDate('2026-10-26', { weekday: 'short' })).toBe('Mon, Oct 26, 2026');
    expect(formatDate('2026-10-27', { weekday: 'long', month: 'long', year: false })).toBe(
      'Tuesday, October 27',
    );
    expect(formatDate('2028-02-29')).toBe('Feb 29, 2028');
  });

  it('refuses impossible dates', () => {
    expect(() => formatDate('2026-02-29')).toThrow(RangeError);
    expect(() => formatDate('Oct 26')).toThrow(RangeError);
  });

  it('names weekdays', () => {
    expect(weekdayName(1)).toBe('Monday');
    expect(weekdayName(6, 'short')).toBe('Sat');
    expect(() => weekdayName(7 as 0)).toThrow(RangeError);
  });
});

describe('times', () => {
  it('uses a 12-hour clock with normal spaces', () => {
    expect(formatTime('15:30', H12)).toBe('3:30 PM');
    expect(formatTime('09:00', H12)).toBe('9:00 AM');
    expect(formatTime('00:05', H12)).toBe('12:05 AM');
    expect(formatTime('12:00', H12)).toBe('12:00 PM');
    expect(formatTime('2026-10-26T23:45', H12)).toBe('11:45 PM');
    expect(formatTime('15:30', H12)).not.toContain('\u202f');
  });

  it('uses a zero-padded 24-hour clock when set', () => {
    expect(formatTime('09:00', H24)).toBe('09:00');
    expect(formatTime('2026-10-26T15:30', H24)).toBe('15:30');
  });

  it('refuses times that are not HH:mm', () => {
    expect(() => formatTime('24:00', H12)).toThrow(RangeError);
    expect(() => formatTime('9:00', H12)).toThrow(RangeError);
  });

  it('formats ranges as in "10:00 to 11:00 AM"', () => {
    expect(formatTimeRange('10:00', '11:00', H12)).toBe('10:00 to 11:00 AM');
    expect(formatTimeRange('11:30', '12:30', H12)).toBe('11:30 AM to 12:30 PM');
    expect(formatTimeRange('2026-10-27T10:00', '2026-10-27T11:00', H24)).toBe('10:00 to 11:00');
  });

  it('labels calendar hour lines', () => {
    expect(formatHourLabel('09:00', H12)).toBe('9 AM');
    expect(formatHourLabel('00:00', H12)).toBe('12 AM');
    expect(formatHourLabel('14:30', H12)).toBe('2:30 PM');
    expect(formatHourLabel('09:00', H24)).toBe('09:00');
  });
});

describe('date ranges and calendar periods', () => {
  it('shortens ranges in the same month or year', () => {
    expect(formatDateRange('2026-10-25', '2026-10-31')).toBe('Oct 25 \u2013 31, 2026');
    expect(formatDateRange('2026-10-26', '2026-11-01')).toBe('Oct 26 \u2013 Nov 1, 2026');
    expect(formatDateRange('2026-12-27', '2027-01-02')).toBe('Dec 27, 2026 \u2013 Jan 2, 2027');
    expect(formatDateRange('2026-10-26', '2026-10-26')).toBe('Oct 26, 2026');
  });

  it('follows the week start for week views', () => {
    expect(formatPeriod('week', '2026-10-28', { weekStart: 0 })).toBe('Oct 25 \u2013 31, 2026');
    expect(formatPeriod('week', '2026-10-28', { weekStart: 1 })).toBe('Oct 26 \u2013 Nov 1, 2026');
    expect(formatPeriod('week', '2026-10-28', { weekStart: 6 })).toBe('Oct 24 \u2013 30, 2026');
    expect(formatPeriod('week', '2026-12-30', { weekStart: 0 })).toBe(
      'Dec 27, 2026 \u2013 Jan 2, 2027',
    );
  });

  it('labels day and month views', () => {
    expect(formatPeriod('day', '2026-10-26', { weekStart: 0 })).toBe('Monday, Oct 26, 2026');
    expect(formatPeriod('month', '2026-10-26', { weekStart: 1 })).toBe('October 2026');
  });
});

describe('formatDayDivider', () => {
  it('says Today and Yesterday, then the date', () => {
    expect(formatDayDivider('2026-10-28', '2026-10-28')).toBe('Today');
    expect(formatDayDivider('2026-10-27', '2026-10-28')).toBe('Yesterday');
    expect(formatDayDivider('2026-10-26', '2026-10-28')).toBe('Mon, Oct 26');
    expect(formatDayDivider('2025-12-26', '2026-01-02')).toBe('Fri, Dec 26, 2025');
  });
});

describe('formatRelative', () => {
  const now = at('2026-10-26T20:00:00Z'); // 2:00 PM in Denver
  const ago = (ms: number) => formatRelative(new Date(now.getTime() - ms), now, DENVER);
  const MIN = 60_000;

  it('counts minutes, hours and calendar days back', () => {
    expect(ago(20_000)).toBe('just now');
    expect(ago(5 * MIN)).toBe('5 min ago');
    expect(ago(59 * MIN)).toBe('59 min ago');
    expect(ago(60 * MIN)).toBe('1 hour ago');
    expect(ago(15 * 60 * MIN)).toBe('15 hours ago');
    expect(ago(24 * 60 * MIN)).toBe('yesterday');
    expect(ago(3 * 24 * 60 * MIN)).toBe('3 days ago');
    expect(ago(8 * 24 * 60 * MIN)).toBe('Oct 18');
    expect(formatRelative(at('2025-09-21T20:00:00Z'), now, DENVER)).toBe('Sep 21, 2025');
  });

  it('counts ahead too', () => {
    expect(ago(-30_000)).toBe('now');
    expect(ago(-5 * MIN)).toBe('in 5 min');
    expect(ago(-2 * 60 * MIN)).toBe('in 2 hours');
    expect(ago(-24 * 60 * MIN)).toBe('tomorrow');
    expect(ago(-3 * 24 * 60 * MIN)).toBe('in 3 days');
  });
});

describe('Home greeting', () => {
  it('splits the day at 5:00, 12:00 and 17:00', () => {
    expect(timeOfDay('04:59')).toBe('evening');
    expect(timeOfDay('05:00')).toBe('morning');
    expect(timeOfDay('11:59')).toBe('morning');
    expect(timeOfDay('12:00')).toBe('afternoon');
    expect(timeOfDay('16:59')).toBe('afternoon');
    expect(timeOfDay('2026-10-26T17:00')).toBe('evening');
  });

  it("greets by first name in the person's time zone", () => {
    const now = at('2026-10-26T20:00:00Z');
    expect(formatGreeting('Avery Lin', now, DENVER)).toBe(
      'Good afternoon, Avery \u00b7 Monday, October 26',
    );
    expect(formatGreeting('Riley Chen', now, { timeZone: 'Asia/Kolkata' })).toBe(
      'Good evening, Riley \u00b7 Tuesday, October 27',
    );
    expect(formatGreeting('', at('2026-10-26T15:00:00Z'), DENVER)).toBe(
      'Good morning \u00b7 Monday, October 26',
    );
  });
});

describe('second time zone (CA-19)', () => {
  const prefs = { timeZone: 'America/Denver', use24h: false };

  it('follows a week where only one of the zones changes its clocks', () => {
    // Lisbon goes back an hour early on Oct 25, 2026; Denver waits until Nov 1.
    const sat = secondZoneHourLabels('2026-10-24', 'Europe/Lisbon', prefs);
    expect(sat).toHaveLength(24);
    expect(sat[0]).toBe('7 AM');
    expect(sat[18]).toBe('1 AM');
    expect(sat[19]).toBe('1 AM');
    expect(secondZoneHourLabels('2026-10-26', 'Europe/Lisbon', prefs)[0]).toBe('6 AM');
    expect(secondZoneHourLabels('2026-11-02', 'Europe/Lisbon', prefs)[0]).toBe('7 AM');
  });

  it('shows half-hour zones and the 24-hour setting', () => {
    expect(secondZoneHourLabels('2026-10-26', 'Asia/Kolkata', prefs)[0]).toBe('11:30 AM');
    expect(secondZoneHourLabels('2026-10-26', 'Europe/Lisbon', { ...prefs, use24h: true })[9]).toBe(
      '15:00',
    );
  });

  it('makes a short label from the zone name', () => {
    expect(defaultZoneLabel('Europe/Lisbon')).toBe('Lisbon');
    expect(defaultZoneLabel('America/New_York')).toBe('New York');
    expect(defaultZoneLabel('America/Argentina/Buenos_Aires')).toBe('Buenos Aires');
    expect(defaultZoneLabel('UTC')).toBe('UTC');
  });
});
