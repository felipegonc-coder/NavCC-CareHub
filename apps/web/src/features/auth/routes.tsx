import type { RouteObject } from 'react-router';

/** The signed-out screens, without the app shell, each loaded lazily. */
export const routes: RouteObject[] = [{ path: 'sign-in', lazy: () => import('./sign-in-route') }];
