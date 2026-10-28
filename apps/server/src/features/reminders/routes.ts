// /api/reminders: the signed-in person's own reminders (Home and reminders spec). It also binds
// what sends them: the store, the `reminders.fire` job and the Snooze and Done buttons.
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { httpError } from '../../core/errors';
import { registerJobHandler, scheduleJob } from '../jobs';
import { publishToUsers } from '../live';
import { registerNoticeAction, sendNotice } from '../notices';
import { DONE_ACTION, SNOOZE_ACTION } from './domain/notice';
import { createReminderSchema, updateReminderSchema } from './domain/rules';
import {
  bindReminders,
  createReminder,
  deleteReminder,
  doneFromNotice,
  FIRE_JOB,
  fireReminder,
  listReminders,
  snoozeFromNotice,
  updateReminder,
  viewsOf,
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
    scheduleJob,
    sendNotice,
    publish: publishToUsers,
    canOpenPage: options.canOpenPage ?? (async () => true),
  });
  app.addHook('onClose', async () => unbind());
  // Never skipped (HR-11): retries go on for about a day.
  registerJobHandler<FirePayload>(FIRE_JOB, (payload) => fireReminder(app.db, payload), {
    maxAttempts: 25,
  });
  registerNoticeAction(SNOOZE_ACTION, (context) => snoozeFromNotice(app.db, context));
  registerNoticeAction(DONE_ACTION, (context) => doneFromNotice(app.db, context));

  app.get('/', async (request) => {
    const viewer = viewerOf(request);
    const { pending, sent } = await listReminders(app.db, viewer);
    const views = await viewsOf(app.db, viewer, [...pending, ...sent]);
    return { pending: views.slice(0, pending.length), sent: views.slice(pending.length) };
  });

  app.post('/', async (request, reply) => {
    const viewer = viewerOf(request);
    const input = createReminderSchema.parse(request.body);
    const reminder = await createReminder(app.db, viewer, input);
    const [view] = await viewsOf(app.db, viewer, [reminder]);
    return reply.code(201).send({ reminder: view });
  });

  app.patch('/:id', async (request) => {
    const viewer = viewerOf(request);
    const { id } = params.parse(request.params);
    const input = updateReminderSchema.parse(request.body);
    const [view] = await viewsOf(app.db, viewer, [await updateReminder(app.db, viewer, id, input)]);
    return { reminder: view };
  });

  app.delete('/:id', async (request, reply) => {
    const { id } = params.parse(request.params);
    await deleteReminder(app.db, viewerOf(request), id);
    return reply.code(204).send();
  });
};

export default remindersRoutes;
