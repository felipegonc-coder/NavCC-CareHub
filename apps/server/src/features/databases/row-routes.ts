// Row routes at /api/databases (decision 0200): add a row, read and change one, change many, and
// move rows to Trash and back (Undo restores). Every write answers after its commit and then
// announces itself (events, a nudge on the `db:<databaseId>` live topic, Person notices). This
// plugin also registers the row resolver with the page model (#249 registers the `db` topic).
import type { AccessLevel, Viewer, WeekDay } from '@carehub/databases';
import { parseRequest, type RequestResult } from '@carehub/databases/schemas';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { httpError } from '../../core/errors';
import { getPageAccess, pageAccessOf } from '../pages';
import { invalidRequest, notFound } from './errors';
import type { DatabaseRecord } from './record';
import { registerRowAccess } from './row-access';
import { bulkValuesRequest, newRowRequest, rowIdsRequest, rowValuesRequest } from './row-requests';
import { rowAnswer } from './row-view';
import { addRow, changeRows, publishRowEffects, restoreRows, trashRows, type Actor } from './rows';
import { loadDatabase, loadPropertyViewer, loadRows } from './store';

/** The checked body, or 400 with the fixed message. */
function accept<T>(result: RequestResult<T>): T {
  if (!result.ok) throw invalidRequest();
  return result.value;
}

type SignedIn = NonNullable<FastifyRequest['user']>;

function signedIn(request: FastifyRequest): SignedIn {
  if (!request.user) throw httpError(401, 'signed_out');
  return request.user;
}

/** The person's settings, as the package's presets and filters read them. */
const viewerOf = (user: SignedIn): Viewer => ({
  userId: user.id,
  timeZone: user.timeZone,
  weekStart: user.weekStart as WeekDay,
  hour12: !user.use24h,
  now: new Date(),
});

const rowIdOf = (request: FastifyRequest) => (request.params as { rowId?: unknown }).rowId;

export default async function rowRoutes(app: FastifyInstance) {
  registerRowAccess();

  /** The database checked by requirePageAccess, and the person's level on it. */
  async function database(request: FastifyRequest) {
    const page = pageAccessOf(request);
    if (page.kind !== 'database') throw notFound();
    const record = await loadDatabase(app.db, page.pageId);
    if (!record || record.inTrash) throw notFound();
    return { record, level: page.level };
  }

  /** The row checked by requirePageAccess, which must be a row (not in Trash) of database :id. */
  async function row(request: FastifyRequest) {
    const page = pageAccessOf(request);
    const { id } = request.params as { id?: unknown };
    if (page.kind !== 'row' || typeof id !== 'string') throw notFound();
    const record = await loadDatabase(app.db, id);
    if (!record || record.inTrash) throw notFound();
    const [found] = await loadRows(app.db, record.id, [page.pageId]);
    if (!found) throw notFound();
    return { record, row: found, level: page.level };
  }

  async function actorOf(request: FastifyRequest, record: DatabaseRecord): Promise<Actor> {
    const user = signedIn(request);
    const propertyViewer = await loadPropertyViewer(app.db, user.id, record.workspaceId);
    return { viewer: viewerOf(user), propertyViewer, source: 'user' };
  }

  /** The row as the person may see it now. */
  async function answer(
    record: DatabaseRecord,
    rowId: string,
    viewer: Viewer,
    level?: AccessLevel,
  ) {
    const [found] = await loadRows(app.db, record.id, [rowId]);
    if (!found) throw notFound();
    const access = level ?? (await getPageAccess(app.db, viewer.userId, rowId));
    return rowAnswer(app.db, { record, row: found, viewer, access });
  }

  app.post('/:id/rows', { preHandler: app.requirePageAccess('view') }, async (request, reply) => {
    const { record, level } = await database(request);
    const input = accept(parseRequest(newRowRequest, request.body));
    const actor = await actorOf(request, record);
    const { rowId, effects } = await addRow(app.db, record, input, actor, level);
    await publishRowEffects(app, effects);
    return reply.code(201).send(await answer(record, rowId, actor.viewer));
  });

  app.get(
    '/:id/rows/:rowId',
    { preHandler: app.requirePageAccess('view', rowIdOf) },
    async (request) => {
      const found = await row(request);
      return answer(found.record, found.row.id, viewerOf(signedIn(request)), found.level);
    },
  );

  app.patch(
    '/:id/rows/:rowId',
    { preHandler: app.requirePageAccess('view', rowIdOf) },
    async (request) => {
      const found = await row(request);
      const input = accept(parseRequest(rowValuesRequest, request.body));
      const actor = await actorOf(request, found.record);
      const { effects } = await changeRows(
        app.db,
        found.record,
        [found.row.id],
        input.values,
        actor,
      );
      await publishRowEffects(app, effects);
      return answer(found.record, found.row.id, actor.viewer);
    },
  );

  app.post('/:id/rows/bulk', { preHandler: app.requirePageAccess('view') }, async (request) => {
    const { record } = await database(request);
    const input = accept(parseRequest(bulkValuesRequest, request.body));
    const actor = await actorOf(request, record);
    const { rowIds, effects } = await changeRows(app.db, record, input.rowIds, input.values, actor);
    await publishRowEffects(app, effects);
    return { rowIds };
  });

  app.post('/:id/rows/trash', { preHandler: app.requirePageAccess('view') }, async (request) => {
    const { record } = await database(request);
    const input = accept(parseRequest(rowIdsRequest, request.body));
    const user = signedIn(request);
    const { rowIds, effects } = await trashRows(app.db, record, input.rowIds, user.id);
    await publishRowEffects(app, effects);
    return { rowIds };
  });

  app.post('/:id/rows/restore', { preHandler: app.requirePageAccess('view') }, async (request) => {
    const { record, level } = await database(request);
    const input = accept(parseRequest(rowIdsRequest, request.body));
    const user = signedIn(request);
    const { rowIds, effects } = await restoreRows(app.db, record, input.rowIds, user.id, level);
    await publishRowEffects(app, effects);
    return { rowIds };
  });
}
