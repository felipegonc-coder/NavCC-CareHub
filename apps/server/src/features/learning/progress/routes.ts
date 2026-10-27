import { IdSchema, ProgressEventsRequestSchema } from '@carehub/learning';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { viewerOf } from '../assignments/viewer';
import { parseInput } from '../errors';
import * as progress from './service';

const CourseParams = z.object({ id: IdSchema });

// Progress (B3): the learner's own events and state. Endpoints in docs/learning/api.md. Who is
// asking comes from assignments' stand-in for the courses server's ../auth (B1, #111).
const progressRoutes: FastifyPluginAsync = async (app) => {
  const courseOf = (request: FastifyRequest) => parseInput(CourseParams, request.params).id;

  app.get('/courses/:id/progress', async (request) =>
    progress.getProgress(app.db, viewerOf(request), courseOf(request)),
  );
  app.post('/courses/:id/events', async (request) => {
    const viewer = viewerOf(request);
    const { events } = parseInput(ProgressEventsRequestSchema, request.body);
    return progress.recordEvents(app.db, viewer, courseOf(request), events);
  });
};

export default progressRoutes;
