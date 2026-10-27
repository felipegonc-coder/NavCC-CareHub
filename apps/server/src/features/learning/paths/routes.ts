import { CreatePathRequestSchema, IdSchema, SavePathRequestSchema } from '@carehub/learning';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requirePermission, viewerOf } from '../auth';
import { parseInput } from '../errors';
import * as paths from './service';

const PathParams = z.object({ id: IdSchema });

// Learning paths: the path page for anyone in the workspace, and the Studio path API for people
// with learning.build. Endpoints in docs/learning/api.md. Who is asking comes from ../auth.
const pathsRoutes: FastifyPluginAsync = async (app) => {
  const build = { preHandler: requirePermission('learning.build') };
  const pathOf = (request: FastifyRequest) => parseInput(PathParams, request.params).id;

  app.get('/paths/:id', async (request) =>
    paths.getPathPage(app.db, viewerOf(request), pathOf(request)),
  );
  app.get('/studio/paths', build, async (request) =>
    paths.listPaths(app.db, viewerOf(request).workspaceId),
  );
  app.post('/studio/paths', build, async (request, reply) => {
    const input = parseInput(CreatePathRequestSchema, request.body);
    return reply.code(201).send(await paths.createPath(app.db, viewerOf(request), input));
  });
  app.get('/studio/paths/:id', build, async (request) =>
    paths.getPath(app.db, viewerOf(request).workspaceId, pathOf(request)),
  );
  app.put('/studio/paths/:id', build, async (request) => {
    const path = parseInput(SavePathRequestSchema, request.body);
    return paths.savePath(app.db, viewerOf(request), pathOf(request), path);
  });
  app.delete('/studio/paths/:id', build, async (request, reply) => {
    await paths.deletePath(app.db, viewerOf(request).workspaceId, pathOf(request));
    return reply.code(204).send();
  });
};

export default pathsRoutes;
