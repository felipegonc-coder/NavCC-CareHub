// The "/button" block's routes under /api/templates/buttons (docs/extras/testing.md, "Templates
// and buttons").
import {
  buttonSettingsSchema,
  createButtonSchema,
  pressButtonSchema,
} from '@carehub/extras/templates/buttons';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { cancelRun, createButton, getButton, pressButton, undoRun, updateButton } from './buttons';
import { core } from './core';

const idParams = z.object({ id: z.uuid({ error: "That button ID isn't right." }) });
const runParams = z.object({ runId: z.uuid({ error: "That run ID isn't right." }) });
const pageQuery = z.object({ pageId: z.uuid({ error: "That page ID isn't right." }) });
const updateBody = z.object({
  pageId: z.uuid({ error: "That page ID isn't right." }),
  settings: buttonSettingsSchema,
});

const buttonRoutes: FastifyPluginAsync = async (app) => {
  app.post('/', async (request, reply) => {
    const viewer = core().viewer(request);
    const input = createButtonSchema.parse(request.body ?? {});
    return reply.code(201).send(await createButton(app.db, viewer, input));
  });

  app.get('/:id', async (request) => {
    const viewer = core().viewer(request);
    const { id } = idParams.parse(request.params);
    const { pageId } = pageQuery.parse(request.query);
    return getButton(app.db, viewer, id, pageId);
  });

  app.put('/:id', async (request) => {
    const viewer = core().viewer(request);
    const { id } = idParams.parse(request.params);
    const { pageId, settings } = updateBody.parse(request.body);
    return updateButton(app.db, viewer, id, { pageId, settings });
  });

  app.post('/:id/press', async (request) => {
    const viewer = core().viewer(request);
    const { id } = idParams.parse(request.params);
    return pressButton(app, viewer, id, pressButtonSchema.parse(request.body ?? {}));
  });

  app.post('/runs/:runId/cancel', async (request) => {
    const viewer = core().viewer(request);
    const { runId } = runParams.parse(request.params);
    return cancelRun(app.db, viewer, runId);
  });

  app.post('/runs/:runId/undo', async (request) => {
    const viewer = core().viewer(request);
    const { runId } = runParams.parse(request.params);
    return undoRun(app, viewer, runId);
  });
};

export default buttonRoutes;
