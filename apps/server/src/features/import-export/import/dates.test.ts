import { describe, expect, it } from 'vitest';
import { importedDates, importedWhen, usableTimeZone } from './dates';

describe("the source's dates", () => {
  it('keeps dates as dates and turns times into moments in UTC', () => {
    expect(importedWhen('2021-03-03', 'America/Denver')).toBe('2021-03-03');
    expect(importedWhen('2021-03-03T10:15:00Z', 'America/Denver')).toBe('2021-03-03T10:15:00.000Z');
    expect(importedWhen('2021-03-03T10:15:00+01:00', 'America/Denver')).toBe(
      '2021-03-03T09:15:00.000Z',
    );
  });

  it("reads a time without a zone in the person's time zone, summer or winter", () => {
    expect(importedWhen('2021-03-03T10:15', 'America/Denver')).toBe('2021-03-03T17:15:00.000Z');
    expect(importedWhen('2021-07-03T10:15:30.5', 'America/Denver')).toBe(
      '2021-07-03T16:15:30.500Z',
    );
    expect(importedWhen('2021-07-03T10:15:00', 'Europe/Lisbon')).toBe('2021-07-03T09:15:00.000Z');
  });

  it('drops what is not a date', () => {
    for (const value of [
      'March 3, 2021',
      '2021-02-30',
      '2021-03-03T24:00',
      '2021-02-30T10:00Z',
      '',
    ]) {
      expect(importedWhen(value, 'America/Denver')).toBeNull();
    }
    expect(importedDates({}, 'America/Denver')).toBeNull();
    expect(importedDates({ created: 'soon', updated: '2021-03-04' }, 'America/Denver')).toEqual({
      updated: '2021-03-04',
    });
  });

  it("uses Care Hub's time zone when the person's isn't known", () => {
    expect(usableTimeZone('Europe/Lisbon')).toBe('Europe/Lisbon');
    expect(usableTimeZone('Mars/Olympus')).toBe('America/Denver');
  });
});
