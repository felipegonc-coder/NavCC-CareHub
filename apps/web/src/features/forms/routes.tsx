import type { RouteObject } from 'react-router';

/**
 * Spread into the public routes by apps/web/src/routes.tsx (decision 0007 section 5.1): the form
 * link works without the app shell, and the page signs people in first when the form needs it.
 */
export const routes: RouteObject[] = [{ path: 'forms/:code', lazy: () => import('./route') }];
