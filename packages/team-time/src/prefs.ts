import type { WeekStart } from './civil';

/**
 * A person's time settings, named as on `request.user` (decision 0007, section 3.1). Always pass
 * them in: nothing in this package reads a global zone, locale or clock setting.
 */
export type TimePrefs = {
  /** IANA time zone name, such as 'America/Denver'. */
  timeZone: string;
  /** 24-hour times ('15:30') instead of 12-hour ones ('3:30 PM'). */
  use24h: boolean;
  /** First day of the week: 0 = Sunday, 1 = Monday, 6 = Saturday. */
  weekStart: WeekStart;
};

/** Settings for someone who hasn't changed them. */
export const DEFAULT_TIME_PREFS: Readonly<TimePrefs> = {
  timeZone: 'America/Denver',
  use24h: false,
  weekStart: 0,
};
