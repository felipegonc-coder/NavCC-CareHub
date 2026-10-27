import type { RouteObject } from 'react-router';

/** Where Google's sign-in comes back to, and where reconnect notices point. */
export const CONNECTIONS_PATH = '/calendar/connections';

/** For the Calendar's routes: the Connected calendars screen, loaded when someone opens it. */
export const connectionsRoutes: RouteObject[] = [
  {
    path: CONNECTIONS_PATH.slice(1),
    lazy: async () => ({ Component: (await import('./index')).ConnectionsScreen }),
  },
];
