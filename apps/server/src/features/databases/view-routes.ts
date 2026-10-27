// View routes (decision 0200; Databases spec 3.3): add, change, delete, duplicate and order a
// database's views. Each is a settings write: it sends `version`, locks the database's row and
// answers like GET /:id with the new version, plus `viewId` for a new or duplicated view. A form's
// link code is kept in forms_links too: made with the form (or its copy), revoked when it's deleted.
import { randomBytes } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { Id, View } from '@carehub/databases';
import { parseRequest } from '@carehub/databases/schemas';
import { sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Tx } from '../../db';
import { notFound } from './errors';
import {
  accept,
  allow,
  answerFor,
  databasePage,
  hiddenProperties,
  signedIn,
  versionOf,
} from './http';
import {
  newViewRequest,
  versionRequest,
  viewChangeRequest,
  viewOrderRequest,
  type ViewChangeRequest,
} from './requests';
import { changeDatabase } from './store';
import {
  hasOpenFormAccess,
  planDeleteView,
  planDuplicateView,
  planEditView,
  planNewView,
  planViewOrder,
  type ViewPatch,
} from './views';

/** A form link's secret part: 16 random bytes as base64url (the decision's security conditions). */
export const newLinkCode = (): string => randomBytes(16).toString('base64url');

const viewIdOf = (request: FastifyRequest): string => {
  const params = request.params as { vid?: unknown };
  if (typeof params.vid !== 'string') throw notFound();
  return params.vid;
};

/** The sent settings (a checked body never holds undefined). */
const patchOf = (sent: Omit<ViewChangeRequest, 'version'>): ViewPatch =>
  Object.fromEntries(Object.entries(sent).filter(([, value]) => value !== undefined)) as ViewPatch;

/** Keeps a new form's link code, so the forms API finds the form by it. */
export async function keepLinkCode(tx: Tx, databaseId: Id, view: View): Promise<void> {
  if (!view.form) return;
  await tx.execute(sql`
    INSERT INTO forms_links (code, database_id, view_id)
    VALUES (${view.form.linkCode}, ${databaseId}, ${view.id})`);
}

/** Revokes the link codes of deleted forms. */
async function revokeLinkCodes(tx: Tx, databaseId: Id, viewIds: readonly Id[]): Promise<void> {
  if (viewIds.length === 0) return;
  const ids = sql.join(
    viewIds.map((id) => sql`${id}`),
    sql`, `,
  );
  await tx.execute(sql`
    UPDATE forms_links SET revoked_at = now()
    WHERE database_id = ${databaseId} AND revoked_at IS NULL
      AND view_id = ANY(ARRAY[${ids}]::text[])`);
}

export function registerViewRoutes(app: FastifyInstance): void {
  const edit = { preHandler: app.requirePageAccess('edit') };

  // A new view with its layout's defaults, or a dashboard tile; a form gets its link code.
  app.post('/:id/views', edit, async (request) => {
    const page = databasePage(request);
    const { version, ...input } = accept(parseRequest(newViewRequest, request.body));
    let viewId = '';
    const record = await changeDatabase(app.db, page.id, version, async (current, tx) => {
      allow('edit_views', page.level, current.locked);
      if (input.layout === 'form') allow('edit_forms', page.level, current.locked);
      const linkCode = input.layout === 'form' ? newLinkCode() : undefined;
      const plan = planNewView(current, { ...input, linkCode });
      await keepLinkCode(tx, current.id, plan.view);
      viewId = plan.view.id;
      return { views: plan.views };
    });
    return { ...(await answerFor(app.db, request, record, page.level)), viewId };
  });

  // Any settings but the view's id, dashboard and manual order. A form's gates (who answers,
  // anonymous, open or closed) take Full access and aren't stopped by Lock structure.
  app.patch('/:id/views/:vid', edit, async (request) => {
    const page = databasePage(request);
    const user = signedIn(request);
    const viewId = viewIdOf(request);
    const { version, ...sent } = accept(parseRequest(viewChangeRequest, request.body));
    const patch = patchOf(sent);
    const record = await changeDatabase(app.db, page.id, version, async (current, tx) => {
      // Say "locked" before checking settings when it's plainly more than a form's gates.
      if (Object.keys(patch).some((key) => key !== 'form')) {
        allow('edit_views', page.level, current.locked);
      }
      const hidden = await hiddenProperties(tx, user.id, current);
      const plan = planEditView(current, viewId, patch, { userId: user.id, hidden });
      if (plan.structure) allow('edit_views', page.level, current.locked);
      if (plan.structure && plan.view.form) allow('edit_forms', page.level, current.locked);
      if (plan.formAccess) allow('manage_form_access', page.level, current.locked);
      if (plan.formResponses) allow('toggle_responses', page.level, current.locked);
      return isDeepStrictEqual(plan.view, plan.before) ? {} : { views: plan.views };
    });
    return answerFor(app.db, request, record, page.level);
  });

  // A view, or a dashboard and its tiles; never the last view tab. Forms' links stop working.
  app.delete('/:id/views/:vid', edit, async (request) => {
    const page = databasePage(request);
    const viewId = viewIdOf(request);
    const version = versionOf(request);
    const record = await changeDatabase(app.db, page.id, version, async (current, tx) => {
      allow('edit_views', page.level, current.locked);
      const plan = planDeleteView(current, viewId);
      if (plan.view.form) allow('edit_forms', page.level, current.locked);
      await revokeLinkCodes(tx, current.id, plan.removedIds);
      return { views: plan.views };
    });
    return answerFor(app.db, request, record, page.level);
  });

  // A copy with every setting right after the view; a form's copy gets a new link.
  app.post('/:id/views/:vid/duplicate', edit, async (request) => {
    const page = databasePage(request);
    const viewId = viewIdOf(request);
    const { version } = accept(parseRequest(versionRequest, request.body));
    let copyId = '';
    const record = await changeDatabase(app.db, page.id, version, async (current, tx) => {
      allow('edit_views', page.level, current.locked);
      const plan = planDuplicateView(current, viewId, newLinkCode());
      if (plan.view.form) allow('edit_forms', page.level, current.locked);
      if (hasOpenFormAccess(plan.view)) allow('manage_form_access', page.level, current.locked);
      await keepLinkCode(tx, current.id, plan.view);
      copyId = plan.view.id;
      return { views: plan.views };
    });
    return { ...(await answerFor(app.db, request, record, page.level)), viewId: copyId };
  });

  // The order of the view tabs (`viewIds` lists each once).
  app.put('/:id/views/order', edit, async (request) => {
    const page = databasePage(request);
    const { version, viewIds } = accept(parseRequest(viewOrderRequest, request.body));
    const record = await changeDatabase(app.db, page.id, version, (current) => {
      allow('edit_views', page.level, current.locked);
      return { views: planViewOrder(current, viewIds) };
    });
    return answerFor(app.db, request, record, page.level);
  });
}
