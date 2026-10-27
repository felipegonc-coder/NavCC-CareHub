import type { Screen } from '../screens.js';

// The screens of the team lane. Names start with "team-"; see ../README.md.
export const screens: Screen[] = [
  // Calendar, on a fixed date so the screenshots don't change from day to day.
  { name: 'team-calendar-week', path: '/calendar?view=week&date=2026-10-27' },
  { name: 'team-calendar-day', path: '/calendar?view=day&date=2026-10-27' },
  { name: 'team-calendar-month', path: '/calendar?view=month&date=2026-10-27' },
];
