import { AssignmentListQuerySchema, CreateAssignmentsRequestSchema } from '@carehub/learning';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { registerPeriodicTask } from '../../jobs';
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
import {
  REMINDERS_EVERY_MS,
  REMINDERS_TASK,
  sendAssignedNotices,
  sendReminders,
  type ReminderSources,
} from './reminders';
import { postgresReminderSources } from './reminders-store';
import { postgresSources } from './sources';
import testHooks, { testHooksOn } from './test-hooks';
import { requirePermission, viewerOf } from './viewer';

export type AssignmentsRoutesOptions = {
  sources?: AssignmentSources;
  /** What the "assigned" notices use; on the database by default, none with other `sources`. */
  reminders?: ReminderSources;
};

const IdParams = z.object({ id: z.guid() });

/** Today for the signed-in person, in the time zone from their profile. */
const todayFor = (request: FastifyRequest) => todayIn(request.user?.timeZone);

// Assignments (learning.assign) and My learning (every member), B4. Endpoints in
// docs/learning/api.md. The routes also bind their sources for public.ts while the server runs, and
// on the database they start the reminders job and tell people at once what they were assigned.
// With CAREHUB_TEST_HOOKS=1 (end-to-end tests only) they add the test hooks in test-hooks.ts.
const assignmentsRoutes: FastifyPluginAsync<AssignmentsRoutesOptions> = async (app, options) => {
  const sources = options.sources ?? postgresSources(app.db);
  bindAssignmentSources(sources);
  app.addHook('onClose', async () => {
    if (boundAssignmentSources() === sources) bindAssignmentSources(null);
  });
  const reminders =
    options.reminders ??
    (options.sources === undefined ? postgresReminderSources(app.db, sources) : undefined);
  if (options.sources === undefined && reminders) {
    // The reminders run in the jobs runner, and only while this app does (tests start many).
    registerPeriodicTask(REMINDERS_TASK, REMINDERS_EVERY_MS, async ({ signal }) => {
      if (boundAssignmentSources() === sources) await sendReminders(reminders, new Date(), signal);
    });
  }
  if (testHooksOn()) await app.register(testHooks, { sources, reminders });
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
    const viewer = viewerOf(request);
    const made = await createAssignments(sources, viewer, input, todayFor(request).today);
    if (reminders) {
      // The assignments stand even when a notice can't go out: the reminders job sends it later.
      const ids = made.map((assignment) => assignment.id);
      await sendAssignedNotices(reminders, viewer.workspaceId, ids).catch((error: unknown) =>
        request.log.error({ err: error }, 'Learning: the "assigned" notices did not all go out'),
      );
    }
    return reply.code(201).send(made);
  });
  app.delete('/assignments/:id', assign, async (request, reply) => {
    const { id } = parseInput(IdParams, request.params);
    await deleteAssignment(sources, viewerOf(request).workspaceId, id);
    return reply.code(204).send();
  });
};

export default assignmentsRoutes;
