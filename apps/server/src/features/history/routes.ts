import type { FastifyPluginAsync } from 'fastify';
import { startHistoryTracking } from './tracker';

// /api/history: versions, Updates and Archive.
// Extras lane (decision 0400, features/history/README.md). This part saves versions; the routes
// come next.
const historyRoutes: FastifyPluginAsync = async (app) => {
  startHistoryTracking(app);
};

export default historyRoutes;
