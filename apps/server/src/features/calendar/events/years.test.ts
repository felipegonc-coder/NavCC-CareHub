import { describe, expect, it } from 'vitest';
import type { Schedule } from './model';
import { YEARS_MESSAGE, scheduleInYears } from './years';

const huddle: Schedule = {
  allDay: false,
  timeZone: 'America/Denver',
  start: '2026-10-27T09:00',
  end: '2026-10-27T09:30',
  rule: null,
  exceptions: [],
  overrides: {},
};
const weekly = { freq: 'weekly', interval: 1 } as const;

describe('scheduleInYears', () => {
  it('takes times from the start of 1900 to the end of 2100', () => {
    expect(scheduleInYears(huddle)).toBe(true);
    expect(scheduleInYears({ ...huddle, start: '1900-01-01T00:00', end: '1900-01-01T00:30' })).toBe(
      true,
    );
    const lastDay = { ...huddle, allDay: true, start: '2100-12-31', end: '2101-01-01' };
    expect(scheduleInYears(lastDay)).toBe(true);
    expect(scheduleInYears({ ...huddle, rule: { ...weekly, until: '2100-12-31' } })).toBe(true);
    expect(YEARS_MESSAGE).toBe('Pick a date between 1900 and 2100.');
  });

  it('refuses starts, ends, repeat ends and moved occurrences outside those years', () => {
    expect(scheduleInYears({ ...huddle, start: '1899-12-31T23:30' })).toBe(false);
    expect(scheduleInYears({ ...huddle, end: '2102-01-01T09:30' })).toBe(false);
    const later = { ...huddle, start: '2101-01-01T09:00', end: '2101-01-01T09:30' };
    expect(scheduleInYears(later)).toBe(false);
    expect(scheduleInYears({ ...huddle, rule: { ...weekly, until: '2101-01-01' } })).toBe(false);
    const moved = { '2026-11-03T09:00': { start: '2201-11-03T09:00', end: '2201-11-03T09:30' } };
    expect(scheduleInYears({ ...huddle, rule: weekly, overrides: moved })).toBe(false);
    const movedEnd = { '2026-11-03T09:00': { end: '0026-11-03T09:30' } };
    expect(scheduleInYears({ ...huddle, rule: weekly, overrides: movedEnd })).toBe(false);
  });
});
