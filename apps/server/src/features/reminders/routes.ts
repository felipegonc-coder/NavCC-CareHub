// /api/reminders: the signed-in person's own reminders (Home and reminders spec). It also binds
// what sends them: the Postgres store and the `reminders.fire` job.
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { httpError } from '../../core/errors';
import { registerJobHandler, scheduleJob } from '../jobs';
import { publishToUsers } from '../live';
import { sendNotice } from '../notices';
import { createReminderSchema, toReminderView, updateReminderSchema } from './domain/rules';
import {
  bindReminders,
  createReminder,
  deleteReminder,
  FIRE_JOB,
  fireReminder,
  listReminders,
  updateReminder,
  type FirePayload,
  type RemindersRuntime,
} from './service';
import { postgresReminderStore } from './store';
import type { Viewer } from './types';

/** Stand-in until accounts add `request.member`: everyone is in this one workspace. */
export const STAND_IN_WORKSPACE_ID = '00000000-0000-4000-8000-000000000000';

export interface RemindersRoutesOptions {
  /** Defaults to everyone opening every page, until pages land with `getPageAccess`. */
  canOpenPage?: RemindersRuntime['canOpenPage'];
}

function viewerOf(request: FastifyRequest): Viewer {
  const { user } = request;
  if (!user) throw httpError(401, 'signed_out');
  const member = (request as { member?: { workspaceId: string } | null }).member;
  return {
    userId: user.id,
    workspaceId: member?.workspaceId ?? STAND_IN_WORKSPACE_ID,
    timeZone: user.timeZone,
    use24h: user.use24h,
  };
}

const params = z.object({ id: z.string() });

const remindersRoutes: FastifyPluginAsync<RemindersRoutesOptions> = async (app, options) => {
  const unbind = bindReminders({
    store: postgresReminderStore,
    // Outside the caller's transaction until jobs takes `{ db }`.
    scheduleJob: (input) => scheduleJob(input),
    sendNotice,
    publish: publishToUsers,
    canOpenPage: options.canOpenPage ?? (async () => true),
  });
  app.addHook('onClose', async () => unbind());
  // Never skipped (HR-11): retries go on for about a day.
  registerJobHandler<FirePayload>(FIRE_JOB, (payload) => fireReminder(app.db, payload), {
    maxAttempts: 25,
  });

  app.get('/', async (request) => {
    const { pending, sent } = await listReminders(app.db, viewerOf(request));
    return { pending: pending.map(toReminderView), sent: sent.map(toReminderView) };
  });

  app.post('/', async (request, reply) => {
    const input = createReminderSchema.parse(request.body);
    const reminder = await createReminder(app.db, viewerOf(request), input);
    return reply.code(201).send({ reminder: toReminderView(reminder) });
  });

  app.patch('/:id', async (request) => {
    const { id } = params.parse(request.params);
    const input = updateReminderSchema.parse(request.body);
    return { reminder: toReminderView(await updateReminder(app.db, viewerOf(request), id, input)) };
  });

  app.delete('/:id', async (request, reply) => {
    const { id } = params.parse(request.params);
    await deleteReminder(app.db, viewerOf(request), id);
    return reply.code(204).send();
  });
};

export default remindersRoutes;
