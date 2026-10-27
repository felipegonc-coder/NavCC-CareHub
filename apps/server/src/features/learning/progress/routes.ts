import {
  IdSchema,
  ProgressEventsRequestSchema,
  ProgressNoteRequestSchema,
  QuizAttemptStartRequestSchema,
} from '@carehub/learning';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requirePermission, viewerOf } from '../assignments/viewer';
import { parseInput } from '../errors';
import * as progress from './service';

const CourseParams = z.object({ id: IdSchema });
const QuizParams = z.object({ id: IdSchema, lessonId: IdSchema });
const PersonCourseParams = z.object({ personId: z.uuid(), courseId: IdSchema });

// Progress (B3): the learner's own events, state and quiz attempts, and resets and completions by
// people with learning.assign (decision 0312). Endpoints in docs/learning/api.md. Who is asking
// comes from assignments' stand-in for the courses server's ../auth (B1, #111).
const progressRoutes: FastifyPluginAsync = async (app) => {
  const assign = { preHandler: requirePermission('learning.assign') };
  const courseOf = (request: FastifyRequest) => parseInput(CourseParams, request.params).id;
  const personCourse = (request: FastifyRequest) => ({
    ...parseInput(PersonCourseParams, request.params),
    note: parseInput(ProgressNoteRequestSchema, request.body ?? {}).note,
  });

  app.get('/courses/:id/progress', async (request) =>
    progress.getProgress(app.db, viewerOf(request), courseOf(request)),
  );
  app.post('/courses/:id/events', async (request) => {
    const viewer = viewerOf(request);
    const { events } = parseInput(ProgressEventsRequestSchema, request.body);
    return progress.recordEvents(app.db, viewer, courseOf(request), events);
  });
  app.post('/courses/:id/quizzes/:lessonId/attempts', async (request) => {
    const viewer = viewerOf(request);
    const { id, lessonId } = parseInput(QuizParams, request.params);
    const { at } = parseInput(QuizAttemptStartRequestSchema, request.body);
    return progress.startQuizAttempt(app.db, viewer, id, { lessonId, at });
  });
  app.post('/people/:personId/courses/:courseId/reset', assign, async (request) => {
    const { personId, courseId, note } = personCourse(request);
    return progress.resetProgress(app.db, viewerOf(request), personId, courseId, note);
  });
  app.post('/people/:personId/courses/:courseId/complete', assign, async (request) => {
    const { personId, courseId, note } = personCourse(request);
    return progress.completeProgress(app.db, viewerOf(request), personId, courseId, note);
  });
};

export default progressRoutes;
