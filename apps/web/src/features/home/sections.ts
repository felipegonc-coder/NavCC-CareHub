import type { TimePrefs } from '@carehub/team-time';
import type { ComponentType } from 'react';
import type { HomeSectionId } from './settings';
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
 * Home's sections in the spec's order (read left to right in two columns). Each one joins when
 * its data is on main: Unread messages (Messages), My tasks (task databases), Reminders, My
 * learning (Learning, Phase 4) and Recent pages.
 */
export const homeSections: readonly HomeSectionEntry[] = [
  { id: 'upcoming', title: 'Upcoming', Component: UpcomingSection },
];
