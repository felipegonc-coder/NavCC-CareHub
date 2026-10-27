import type { RepeatRule } from '@carehub/team-repeat';
import { describe, expect, it } from 'vitest';
import type { Schedule } from './model';
import { startOf } from './starts';

const denver = 'America/Denver';
const tuesdays: RepeatRule = { freq: 'weekly', interval: 1, byDay: [{ day: 'TU' }] };

/** A one-off visit on Oct 27, 2026, 10:00 to 11:00 in Denver (16:00 UTC). */
const visit: Schedule = {
  allDay: false,
  timeZone: denver,
  start: '2026-10-27T10:00',
  end: '2026-10-27T11:00',
  rule: null,
  exceptions: [],
  overrides: {},
};

/** Weekly on Tuesdays from Oct 20; Oct 27 removed, Nov 3 moved to 14:00 (after DST ends). */
const weekly: Schedule = {
  ...visit,
  start: '2026-10-20T10:00',
  end: '2026-10-20T11:00',
  rule: tuesdays,
  exceptions: ['2026-10-27T10:00'],
  overrides: { '2026-11-03T10:00': { start: '2026-11-03T14:00', end: '2026-11-03T15:00' } },
};

describe('startOf', () => {
  it('gives the moment a timed event starts, and the day an all-day one does', () => {
    expect(startOf(visit)).toEqual({ start: new Date('2026-10-27T16:00:00.000Z') });
    const day = { ...visit, allDay: true, start: '2026-10-28', end: '2026-10-29' };
    expect(startOf(day)).toEqual({ allDay: '2026-10-28' });
  });

  it('finds one occurrence of a repeating event by its key', () => {
    expect(startOf(weekly, '2026-10-20T10:00')).toEqual({
      start: new Date('2026-10-20T16:00:00.000Z'),
    });
    expect(startOf(weekly, '2026-11-03T10:00')).toEqual({
      start: new Date('2026-11-03T21:00:00.000Z'),
    });
  });

  it('is null for a removed occurrence, a key that does not fit, or no key on a series', () => {
    expect(startOf(weekly, '2026-10-27T10:00')).toBeNull();
    expect(startOf(weekly, '2026-10-21T10:00')).toBeNull();
    expect(startOf(weekly, 'not a key')).toBeNull();
    expect(startOf(weekly)).toBeNull();
    expect(startOf(visit, '2026-10-27T10:00')).toBeNull();
  });
});
