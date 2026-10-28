import type { FastifyPluginAsync } from 'fastify';
import { configureClaude } from './server/runtime';

// /api/claude: Claude features, all switched off by default.
// Extras lane (decision 0400, docs/extras/claude.md); routes arrive with the feature's PRs.
const claudeRoutes: FastifyPluginAsync = async (app) => {
  // The client's failures go to the app's log: a status and an error type, nothing else.
  configureClaude({ log: { warn: (details, message) => app.log.warn(details, message) } });
};

export default claudeRoutes;
