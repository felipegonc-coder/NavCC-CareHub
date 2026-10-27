import type { RouteObject } from 'react-router';

/** /status, open to everyone without signing in (Status page spec). */
export const routes: RouteObject[] = [{ path: 'status', lazy: () => import('./route') }];
