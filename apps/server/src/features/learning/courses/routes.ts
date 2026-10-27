import {
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

const IdParams = z.object({ id: IdSchema });
const ArchivedQuery = z.object({ archived: z.enum(['true', 'false']).optional() });

// Courses (B1): Studio's course API (learning.build) and the live course for anyone signed in.
// Endpoints in docs/learning/api.md.
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

  // Hidden courses open by link too; drafts never do.
  app.get('/courses/:id', async (request) => {
    const live = await courses.getLiveCourse(app.db, viewerOf(request).workspaceId, idOf(request));
    if (!live) throw httpError(404);
    return live;
  });
};

export default coursesRoutes;
