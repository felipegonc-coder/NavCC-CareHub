// Applying a database template to a row (Templates and buttons 3.2 and 5, TB-06):
// POST /api/databases/:id/templates/:tid/apply { rowId, replace }, from the "Start with" list on an
// empty row page or Apply template in a row's page menu. The template's values fill only the row's
// empty properties (an unticked checkbox and the default status count as empty) unless `replace`
// ("Replace values") is on; Today, Now and Me become this person's, This page this row. It needs
// Can edit content on the row; the properties they may not change are left as they are. The
// values are one row update with source 'template'. Adding the template's content at the end, and
// saving a version first, come with core pages.
import {
  titleProperty,
  type AccessLevel,
  type Id,
  type Property,
  type Row,
  type RowTemplate,
  type Viewer,
  type WeekDay,
} from '@carehub/databases';
import { can, type PropertyViewer } from '@carehub/databases/access';
import { parseRequest } from '@carehub/databases/schemas';
import { applyTemplateValues } from '@carehub/databases/templates';
import { sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { httpError } from '../../core/errors';
import { getPageAccess, pageAccessOf } from '../pages';
import { runRowWrites, updateRows } from './api';
import { forbidden, invalidRequest, notFound } from './errors';
import type { DatabaseRecord } from './record';
import { pageIdSchema } from './requests';
import { checkPresets } from './row-logic';
import { rowAnswer } from './row-view';
import { loadDatabase, loadPropertyViewer, loadRows } from './store';

/** POST /:id/templates/:tid/apply: the row, and whether the template's values replace the row's. */
export const applyTemplateRequest = z.strictObject({
  rowId: pageIdSchema,
  replace: z.boolean().optional(),
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

/**
 * What applying `template` to `row` writes for this person, by property id (the Name property's id
 * for a new title): the package's changes, kept only where they may change the property (`level` is
 * theirs on the row) and the value still fits.
 */
export function templateChanges(input: {
  properties: readonly Property[];
  row: Pick<Row, 'id' | 'title' | 'values'>;
  template: Pick<RowTemplate, 'values'>;
  replace: boolean;
  viewer: Pick<Viewer, 'userId' | 'timeZone' | 'now'>;
  propertyViewer: PropertyViewer;
  level: AccessLevel;
}): Record<Id, unknown> {
  const { properties, viewer } = input;
  const patch = applyTemplateValues(input.row, input.template, {
    replace: input.replace,
    properties,
    viewer: { userId: viewer.userId, timeZone: viewer.timeZone, now: viewer.now },
  });
  const nameId = titleProperty(properties).id;
  const wanted =
    patch.title === undefined ? patch.values : { ...patch.values, [nameId]: patch.title };
  const kept = checkPresets(wanted, properties, input.propertyViewer, input.level);
  return kept.title === undefined ? kept.values : { ...kept.values, [nameId]: kept.title };
}

export interface ApplyTemplateInput {
  record: DatabaseRecord;
  templateId: unknown;
  rowId: string;
  replace: boolean;
  viewer: Viewer;
}

/**
 * Applies a template of the database to one of its rows and answers the row as PATCH does. 404 when
 * the template or the row (in this database, not in Trash) is missing; 403 without Can edit content
 * on the row. The row is locked while its values are read and written.
 */
export async function applyTemplate(app: FastifyInstance, input: ApplyTemplateInput) {
  const { record, viewer } = input;
  const template = record.templates.find((t) => t.id === input.templateId);
  if (!template) throw notFound();
  const [found] = await loadRows(app.db, record.id, [input.rowId]);
  if (!found) throw notFound();
  const level = await getPageAccess(app.db, viewer.userId, found.id);
  if (!can('use_templates', level, { locked: record.locked })) throw forbidden();
  const propertyViewer = await loadPropertyViewer(app.db, viewer.userId, record.workspaceId);
  await runRowWrites(app, async (tx) => {
    await tx.execute(sql`SELECT 1 FROM db_rows WHERE page_id = ${found.id} FOR UPDATE`);
    const [row] = await loadRows(tx, record.id, [found.id]);
    if (!row) throw notFound();
    const values = templateChanges({
      properties: record.properties,
      row,
      template,
      replace: input.replace,
      viewer,
      propertyViewer,
      level,
    });
    if (Object.keys(values).length === 0) return;
    await updateRows(tx, {
      databaseId: record.id,
      rowIds: [row.id],
      values,
      actorUserId: viewer.userId,
      source: 'template',
    });
  });
  const [saved] = await loadRows(app.db, record.id, [found.id]);
  if (!saved) throw notFound();
  return rowAnswer(app.db, { record, row: saved, viewer, access: level });
}

export async function templateRoutes(app: FastifyInstance) {
  app.post(
    '/:id/templates/:tid/apply',
    { preHandler: app.requirePageAccess('view') },
    async (request) => {
      const user = signedIn(request);
      const body = parseRequest(applyTemplateRequest, request.body ?? {});
      if (!body.ok) throw invalidRequest();
      const page = pageAccessOf(request);
      if (page.kind !== 'database') throw notFound();
      const record = await loadDatabase(app.db, page.pageId);
      if (!record || record.inTrash) throw notFound();
      return applyTemplate(app, {
        record,
        templateId: (request.params as { tid?: unknown }).tid,
        rowId: body.value.rowId,
        replace: body.value.replace ?? false,
        viewer: viewerOf(user),
      });
    },
  );
}
