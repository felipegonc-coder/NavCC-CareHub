// The view query at /api/databases (decision 0200, W2-3): POST /:id/query { viewId, override?,
// search?, cursor? } answers a view for the signed-in person (see query.ts), and a view's first page
// emits databases.database.viewed.
import { idSchema, parseRequest, viewOverrideSchema } from '@carehub/databases/schemas';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { httpError } from '../../core/errors';
import { pageAccessOf } from '../pages';
import { invalidRequest, notFound } from './errors';
import { answerViewQuery } from './query';
import { loadDatabase } from './store';

declare module '../../core/events' {
  interface CareHubEvents {
    'databases.database.viewed': DatabaseViewedEvent;
  }
}

/** A view's first page was asked for (analytics and automations listen). */
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

function signedIn(request: FastifyRequest) {
  if (!request.user) throw httpError(401, 'signed_out');
  return request.user;
}

export default async function queryRoutes(app: FastifyInstance) {
  app.post('/:id/query', { preHandler: app.requirePageAccess('view') }, async (request) => {
    const user = signedIn(request);
    const parsed = parseRequest(viewQueryRequest, request.body);
    if (!parsed.ok) throw invalidRequest();
    const input = parsed.value;
    const page = pageAccessOf(request);
    if (page.kind !== 'database') throw notFound();
    const record = await loadDatabase(app.db, page.pageId);
    if (!record || record.inTrash) throw notFound();
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
    if (!('blocked' in answer) && !input.cursor) {
      app.events.emit('databases.database.viewed', {
        workspaceId: record.workspaceId,
        databaseId: record.id,
        viewId: view.id,
        userId: user.id,
      });
    }
    return answer;
  });
}
