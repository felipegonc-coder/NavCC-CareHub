import { AssignmentListQuerySchema, CreateAssignmentsRequestSchema } from '@carehub/learning';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { registerPeriodicTask } from '../../jobs';
import { requirePermission, viewerOf } from '../auth';
import { learningToday } from '../day';
import { parseInput } from '../errors';
import {
  bindAssignmentSources,
  boundAssignmentSources,
  createAssignments,
  deleteAssignment,
  listAssignments,
  myLearningFor,
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

export type AssignmentsRoutesOptions = {
  sources?: AssignmentSources;
  /** Notices and the reminders job: on the database by default, none with other `sources`. */
  reminders?: ReminderSources;
};

const IdParams = z.object({ id: z.guid() });

// Assignments (learning.assign) and My learning (every member). Endpoints in docs/learning/api.md.
// "Today" is the Learning day (decision 0317), the same for everyone. The routes also bind their
// sources for public.ts while the server runs, run the reminders job and tell people at once what
// they were assigned. With CAREHUB_TEST_HOOKS=1 (end-to-end tests only) they add test-hooks.ts.
const assignmentsRoutes: FastifyPluginAsync<AssignmentsRoutesOptions> = async (app, options) => {
  const sources = options.sources ?? postgresSources(app.db);
  bindAssignmentSources(sources);
  app.addHook('onClose', async () => {
    if (boundAssignmentSources() === sources) bindAssignmentSources(null);
  });
  const reminders =
    options.reminders ??
    (options.sources === undefined ? postgresReminderSources(app.db, sources) : undefined);
  if (reminders) {
    // Hourly in the jobs runner, as of the time the runner gives; its test hook, POST
    // /api/jobs/test/periodic/learning.reminders { now? }, runs it at once. Only the app whose
    // sources are bound sends (tests start many).
    registerPeriodicTask(REMINDERS_TASK, REMINDERS_EVERY_MS, async ({ signal, now }) => {
      if (boundAssignmentSources() === sources) await sendReminders(reminders, now, signal);
    });
  }
  if (testHooksOn()) await app.register(testHooks, { sources });
  const assign = { preHandler: requirePermission('learning.assign') };

  app.get('/me', async (request) => myLearningFor(sources, viewerOf(request), learningToday()));

  app.get('/assignments', assign, async (request) => {
    const { courseId } = parseInput(AssignmentListQuerySchema, request.query);
    return listAssignments(sources, viewerOf(request).workspaceId, courseId);
  });
  app.post('/assignments', assign, async (request, reply) => {
    const input = parseInput(CreateAssignmentsRequestSchema, request.body);
    const viewer = viewerOf(request);
    const made = await createAssignments(sources, viewer, input, learningToday());
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
