// /api/search: pages, databases and rows the person can open, and what the Ctrl+K window shows
// before typing (Search spec; Extras lane, decision 0400). Everyone in the workspace may search;
// each result is checked for access on every search, and the recent lists are each person's own.
import {
  searchHistorySchema,
  searchPeopleQuerySchema,
  searchRequestSchema,
  searchVisitSchema,
} from '@carehub/extras/search';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { httpError } from '../../core/errors';
import { memberOf } from './pages';
import {
  clearRecentSearches,
  openedRecently,
  recentPages,
  recentSearches,
  recordSearch,
  recordVisit,
  removeRecentSearch,
} from './recent';
import { registerSearchBoost, runSearch, type Searcher } from './search';
import { didYouMean, searchPeople } from './suggest';
import { startSearchSync } from './sync';

function searcherOf(request: FastifyRequest): Searcher {
  if (!request.user) throw httpError(401, 'signed_out');
  const member = memberOf(request);
  if (!member) throw httpError(403, 'forbidden');
  return { userId: request.user.id, workspaceId: member.workspaceId };
}

const recentParams = z.object({ id: z.uuid({ error: "That ID isn't right." }) });

const searchRoutes: FastifyPluginAsync = async (app) => {
  startSearchSync(app);
  const unregister = registerSearchBoost('opened-recently', openedRecently);
  app.addHook('onClose', async () => unregister());

  app.post('/query', async (request) => {
    const searcher = searcherOf(request);
    const input = searchRequestSchema.parse(request.body);
    const found = await runSearch(app.db, searcher, input);
    // Did you mean: for the search box's first page with fewer than 3 results, not page pickers.
    if (found.total >= 3 || input.cursor || input.limit || input.match !== 'all') return found;
    const suggestion = await didYouMean(app.db, searcher, input);
    return suggestion ? { ...found, didYouMean: suggestion } : found;
  });

  app.get('/people', async (request) => {
    const searcher = searcherOf(request);
    const query = searchPeopleQuerySchema.parse(request.query);
    return { people: await searchPeople(app.db, searcher, query) };
  });

  app.get('/recent', async (request) => {
    const searcher = searcherOf(request);
    const [pages, searches] = await Promise.all([
      recentPages(app.db, searcher),
      recentSearches(app.db, searcher),
    ]);
    return { pages, searches };
  });

  app.delete('/recent', async (request, reply) => {
    await clearRecentSearches(app.db, searcherOf(request));
    return reply.code(204).send();
  });

  app.delete('/recent/:id', async (request, reply) => {
    const searcher = searcherOf(request);
    await removeRecentSearch(app.db, searcher, recentParams.parse(request.params).id);
    return reply.code(204).send();
  });

  app.post('/history', async (request, reply) => {
    const searcher = searcherOf(request);
    await recordSearch(app.db, searcher, searchHistorySchema.parse(request.body));
    return reply.code(204).send();
  });

  // stand-in: core's page.viewed event (and the Sidebar's recent pages) replaces this; the window
  // reports the page it sees open until then.
  app.post('/visits', async (request, reply) => {
    const searcher = searcherOf(request);
    await recordVisit(app.db, searcher.userId, searchVisitSchema.parse(request.body).pageId);
    return reply.code(204).send();
  });
};

export default searchRoutes;
