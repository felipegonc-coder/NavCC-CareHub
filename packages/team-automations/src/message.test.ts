import { describe, expect, it } from 'vitest';
import type { Trigger } from './automation';
import { fillIn, fillInDate, firstNameOf, messageTimeZone } from './message';

describe('fillIn', () => {
  const values = { firstName: 'Riley', date: 'Monday, Oct 26' };

  it('fills in each recipient’s first name and the date (AU-02)', () => {
    expect(fillIn('Morning {first name}! Stand-up at 9:10 on {date}.', values)).toBe(
      'Morning Riley! Stand-up at 9:10 on Monday, Oct 26.',
    );
  });

  it('fills in every one, in any case', () => {
    expect(fillIn('{First name}, {first name}, {DATE}', values)).toBe(
      'Riley, Riley, Monday, Oct 26',
    );
  });

  it('leaves anything else in braces as typed', () => {
    expect(fillIn('{Status} for {name} {first  name}', values)).toBe(
      '{Status} for {name} {first  name}',
    );
  });
});

describe('firstNameOf', () => {
  it('takes the first word of the name', () => {
    expect(firstNameOf('Avery Lin')).toBe('Avery');
    expect(firstNameOf('  Sam   Ortiz ')).toBe('Sam');
    expect(firstNameOf('Riley')).toBe('Riley');
    expect(firstNameOf('')).toBe('');
  });
});

describe('fillInDate', () => {
  it('names the day in the automation’s time zone', () => {
    const at = new Date('2026-10-27T03:00:00.000Z'); // 9:00 PM on Monday in Denver
    expect(fillInDate(at, 'America/Denver')).toBe('Monday, Oct 26');
    expect(fillInDate(at, 'Europe/Lisbon')).toBe('Tuesday, Oct 27');
  });
});

describe('messageTimeZone', () => {
  it('uses the schedule’s time zone, or Care Hub’s default', () => {
    const schedule: Trigger = {
      kind: 'schedule',
      schedule: { kind: 'daily', time: '09:00', timeZone: 'Europe/Lisbon', endDate: null },
    };
    const rowAdded: Trigger = { kind: 'rowAdded', databaseId: 'db-1', includeImports: false };
    expect(messageTimeZone(schedule)).toBe('Europe/Lisbon');
    expect(messageTimeZone(rowAdded)).toBe('America/Denver');
  });
});
