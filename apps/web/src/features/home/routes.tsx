import type { RouteObject } from 'react-router';

/** Home at `/`, loaded when someone opens it. Spread into appRoutes by apps/web/src/routes.tsx. */
export const routes: RouteObject[] = [
  { index: true, lazy: async () => ({ Component: (await import('./HomeScreen')).HomeScreen }) },
];
