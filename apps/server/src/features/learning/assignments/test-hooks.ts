import { IsoDateSchema, IsoDateTimeSchema } from '@carehub/learning';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { httpError, parseInput } from '../errors';
import { sendReminders, type ReminderSources } from './reminders';
import { listAssignments, type AssignmentSources } from './service';
import { requirePermission, viewerOf } from './viewer';

// Hooks for the end-to-end tests (tests/e2e), there only when CAREHUB_TEST_HOOKS is "1", which no
// deploy file sets; without it they are 404s. One runs the reminders job now, as if it were `now`;
// the other moves a due date into the past, which the API refuses, so tests can make a course
// overdue. Both need learning.assign and reach only the caller's workspace.

/** Whether the test hooks are on: only with CAREHUB_TEST_HOOKS=1. */
export const testHooksOn = (): boolean => process.env.CAREHUB_TEST_HOOKS === '1';

export type TestHooksOptions = {
  sources: AssignmentSources;
  /** The reminders job's sources; without them the job sends nothing. */
  reminders: ReminderSources | undefined;
};

const RunRemindersSchema = z.object({ now: IsoDateTimeSchema.optional() });
const DueDateSchema = z.object({ dueDate: IsoDateSchema });
const IdParams = z.object({ id: z.guid() });

const testHooks: FastifyPluginAsync<TestHooksOptions> = async (app, { sources, reminders }) => {
  app.log.warn('Learning: the e2e test hooks are on (CAREHUB_TEST_HOOKS=1). Never in production.');
  const assign = { preHandler: requirePermission('learning.assign') };

  // POST /test/reminders {now?} → {sent}: the hourly job for the caller's workspace only.
  app.post('/test/reminders', assign, async (request) => {
    const { now } = parseInput(RunRemindersSchema, request.body ?? {});
    const { workspaceId } = viewerOf(request);
    if (!reminders) return { sent: 0 };
    const scoped: ReminderSources = { ...reminders, workspaces: async () => [workspaceId] };
    return { sent: await sendReminders(scoped, now === undefined ? new Date() : new Date(now)) };
  });

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
