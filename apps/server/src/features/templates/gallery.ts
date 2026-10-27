// The gallery's routes under /api/templates (docs/extras/testing.md, "Templates and buttons").
import {
  saveTemplateSchema,
  templateIdSchema,
  updateTemplateSchema,
  useTemplateSchema,
  type UseTemplateResponse,
} from '@carehub/extras/templates/schemas';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { core } from './core';
import type { TemplateUsedEvent } from './events';
import { deleteTemplate, setStarterHidden, updateTemplate } from './manage';
import { listGallery, previewTemplate, saveTemplate } from './service';
import { useTemplate } from './use';

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

  app.patch('/:id', async (request) => {
    const viewer = core().viewer(request);
    const { id } = idParams.parse(request.params);
    return updateTemplate(app.db, viewer, id, updateTemplateSchema.parse(request.body));
  });

  app.delete('/:id', async (request, reply) => {
    const viewer = core().viewer(request);
    const { id } = idParams.parse(request.params);
    await deleteTemplate(app.db, viewer, id);
    return reply.code(204).send();
  });

  app.post('/:id/use', async (request, reply) => {
    const viewer = core().viewer(request);
    const { id } = idParams.parse(request.params);
    const used = await useTemplate(app.db, viewer, id, useTemplateSchema.parse(request.body ?? {}));
    core().contentChanged(used.pageIds, viewer.userId);
    const event: TemplateUsedEvent = {
      templateId: used.row?.id ?? null,
      starterKey: used.starter?.key ?? null,
      pageId: used.pageId,
      pageIds: used.pageIds,
      workspaceId: viewer.workspaceId,
      by: viewer.userId,
    };
    app.events.emit('template.used', event);
    const body: UseTemplateResponse = { pageId: used.pageId, notCopied: used.notCopied };
    return reply.code(201).send(body);
  });

  app.put('/:id/hidden', async (request, reply) => {
    const viewer = core().viewer(request);
    const { id } = idParams.parse(request.params);
    await setStarterHidden(app.db, viewer, id, true);
    return reply.code(204).send();
  });

  app.delete('/:id/hidden', async (request, reply) => {
    const viewer = core().viewer(request);
    const { id } = idParams.parse(request.params);
    await setStarterHidden(app.db, viewer, id, false);
    return reply.code(204).send();
  });
};

export default galleryRoutes;
