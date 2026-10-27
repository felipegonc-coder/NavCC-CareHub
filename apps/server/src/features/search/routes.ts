import type { FastifyPluginAsync } from 'fastify';
import { startSearchSync } from './sync';

// /api/search: pages, databases and rows the person can open, and the Ctrl+K window.
// Extras lane (decision 0400, docs/extras/search.md). This part keeps the index up to date; the
// search routes come next.
const searchRoutes: FastifyPluginAsync = async (app) => {
  startSearchSync(app);
};

export default searchRoutes;
