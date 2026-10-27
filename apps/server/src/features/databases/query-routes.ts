// The view query at /api/databases (decision 0200, W2-3): POST /:id/query { viewId, override?,
// search?, cursor? } answers a view for the signed-in person (see query.ts), POST /:id/chart
// { viewId, override? } a Chart view's data (chart-query.ts), and GET /:id/rows/pick?q= the rows
// a relation picker lists (pick.ts). A view's first page, or its chart, emits
// databases.database.viewed.
import { idSchema, parseRequest, viewOverrideSchema } from '@carehub/databases/schemas';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { httpError } from '../../core/errors';
import { pageAccessOf } from '../pages';
import { answerChart } from './chart-query';
import { invalidRequest, notFound } from './errors';
import { pickRows } from './pick';
import { answerViewQuery } from './query';
import type { DatabaseRecord } from './record';
import { loadDatabase } from './store';

declare module '../../core/events' {
  interface CareHubEvents {
    'databases.database.viewed': DatabaseViewedEvent;
  }
}

/** A view's first page, or its chart, was asked for (analytics and automations listen). */
export interface DatabaseViewedEvent {
  workspaceId: string;
  databaseId: string;
  viewId: string;
  userId: string;
}

/** Characters in a toolbar search. */
export const SEARCH_LENGTH = 500;
/** Characters in a cursor (it carries its group and sub-group keys). */
export const CURSOR_LENGTH = 25_000;

/** POST /:id/query. `groupKey` (sent by the web for hidden groups) is accepted and not needed. */
export const viewQueryRequest = z.strictObject({
  viewId: idSchema,
  override: viewOverrideSchema.nullable().exactOptional(),
  search: z.string().max(SEARCH_LENGTH).nullable().exactOptional(),
  cursor: z.string().max(CURSOR_LENGTH).nullable().exactOptional(),
  groupKey: z.string().max(CURSOR_LENGTH).nullable().exactOptional(),
});

/** POST /:id/chart. */
export const chartRequest = z.strictObject({
  viewId: idSchema,
  override: viewOverrideSchema.nullable().exactOptional(),
});

/** GET /:id/rows/pick's query string. */
export const pickRequest = z.strictObject({
  q: z.string().max(SEARCH_LENGTH).exactOptional(),
});

function signedIn(request: FastifyRequest) {
  if (!request.user) throw httpError(401, 'signed_out');
  return request.user;
}

export default async function queryRoutes(app: FastifyInstance) {
  /** The database requirePageAccess found; 404 when the page isn't one, or it's in Trash. */
  async function databaseOf(request: FastifyRequest): Promise<DatabaseRecord> {
    const page = pageAccessOf(request);
    if (page.kind !== 'database') throw notFound();
    const record = await loadDatabase(app.db, page.pageId);
    if (!record || record.inTrash) throw notFound();
    return record;
  }

  const viewed = (record: DatabaseRecord, viewId: string, userId: string) =>
    app.events.emit('databases.database.viewed', {
      workspaceId: record.workspaceId,
      databaseId: record.id,
      viewId,
      userId,
    });

  app.post('/:id/query', { preHandler: app.requirePageAccess('view') }, async (request) => {
    const user = signedIn(request);
    const parsed = parseRequest(viewQueryRequest, request.body);
    if (!parsed.ok) throw invalidRequest();
    const input = parsed.value;
    const record = await databaseOf(request);
    const view = record.views.find((v) => v.id === input.viewId);
    if (!view) throw notFound();
    const answer = await answerViewQuery(app.db, {
      record,
      view,
      user,
      override: input.override ?? null,
      search: input.search ?? null,
      cursor: input.cursor ?? null,
    });
    if (!('blocked' in answer) && !input.cursor) viewed(record, view.id, user.id);
    return answer;
  });

  app.post('/:id/chart', { preHandler: app.requirePageAccess('view') }, async (request) => {
    const user = signedIn(request);
    const parsed = parseRequest(chartRequest, request.body);
    if (!parsed.ok) throw invalidRequest();
    const input = parsed.value;
    const record = await databaseOf(request);
    const view = record.views.find((v) => v.id === input.viewId);
    if (!view || view.layout !== 'chart') throw notFound();
    const answer = await answerChart(app.db, {
      record,
      view,
      user,
      override: input.override ?? null,
    });
    if (!('blocked' in answer)) viewed(record, view.id, user.id);
    return answer;
  });

  app.get('/:id/rows/pick', { preHandler: app.requirePageAccess('view') }, async (request) => {
    const user = signedIn(request);
    const parsed = parseRequest(pickRequest, request.query);
    if (!parsed.ok) throw invalidRequest();
    const record = await databaseOf(request);
    return pickRows(app.db, { databaseId: record.id, userId: user.id, q: parsed.value.q ?? null });
  });
}
