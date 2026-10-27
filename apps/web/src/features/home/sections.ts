import type { TimePrefs } from '@carehub/team-time';
import type { ComponentType } from 'react';
import { RemindersSection } from './RemindersSection';
import type { HomeSectionId } from './settings';
import { UnreadSection } from './UnreadSection';
import { UpcomingSection } from './UpcomingSection';

/** What every section gets from Home: one clock, so they all move on together. */
export interface SectionProps {
  now: Date;
  prefs: Readonly<TimePrefs>;
}

export type { HomeSectionId };

export interface HomeSectionEntry {
  id: HomeSectionId;
  title: string;
  Component: ComponentType<SectionProps>;
}

/**
 * Home's sections in the spec's order (read left to right in two columns). The others join when
 * their data is on main: My tasks (task databases) after Unread messages, then My learning
 * (Learning, Phase 4) and Recent pages after Reminders.
 */
export const homeSections: readonly HomeSectionEntry[] = [
  { id: 'upcoming', title: 'Upcoming', Component: UpcomingSection },
  { id: 'unread', title: 'Unread messages', Component: UnreadSection },
  { id: 'reminders', title: 'Reminders', Component: RemindersSection },
];
