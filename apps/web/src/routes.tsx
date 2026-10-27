import type { RouteObject } from 'react-router';
import { RequireAuth } from './features/auth/require-auth';
import { AppLayout } from './shell/AppLayout';
import { NotFoundPage } from './shell/NotFoundPage';

// Each feature exports `routes: RouteObject[]` from `features/<f>/routes.tsx`, with its screens
// loaded lazily, and replaces only its own two lines, so parallel pull requests never edit the same
// lines: the import below, for example
// `import { routes as messagesRoutes } from './features/messages/routes';`,
// and the spread in publicRoutes or appRoutes, `...messagesRoutes,`.

// feature: auth
import { routes as authRoutes } from './features/auth/routes';

// feature: status

// feature: design

// feature: shell

// feature: home
import { routes as homeRoutes } from './features/home/routes';

// feature: pages

// feature: settings

// feature: search
import { routes as searchRoutes } from './features/search/routes';

// feature: history
import { routes as historyRoutes } from './features/history/routes';

// feature: templates
import { routes as templatesRoutes } from './features/templates/routes';

// feature: import-export
import { routes as importExportRoutes } from './features/import-export/routes';

// feature: knowledge
import { routes as knowledgeRoutes } from './features/knowledge/routes';

// feature: learning
import { routes as learningRoutes } from './features/learning/routes';

// feature: databases

// feature: forms
import { routes as formsRoutes } from './features/forms/routes';

// feature: messages

// feature: calendar

// feature: meetings

// feature: automations

// feature: analytics

// feature: notifications

// feature: claude
import { routes as claudeRoutes } from './features/claude/routes';

/** Signed out, without the app shell: sign-in, set password, /status, the design kit gallery. */
export const publicRoutes: RouteObject[] = [
  // feature: auth
  ...authRoutes,

  // feature: status

  // feature: design
  { path: 'design', lazy: () => import('./features/design/route') },

  // feature: forms
  ...formsRoutes,
];

/** Signed in, inside the app shell. */
export const appRoutes: RouteObject[] = [
  // feature: shell

  // feature: home
  ...homeRoutes,

  // feature: pages

  // feature: settings

  // feature: search
  ...searchRoutes,

  // feature: history
  ...historyRoutes,

  // feature: templates
  ...templatesRoutes,

  // feature: import-export
  ...importExportRoutes,

  // feature: knowledge
  ...knowledgeRoutes,

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
  ...claudeRoutes,
];

export const routes: RouteObject[] = [
  ...publicRoutes,
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    children: [...appRoutes, { path: '*', element: <NotFoundPage /> }],
  },
];
