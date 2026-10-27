import { describe, expect, it } from 'vitest';
import { dayDivider, dayOf, fullTime, listTime, messageTime } from './format';

const denver = { timeZone: 'America/Denver', use24h: false };
// Tuesday, Oct 27, 2026, 9:00 AM in Denver.
const now = new Date('2026-10-27T15:00:00Z');

describe('Messages times', () => {
  it('puts messages on the day of the person’s zone', () => {
    // 1:30 AM UTC on the 27th is still the 26th in Denver.
    expect(dayOf('2026-10-27T01:30:00Z', denver)).toBe('2026-10-26');
  });

  it('writes day dividers as the spec does', () => {
    expect(dayDivider('2026-10-27T14:00:00Z', now, denver)).toBe('Today');
    expect(dayDivider('2026-10-26T14:00:00Z', now, denver)).toBe('Yesterday');
    expect(dayDivider('2026-10-19T14:00:00Z', now, denver)).toBe('Mon, Oct 19');
    expect(dayDivider('2025-12-26T14:00:00Z', now, denver)).toBe('Fri, Dec 26, 2025');
  });

  it('shows times with the 12- or 24-hour setting', () => {
    expect(messageTime('2026-10-27T21:30:00Z', denver)).toBe('3:30 PM');
    expect(messageTime('2026-10-27T21:30:00Z', { ...denver, use24h: true })).toBe('15:30');
    expect(fullTime('2026-10-26T21:30:00Z', denver)).toBe('Mon, Oct 26, 2026, 3:30 PM');
  });

  it('shortens the chat list’s times with age', () => {
    expect(listTime('2026-10-27T14:05:00Z', now, denver)).toBe('8:05 AM');
    expect(listTime('2026-10-26T14:00:00Z', now, denver)).toBe('Yesterday');
    expect(listTime('2026-10-23T14:00:00Z', now, denver)).toBe('Fri');
    expect(listTime('2026-10-19T14:00:00Z', now, denver)).toBe('Oct 19');
    expect(listTime('2025-10-19T14:00:00Z', now, denver)).toBe('Oct 19, 2025');
  });
});
