// The gallery's routes under /api/templates (docs/extras/testing.md, "Templates and buttons").
import { saveTemplateSchema, templateIdSchema } from '@carehub/extras/templates/schemas';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { core } from './core';
import { listGallery, previewTemplate, saveTemplate } from './service';

const idParams = z.object({ id: templateIdSchema });

const galleryRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', async (request) => listGallery(app.db, core().viewer(request)));

  app.get('/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    return previewTemplate(app.db, core().viewer(request), id);
  });

  app.post('/', async (request, reply) => {
    const viewer = core().viewer(request);
    const card = await saveTemplate(app.db, viewer, saveTemplateSchema.parse(request.body));
    return reply.code(201).send(card);
  });
};

export default galleryRoutes;
