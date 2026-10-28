import {
  CreatePathRequestSchema,
  IdSchema,
  PathReportQuerySchema,
  SavePathRequestSchema,
} from '@carehub/learning';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requirePermission, viewerOf } from '../auth';
import { parseInput } from '../errors';
import { sendCsv } from '../reports/send';
import { pathReportCsvOf, pathReportOf, postgresPathReportSources } from './report';
import * as paths from './service';

const PathParams = z.object({ id: IdSchema });

// Learning paths: the path page for anyone in the workspace, the Studio path API for people with
// learning.build, and the path report (./report). Endpoints in docs/learning/api.md. Who is asking
// comes from ../auth.
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
  app.get('/reports/paths/:id', async (request, reply) => {
    const viewer = viewerOf(request);
    const id = pathOf(request);
    const { format } = parseInput(PathReportQuerySchema, request.query);
    const sources = postgresPathReportSources(app.db);
    if (format !== 'csv') return pathReportOf(sources, viewer, id);
    return sendCsv(reply, await pathReportCsvOf(sources, viewer, id));
  });
};

export default pathsRoutes;
