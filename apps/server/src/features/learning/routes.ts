import type { FastifyPluginAsync } from 'fastify';
import assignmentsRoutes from './assignments/routes';
import banksRoutes from './banks/routes';
import certificatesRoutes from './certificates/routes';
import coursesRoutes from './courses/routes';
import { errorReply, httpError } from './errors';
import helpRoutes from './help/routes';
import pathsRoutes from './paths/routes';
import progressRoutes from './progress/routes';
import reportsRoutes from './reports/routes';
import reviewsRoutes from './reviews/routes';

/**
 * The Learning API, registered by apps/server/src/app.ts under /api/learning. Each area has its own router in its
 * own folder (owners in docs/learning/PLAN.md) and adds its paths from docs/learning/api.md, so nobody edits
 * another area's file. Every error, including an unknown path, comes back as `{ error: { code, message } }`.
 */
const learningRoutes: FastifyPluginAsync = async (app) => {
  app.setErrorHandler((error, request, reply) => {
    const { status, body } = errorReply(error);
    if (status >= 500) request.log.error({ err: error }, 'Learning API request failed');
    return reply.code(status).send(body);
  });
  app.setNotFoundHandler((request, reply) => {
    const { status, body } = errorReply(httpError(404));
    return reply.code(status).send(body);
  });

  await app.register(coursesRoutes);
  await app.register(reviewsRoutes);
  await app.register(progressRoutes);
  await app.register(certificatesRoutes);
  await app.register(pathsRoutes);
  await app.register(assignmentsRoutes);
  await app.register(reportsRoutes);
  await app.register(banksRoutes);
  await app.register(helpRoutes, { prefix: '/help' });
  // TODO(#70): register B10's media routes here with { courses: { canSeeCourse, canEditCourse } } from ./courses/access.
};

export default learningRoutes;
