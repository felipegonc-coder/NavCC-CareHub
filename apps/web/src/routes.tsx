import type { RouteObject } from 'react-router';
import { HomePage } from './HomePage';

// Each feature replaces only its own line below with its route objects, loading its screens
// lazily, for example `{ path: 'settings', lazy: () => import('./features/settings/route') },`,
// so parallel pull requests never edit the same lines.
export const routes: RouteObject[] = [
  { path: '/', element: <HomePage /> },

  // feature: shell

  // feature: auth

  // feature: pages

  // feature: settings

  // feature: learning

  // feature: databases

  // feature: messages

  // feature: calendar
];
