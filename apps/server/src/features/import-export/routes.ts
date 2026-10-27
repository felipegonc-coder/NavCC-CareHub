import type { FastifyPluginAsync } from 'fastify';
import printRoutes from './export/print';
import exportRoutes from './export/routes';

// /api/import-export: Markdown, CSV and Notion imports; exports, Print and PDF.
// Extras lane (decision 0400, docs/extras/README.md). Exports live in export/, imports in import/.
const importExportRoutes: FastifyPluginAsync = async (app) => {
  await app.register(exportRoutes, { prefix: '/exports' });
  await app.register(printRoutes, { prefix: '/print' });
};

export default importExportRoutes;
