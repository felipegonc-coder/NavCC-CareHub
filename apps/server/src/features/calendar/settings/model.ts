import {
  DEFAULT_SETTINGS,
  calendarSettingsSchema,
  type CalendarSettings,
} from '@carehub/team-calendar-api';

const NAMES = Object.keys(DEFAULT_SETTINGS) as (keyof CalendarSettings)[];

/** The saved settings over the defaults, leaving out any saved value that no longer passes. */
export function settingsOf(saved: Readonly<Record<string, unknown>> | undefined): CalendarSettings {
  const settings: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const name of NAMES) {
    if (saved && name in saved && calendarSettingsSchema.shape[name].safeParse(saved[name]).success)
      settings[name] = saved[name];
  }
  return calendarSettingsSchema.parse(settings);
}
