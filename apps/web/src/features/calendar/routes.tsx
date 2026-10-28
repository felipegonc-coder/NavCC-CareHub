import type { RouteObject } from 'react-router';

/** `/calendar`, inside the app shell. */
export const routes: RouteObject[] = [
  {
    path: 'calendar',
    lazy: async () => ({ Component: (await import('./screen/CalendarScreen')).CalendarScreen }),
  },
];
