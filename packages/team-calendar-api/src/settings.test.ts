import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  calendarSettingsSchema,
  settingsPatchSchema,
  settingsResponseSchema,
} from './settings';

describe('calendar settings', () => {
  it('has defaults that pass their own check', () => {
    expect(calendarSettingsSchema.parse(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS).toMatchObject({ defaultLength: 60, shortcuts: true });
    expect(settingsResponseSchema.safeParse({ settings: DEFAULT_SETTINGS }).success).toBe(true);
  });

  it('takes only the changed settings', () => {
    expect(settingsPatchSchema.parse({ hideWeekends: true })).toEqual({ hideWeekends: true });
    expect(
      settingsPatchSchema.parse({
        secondTimeZone: { timeZone: 'Europe/Lisbon', label: ' Lisbon ' },
        defaultReminder: 10,
      }),
    ).toEqual({
      secondTimeZone: { timeZone: 'Europe/Lisbon', label: 'Lisbon' },
      defaultReminder: 10,
    });
    expect(settingsPatchSchema.parse({ secondTimeZone: null, defaultReminder: null })).toEqual({
      secondTimeZone: null,
      defaultReminder: null,
    });
  });

  it('refuses empty, unknown and out-of-range changes', () => {
    for (const patch of [
      {},
      { weekStart: 1 },
      { defaultLength: 45 },
      { defaultReminder: -5 },
      { defaultReminder: 1.5 },
      { defaultReminder: 40_321 },
      { secondTimeZone: { timeZone: 'Mars/Olympus', label: 'Mars' } },
      { secondTimeZone: { timeZone: 'Asia/Tokyo', label: '' } },
      { hideDeclined: 'yes' },
    ]) {
      expect(settingsPatchSchema.safeParse(patch).success, JSON.stringify(patch)).toBe(false);
    }
  });
});
