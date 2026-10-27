import type { FastifyPluginAsync } from 'fastify';

// /api/claude: Claude features, all switched off by default.
// Extras lane (decision 0400, docs/extras/README.md); routes arrive with the feature's PRs.
const claudeRoutes: FastifyPluginAsync = async () => {};

export default claudeRoutes;
