// The page model's HTTP routes and `app.requirePageAccess` (decision 0007, sections 3.3 and 4.1).
import fp from 'fastify-plugin';
import { getDefaultWorkspace } from '../workspaces';
import { requirePageAccess } from './access';
import { spaceRoutes } from './space-routes';
import { setUpWorkspaceSpaces } from './spaces';

declare module 'fastify' {
  interface FastifyInstance {
    /**
     * preHandler: 404 if the page is missing or in Trash, 403 if the person has less than `min`.
     * A route that sets `config: { allowGuests: true }` must check the page grant itself: this
     * guard, or `getPageAccess`.
     */
    requirePageAccess: typeof requirePageAccess;
  }
}

// fastify-plugin makes `app.requirePageAccess` visible to every feature registered after this one
// (decision 0012). A prefix wouldn't apply here, so the routes use their full /api/... paths.
export default fp(
  async (app) => {
    app.decorate('requirePageAccess', requirePageAccess);
    // A new workspace starts with the Open default space "General" (SB-01).
    const workspace = await getDefaultWorkspace(app.db);
    if (workspace) await setUpWorkspaceSpaces(app.db, workspace.id);
    spaceRoutes(app);
    // Pages, Trash, favorites and recent pages come in the next pull requests.
  },
  { name: 'carehub-pages', fastify: '5.x', dependencies: ['carehub-auth'] },
);
