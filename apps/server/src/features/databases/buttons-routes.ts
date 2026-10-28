// Button routes at /api/databases (decision 0200): press a Button property on a row, undo a run
// within 8 seconds (only the person who pressed), and a button's run log.
import { LIMITS, type Viewer, type WeekDay } from '@carehub/databases';
import { parseRequest } from '@carehub/databases/schemas';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { httpError } from '../../core/errors';
import { pageAccessOf } from '../pages';
import { buttonOf, listRuns, pressButton, undoRun } from './button-runs';
import { invalidRequest, notFound } from './errors';
import { loadDatabase, loadRows } from './store';

/** POST /:id/rows/:rowId/buttons/:pid: Continue on a confirmation presses again, one higher. */
export const pressRequest = z.strictObject({
  confirmed: z.number().int().min(0).max(LIMITS.buttonActions).optional(),
});

type SignedIn = NonNullable<FastifyRequest['user']>;

function signedIn(request: FastifyRequest): SignedIn {
  if (!request.user) throw httpError(401, 'signed_out');
  return request.user;
}

const viewerOf = (user: SignedIn): Viewer => ({
  userId: user.id,
  timeZone: user.timeZone,
  weekStart: user.weekStart as WeekDay,
  hour12: !user.use24h,
  now: new Date(),
});

const rowIdOf = (request: FastifyRequest) => (request.params as { rowId?: unknown }).rowId;
const paramsOf = (request: FastifyRequest) =>
  request.params as { id?: unknown; pid?: unknown; runId?: unknown };

export async function buttonRoutes(app: FastifyInstance) {
  /** The database checked by requirePageAccess (not in Trash). */
  async function database(request: FastifyRequest) {
    const page = pageAccessOf(request);
    if (page.kind !== 'database') throw notFound();
    const record = await loadDatabase(app.db, page.pageId);
    if (!record || record.inTrash) throw notFound();
    return record;
  }

  app.post(
    '/:id/rows/:rowId/buttons/:pid',
    { preHandler: [app.requireMember, app.requirePageAccess('view', rowIdOf)] },
    async (request) => {
      const user = signedIn(request);
      const body = parseRequest(pressRequest, request.body ?? {});
      if (!body.ok) throw invalidRequest();
      const page = pageAccessOf(request);
      const { id, pid } = paramsOf(request);
      if (page.kind !== 'row' || typeof id !== 'string') throw notFound();
      const record = await loadDatabase(app.db, id);
      if (!record || record.inTrash) throw notFound();
      const [row] = await loadRows(app.db, record.id, [page.pageId]);
      if (!row) throw notFound();
      return pressButton(app, {
        record,
        row,
        rowLevel: page.level,
        button: buttonOf(record, pid),
        presser: viewerOf(user),
        presserName: user.name,
        confirmed: body.value.confirmed ?? 0,
      });
    },
  );

  app.post(
    '/:id/button-runs/:runId/undo',
    { preHandler: [app.requireMember, app.requirePageAccess('view')] },
    async (request) => {
      const user = signedIn(request);
      const record = await database(request);
      return undoRun(app, {
        databaseId: record.id,
        runId: paramsOf(request).runId,
        userId: user.id,
      });
    },
  );

  app.get(
    '/:id/buttons/:pid/runs',
    { preHandler: [app.requireMember, app.requirePageAccess('edit')] },
    async (request) => {
      const record = await database(request);
      const button = buttonOf(record, paramsOf(request).pid);
      return { runs: await listRuns(app.db, record.id, button.id) };
    },
  );
}
