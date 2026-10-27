import type { RouteObject } from 'react-router';

/** /analytics, inside the app shell. Only Admins get its numbers (AN-D1); others get 403 (AN-06). */
export const routes: RouteObject[] = [{ path: 'analytics', lazy: () => import('./route') }];
