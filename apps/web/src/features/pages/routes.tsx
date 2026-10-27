import type { RouteObject } from 'react-router';

/** The pages feature's screens, inside the app shell (decision 0007, section 5.1). */
export const routes: RouteObject[] = [
  { path: 'p/:pageId', lazy: () => import('./page-route') },
  { path: 'new', lazy: () => import('./new-route') },
  { path: 'spaces', lazy: () => import('./spaces-route') },
  { path: 'spaces/:spaceId/settings', lazy: () => import('./space-settings-route') },
  { path: 'trash', lazy: () => import('./trash-route') },
];
