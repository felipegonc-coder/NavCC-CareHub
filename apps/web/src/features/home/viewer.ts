import { DEFAULT_TIME_PREFS, type TimePrefs } from '@carehub/team-time';

/** Who's looking at Home: the name for the greeting, and their time settings. */
export interface Viewer {
  name: string;
  prefs: Readonly<TimePrefs>;
}

const STAND_IN: Viewer = { name: '', prefs: DEFAULT_TIME_PREFS };

/**
 * Stand-in until useMe() from features/auth lands (decision 0007, section 5.2): no name, so the
 * greeting reads "Good afternoon · Monday, October 26", and the default time settings.
 */
export function useViewer(): Viewer {
  return STAND_IN;
}
