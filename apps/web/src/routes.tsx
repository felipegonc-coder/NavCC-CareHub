import type { RouteObject } from 'react-router';
import { HomePage } from './HomePage';

// Each feature replaces only its own line below with its route objects, loading its screens
// lazily, for example `{ path: 'settings', lazy: () => import('./features/settings/route') },`,
// so parallel pull requests never edit the same lines.
export const routes: RouteObject[] = [
  { path: '/', element: <HomePage /> },

  // feature: shell
  { path: 'design', lazy: () => import('./features/design/route') },
  {
    lazy: () => import('./features/shell/layout'),
    children: [{ path: '*', lazy: () => import('./features/shell/not-found') }],
  },

  // feature: auth

  // feature: pages

  // feature: settings

  // feature: learning

  // feature: databases

  // feature: messages

  // feature: calendar
];
