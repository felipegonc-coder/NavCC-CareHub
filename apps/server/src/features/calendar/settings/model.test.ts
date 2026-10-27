import { DEFAULT_SETTINGS } from '@carehub/team-calendar-api';
import { describe, expect, it } from 'vitest';
import { settingsOf } from './model';

describe('settingsOf', () => {
  it('gives the defaults when nothing is saved', () => {
    expect(settingsOf(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(settingsOf({})).toEqual(DEFAULT_SETTINGS);
  });

  it('puts the saved settings over the defaults', () => {
    const secondTimeZone = { timeZone: 'Europe/Lisbon', label: 'Lisbon' };
    expect(settingsOf({ hideWeekends: true, secondTimeZone, defaultReminder: 10 })).toEqual({
      ...DEFAULT_SETTINGS,
      hideWeekends: true,
      secondTimeZone,
      defaultReminder: 10,
    });
  });

  it('leaves out unknown names and values that no longer pass', () => {
    expect(settingsOf({ weekStart: 1, defaultLength: 45, shortcuts: false })).toEqual({
      ...DEFAULT_SETTINGS,
      shortcuts: false,
    });
  });
});
