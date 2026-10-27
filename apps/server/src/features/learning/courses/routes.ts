import {
  CatalogQuerySchema,
  CreateBlockTemplateRequestSchema,
  CreateCourseRequestSchema,
  IdSchema,
  PublishRequestSchema,
  RollbackRequestSchema,
  SaveDraftRequestSchema,
} from '@carehub/learning';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requirePermission, viewerOf } from '../auth';
import { httpError, parseInput } from '../errors';
import * as courses from './service';
import * as templates from './templates';

const IdParams = z.object({ id: IdSchema });
const ArchivedQuery = z.object({ archived: z.enum(['true', 'false']).optional() });

// Courses (B1): Studio's course API and block templates (learning.build), and the catalog and live course for
// every member. Endpoints in docs/learning/api.md.
const coursesRoutes: FastifyPluginAsync = async (app) => {
  const build = { preHandler: requirePermission('learning.build') };
  const idOf = (request: FastifyRequest) => parseInput(IdParams, request.params).id;

  app.get('/studio/courses', build, async (request) => {
    const { archived } = parseInput(ArchivedQuery, request.query);
    return courses.listStudioCourses(app.db, viewerOf(request), { archived: archived === 'true' });
  });
  app.post('/studio/courses', build, async (request, reply) => {
    const input = parseInput(CreateCourseRequestSchema, request.body);
    return reply.code(201).send(await courses.createStudioCourse(app.db, viewerOf(request), input));
  });
  app.get('/studio/courses/:id', build, async (request) =>
    courses.getStudioCourse(app.db, viewerOf(request), idOf(request)),
  );
  app.put('/studio/courses/:id', build, async (request) => {
    const input = parseInput(SaveDraftRequestSchema, request.body);
    return courses.saveDraft(app.db, viewerOf(request), idOf(request), input);
  });
  app.post('/studio/courses/:id/publish', build, async (request) => {
    const input = parseInput(PublishRequestSchema, request.body);
    return courses.publishCourse(app.db, viewerOf(request), idOf(request), input);
  });
  app.get('/studio/courses/:id/versions', build, async (request) =>
    courses.listVersions(app.db, viewerOf(request), idOf(request)),
  );
  app.post('/studio/courses/:id/rollback', build, async (request) => {
    const input = parseInput(RollbackRequestSchema, request.body);
    return courses.rollBack(app.db, viewerOf(request), idOf(request), input);
  });

  app.post('/studio/courses/:id/duplicate', build, async (request, reply) => {
    const copy = await courses.duplicateCourse(app.db, viewerOf(request), idOf(request));
    return reply.code(201).send(copy);
  });
  app.post('/studio/courses/:id/archive', build, async (request) =>
    courses.setArchived(app.db, viewerOf(request), idOf(request), true),
  );
  app.post('/studio/courses/:id/unarchive', build, async (request) =>
    courses.setArchived(app.db, viewerOf(request), idOf(request), false),
  );
  app.get('/studio/examples', build, async () => courses.listExamples());

  app.get('/studio/block-templates', build, async (request) =>
    templates.listBlockTemplates(app.db, viewerOf(request)),
  );
  app.post('/studio/block-templates', build, async (request, reply) => {
    const input = parseInput(CreateBlockTemplateRequestSchema, request.body);
    const saved = await templates.createBlockTemplate(app.db, viewerOf(request), input);
    return reply.code(201).send(saved);
  });
  app.delete('/studio/block-templates/:id', build, async (request, reply) => {
    await templates.deleteBlockTemplate(app.db, viewerOf(request), idOf(request));
    return reply.code(204).send();
  });

  app.get('/catalog', async (request) => {
    const { workspaceId } = viewerOf(request);
    return courses.listCatalog(app.db, workspaceId, parseInput(CatalogQuerySchema, request.query));
  });
  // Hidden courses open by link too; drafts never do.
  app.get('/courses/:id', async (request) => {
    const live = await courses.getLiveCourse(app.db, viewerOf(request).workspaceId, idOf(request));
    if (!live) throw httpError(404);
    return live;
  });
};

export default coursesRoutes;
