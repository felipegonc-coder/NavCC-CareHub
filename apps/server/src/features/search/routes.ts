// /api/search: pages, databases and rows the person can open (Search spec; Extras lane, decision
// 0400). Everyone in the workspace may search; each result is checked for access on every search.
import { searchRequestSchema } from '@carehub/extras/search';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { httpError } from '../../core/errors';
import { memberOf } from './pages';
import { runSearch, type Searcher } from './search';
import { startSearchSync } from './sync';

function searcherOf(request: FastifyRequest): Searcher {
  if (!request.user) throw httpError(401, 'signed_out');
  const member = memberOf(request);
  if (!member) throw httpError(403, 'forbidden');
  return { userId: request.user.id, workspaceId: member.workspaceId };
}

const searchRoutes: FastifyPluginAsync = async (app) => {
  startSearchSync(app);

  app.post('/query', async (request) => {
    const searcher = searcherOf(request);
    return runSearch(app.db, searcher, searchRequestSchema.parse(request.body));
  });
};

export default searchRoutes;
