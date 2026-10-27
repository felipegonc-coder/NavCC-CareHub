import type { FastifyPluginAsync } from 'fastify';
import buttonRoutes from './button-routes';
import galleryRoutes from './gallery';

// /api/templates: the template gallery, starter templates and the "/button" block.
// Extras lane (decision 0400, docs/extras/README.md).
const templatesRoutes: FastifyPluginAsync = async (app) => {
  await app.register(galleryRoutes);
  await app.register(buttonRoutes, { prefix: '/buttons' });
};

export default templatesRoutes;
