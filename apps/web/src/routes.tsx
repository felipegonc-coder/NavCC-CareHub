import type { RouteObject } from 'react-router';
import { AppLayout } from './shell/AppLayout';
import { NotFoundPage } from './shell/NotFoundPage';

// Each feature exports `routes: RouteObject[]` from `features/<f>/routes.tsx`, with its screens
// loaded lazily, and replaces only its own two lines, so parallel pull requests never edit the same
// lines: the import below, for example
// `import { routes as messagesRoutes } from './features/messages/routes';`,
// and the spread in publicRoutes or appRoutes, `...messagesRoutes,`.

// feature: auth

// feature: status

// feature: design

// feature: shell

// feature: home
import { HomePage } from './HomePage'; // placeholder until the home line takes /

// feature: pages
import { routes as pagesRoutes } from './features/pages/routes';

// feature: settings

// feature: search

// feature: learning
import { routes as learningRoutes } from './features/learning/routes';

// feature: databases

// feature: forms

// feature: messages

// feature: calendar

// feature: meetings

// feature: automations

// feature: analytics

// feature: notifications

// feature: claude

/** Signed out, without the app shell: sign-in, set password, /status, the design kit gallery. */
export const publicRoutes: RouteObject[] = [
  // feature: auth

  // feature: status

  // feature: design
  { path: 'design', lazy: () => import('./features/design/route') },
];

/** Signed in, inside the app shell. */
export const appRoutes: RouteObject[] = [
  // feature: shell

  // feature: home
  { index: true, element: <HomePage /> }, // placeholder until the home line takes /

  // feature: pages
  ...pagesRoutes,

  // feature: settings

  // feature: search

  // feature: learning
  ...learningRoutes,

  // feature: databases

  // feature: forms

  // feature: messages

  // feature: calendar

  // feature: meetings

  // feature: automations

  // feature: analytics

  // feature: notifications

  // feature: claude
];

export const routes: RouteObject[] = [
  ...publicRoutes,
  {
    path: '/',
    element: <AppLayout />,
    children: [...appRoutes, { path: '*', element: <NotFoundPage /> }],
  },
];
