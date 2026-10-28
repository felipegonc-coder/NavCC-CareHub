import { describe, expect, it } from 'vitest';
import {
  cleanFilters,
  dateLabel,
  dayField,
  dayStart,
  fieldDay,
  hasFilters,
  pickLabel,
  toggled,
  typeLabel,
} from './filters';

const now = new Date(2026, 9, 27, 15, 30);

describe('the filter chips', () => {
  it('send only the filters that are on', () => {
    expect(
      cleanFilters({ titleOnly: false, in: [], types: ['page'], includeArchived: true }),
    ).toEqual({ types: ['page'], includeArchived: true });
    expect(hasFilters({ titleOnly: false, createdBy: [] })).toBe(false);
    expect(hasFilters({ titleOnly: true })).toBe(true);
    expect(toggled(['a', 'b'], 'a')).toEqual(['b']);
    expect(toggled(undefined, 'a')).toEqual(['a']);
  });

  it('say what is picked', () => {
    const names = { p1: 'Support', u1: 'Sam Ortiz' };
    expect(pickLabel('In', [], names, ['page', 'pages'])).toBe('In');
    expect(pickLabel('In', ['p1'], names, ['page', 'pages'])).toBe('In: Support');
    expect(pickLabel('In', ['p9'], names, ['page', 'pages'])).toBe('In: 1 page');
    expect(pickLabel('Edited by', ['u1', 'u2'], names, ['person', 'people'])).toBe(
      'Edited by: 2 people',
    );
    expect(typeLabel(['row', 'page'])).toBe('Type: Pages, Rows');
    expect(typeLabel(undefined)).toBe('Type');
  });

  it('send days as their start here, and show them back in the date fields', () => {
    expect(dayStart(now, 6)).toBe(new Date(2026, 9, 21).toISOString());
    expect(fieldDay('2026-10-20')).toBe(new Date(2026, 9, 20).toISOString());
    // `to` isn't included, so the last day picked is sent as the start of the next.
    expect(fieldDay('2026-10-20', true)).toBe(new Date(2026, 9, 21).toISOString());
    expect(fieldDay('')).toBeUndefined();
    expect(dayField(fieldDay('2026-10-20'))).toBe('2026-10-20');
    expect(dayField(fieldDay('2026-10-20', true), true)).toBe('2026-10-20');
    expect(dayField(undefined)).toBe('');
  });

  it('name the date picked', () => {
    expect(dateLabel(undefined, now)).toBe('Date');
    expect(dateLabel({ field: 'edited', from: dayStart(now, 6) }, now)).toBe(
      'Date: Edited, last 7 days',
    );
    expect(dateLabel({ field: 'created', from: dayStart(now) }, now)).toBe('Date: Created, today');
    const from = fieldDay('2026-10-01');
    const to = fieldDay('2026-10-20', true);
    expect(dateLabel({ field: 'edited', from, to }, now)).toBe('Date: Edited, Oct 1 – Oct 20');
    expect(dateLabel({ field: 'edited', from: fieldDay('2025-12-30') }, now)).toBe(
      'Date: Edited, since Dec 30, 2025',
    );
    expect(dateLabel({ field: 'edited', to }, now)).toBe('Date: Edited, until Oct 20');
  });
});
