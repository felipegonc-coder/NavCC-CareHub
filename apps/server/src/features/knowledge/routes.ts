import type { FastifyPluginAsync } from 'fastify';

// /api/knowledge: knowledge base extras on wiki databases.
// Extras lane (decision 0400, docs/extras/README.md); routes arrive with the feature's PRs.
const knowledgeRoutes: FastifyPluginAsync = async () => {};

export default knowledgeRoutes;
