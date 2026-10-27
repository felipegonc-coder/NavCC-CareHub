import type { FastifyPluginAsync } from 'fastify';

// /api/import-export: Markdown, CSV and Notion imports; exports, Print and PDF.
// Extras lane (decision 0400, docs/extras/README.md); routes arrive with the feature's PRs.
const importExportRoutes: FastifyPluginAsync = async () => {};

export default importExportRoutes;
