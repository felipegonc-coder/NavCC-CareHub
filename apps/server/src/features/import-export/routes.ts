import type { FastifyPluginAsync } from 'fastify';
import exportRoutes from './export/routes';

// /api/import-export: Markdown, CSV and Notion imports; exports, Print and PDF.
// Extras lane (decision 0400, docs/extras/README.md). Exports live in export/, imports in import/.
const importExportRoutes: FastifyPluginAsync = async (app) => {
  await app.register(exportRoutes, { prefix: '/exports' });
};

export default importExportRoutes;
