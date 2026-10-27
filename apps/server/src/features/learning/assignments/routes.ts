import { AssignmentListQuerySchema, CreateAssignmentsRequestSchema } from '@carehub/learning';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requirePermission, viewerOf } from '../auth';
import { parseInput } from '../errors';
import {
  bindAssignmentSources,
  boundAssignmentSources,
  createAssignments,
  deleteAssignment,
  listAssignments,
  myLearningFor,
  todayIn,
  type AssignmentSources,
} from './service';
import { postgresSources } from './sources';

export type AssignmentsRoutesOptions = { sources?: AssignmentSources };

const IdParams = z.object({ id: z.guid() });

/** Today for the signed-in person, in the time zone from their profile. */
function todayFor(request: FastifyRequest): { today: string; timeZone: string } {
  const { user } = request as { user?: { timeZone?: unknown } | null };
  return todayIn(typeof user?.timeZone === 'string' ? user.timeZone : undefined);
}

// Assignments (learning.assign) and My learning (every member), B4. Endpoints in
// docs/learning/api.md. The routes also bind their sources for public.ts while the server runs.
const assignmentsRoutes: FastifyPluginAsync<AssignmentsRoutesOptions> = async (app, options) => {
  const sources = options.sources ?? postgresSources(app.db);
  bindAssignmentSources(sources);
  app.addHook('onClose', async () => {
    if (boundAssignmentSources() === sources) bindAssignmentSources(null);
  });
  const assign = { preHandler: requirePermission('learning.assign') };

  app.get('/me', async (request) => {
    const { today, timeZone } = todayFor(request);
    return myLearningFor(sources, viewerOf(request), today, timeZone);
  });

  app.get('/assignments', assign, async (request) => {
    const { courseId } = parseInput(AssignmentListQuerySchema, request.query);
    return listAssignments(sources, viewerOf(request).workspaceId, courseId);
  });
  app.post('/assignments', assign, async (request, reply) => {
    const input = parseInput(CreateAssignmentsRequestSchema, request.body);
    const { today } = todayFor(request);
    return reply.code(201).send(await createAssignments(sources, viewerOf(request), input, today));
  });
  app.delete('/assignments/:id', assign, async (request, reply) => {
    const { id } = parseInput(IdParams, request.params);
    await deleteAssignment(sources, viewerOf(request).workspaceId, id);
    return reply.code(204).send();
  });
};

export default assignmentsRoutes;
