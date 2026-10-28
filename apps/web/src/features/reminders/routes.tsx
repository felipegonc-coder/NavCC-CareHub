import type { RouteObject } from 'react-router';

/** Reminders' screens, each loaded lazily: the list at /reminders (Home's See all). */
export const routes: RouteObject[] = [
  {
    path: 'reminders',
    lazy: async () => ({ Component: (await import('./RemindersScreen')).RemindersScreen }),
  },
];
