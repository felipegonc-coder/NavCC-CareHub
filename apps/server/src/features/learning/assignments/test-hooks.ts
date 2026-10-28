import { IsoDateSchema } from '@carehub/learning';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requirePermission, viewerOf } from '../auth';
import { httpError, parseInput } from '../errors';
import { listAssignments, type AssignmentSources } from './service';

// A hook for the end-to-end tests (tests/e2e), there only when CAREHUB_TEST_HOOKS is "1", which no
// deploy file sets; without it, it's a 404. It moves a due date into the past, which the API
// refuses, so tests can make a course overdue. It needs learning.assign and reaches only the
// caller's workspace. The reminders job runs through the jobs runner's own hook instead:
// POST /api/jobs/test/periodic/learning.reminders { now? }, for site admins.

/** Whether the test hooks are on: only with CAREHUB_TEST_HOOKS=1. */
export const testHooksOn = (): boolean => process.env.CAREHUB_TEST_HOOKS === '1';

export type TestHooksOptions = { sources: AssignmentSources };

const DueDateSchema = z.object({ dueDate: IsoDateSchema });
const IdParams = z.object({ id: z.guid() });

const testHooks: FastifyPluginAsync<TestHooksOptions> = async (app, { sources }) => {
  app.log.warn('Learning: the e2e test hooks are on (CAREHUB_TEST_HOOKS=1). Never in production.');
  const assign = { preHandler: requirePermission('learning.assign') };

  // POST /test/assignments/:id {dueDate} → the assignment, due that day (any day) and not a number
  // of days after it's assigned.
  app.post('/test/assignments/:id', assign, async (request) => {
    const { id } = parseInput(IdParams, request.params);
    const { dueDate } = parseInput(DueDateSchema, request.body);
    const { workspaceId } = viewerOf(request);
    const changed = await sources.store.setDueDate(workspaceId, id, dueDate);
    if (!changed) throw httpError(404);
    const listed = await listAssignments(sources, workspaceId, changed.courseId);
    return listed.find((assignment) => assignment.id === id);
  });
};

export default testHooks;
