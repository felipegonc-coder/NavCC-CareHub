// Form routes at /api/forms (decision 0200): the fill screen by link code, and "Change link".
// A link code is a secret, so routes with one in the path write no request log lines (they would
// hold the code and the person's network address).
import { atLeast, can } from '@carehub/databases/access';
import type { FormGate } from '@carehub/databases/forms';
import { parseRequest } from '@carehub/databases/schemas';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { httpError } from '../../core/errors';
import { forbidden, invalidRequest, notFound } from '../databases/errors';
import { loadDatabase, lockDatabase } from '../databases/store';
import { publishTopic } from '../live';
import { getAccessForPages, pageAccessOf } from '../pages';
import { fillForm, formMentions, type FillForm } from './fill';
import { changeLink, definitionForLink, findLink, formViewOf, lockForm } from './links';
import { gateOf, visitFor } from './visit';

function signedIn(request: FastifyRequest) {
  if (!request.user) throw httpError(401, 'signed_out');
  return request.user;
}

const param = (request: FastifyRequest, name: string): string => {
  const value = (request.params as Record<string, unknown>)[name];
  return typeof value === 'string' ? value : '';
};

const quiet = { logLevel: 'silent' } as const;

/** Change link has nothing to send: no body, or {}. */
const changeLinkRequest = z.strictObject({}).optional();

export default async function formRoutes(app: FastifyInstance) {
  // The fill screen for a signed-in member or guest: the gate, and the form when it's open.
  app.get('/:code', quiet, async (request): Promise<{ gate: FormGate; form: FillForm | null }> => {
    const user = signedIn(request);
    const link = await findLink(app.db, param(request, 'code'));
    const record = link ? await loadDatabase(app.db, link.databaseId) : null;
    const view = link && record ? formViewOf(record, link.viewId) : null;
    if (!link || !record || !view) throw notFound();
    const form = definitionForLink(view.form, link);
    const visit = await visitFor(app.db, {
      record,
      form,
      viewId: view.id,
      linkCode: link.code,
      user,
    });
    const gate = gateOf(visit);
    if (gate.state !== 'open') return { gate, form: null };
    const mentioned = formMentions(view.form);
    const levels =
      mentioned.length > 0 ? await getAccessForPages(app.db, user.id, mentioned) : null;
    const openable = new Set(mentioned.filter((id) => atLeast(levels?.get(id), 'view')));
    return { gate, form: fillForm(record, view, openable) };
  });

  // "Change link" needs Full access (Forms spec, section 5); the old code stops working at once.
  const onDatabase = app.requirePageAccess('view', (request) => param(request, 'databaseId'));
  app.post('/:databaseId/views/:vid/link', { preHandler: onDatabase }, async (request) => {
    if (!parseRequest(changeLinkRequest, request.body).ok) throw invalidRequest();
    const page = pageAccessOf(request);
    if (page.kind !== 'database') throw notFound();
    const viewId = param(request, 'vid');
    const changed = await app.db.transaction(async (tx) => {
      await lockForm(tx, page.pageId, viewId);
      const record = await lockDatabase(tx, page.pageId);
      const view = formViewOf(record, viewId);
      if (!view) throw notFound();
      if (!can('change_form_link', page.level, { locked: record.locked })) throw forbidden();
      return changeLink(tx, record, view);
    });
    publishTopic(`db:${page.pageId}`, { type: 'schema-changed' });
    return changed;
  });
}
