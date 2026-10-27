// Form routes at /api/forms (decision 0200): the fill screen by link code, and "Change link".
// A link code is a secret, so routes with one in the path write no request log lines (they would
// hold the code and the person's network address). Their failures are logged by this plugin's
// onError hook instead, without the URL.
import { atLeast, can } from '@carehub/databases/access';
import { parseRequest } from '@carehub/databases/schemas';
import type { FastifyError, FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { httpError } from '../../core/errors';
import { forbidden, invalidRequest, notFound } from '../databases/errors';
import { loadDatabase, lockDatabase } from '../databases/store';
import { publishTopic } from '../live';
import { getAccessForPages, pageAccessOf } from '../pages';
import { fillScreen, formMentions, type FillScreen } from './fill';
import { changeLink, findLink, formViewOf, lockForm, type FormLink } from './links';
import { gateOf, replacedCodeGate, visitFor } from './visit';

function signedIn(request: FastifyRequest) {
  if (!request.user) throw httpError(401, 'signed_out');
  return request.user;
}

const param = (request: FastifyRequest, name: string): string => {
  const value = (request.params as Record<string, unknown>)[name];
  return typeof value === 'string' ? value : '';
};

const quiet = { logLevel: 'silent' } as const;

/** A stack's call lines ("    at file:line:column"), without the message before them. */
const STACK_LINE = /^\s+at .*:\d+:\d+\)?$/;

/** A Postgres error's SQLSTATE (such as 42P01), on the error or on the one drizzle wrapped. */
function sqlStateOf(error: FastifyError): string | undefined {
  for (const e of [error.cause, error]) {
    if (typeof e !== 'object' || e === null || !('code' in e)) continue;
    if (typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code)) return e.code;
  }
  return undefined;
}

/**
 * A failed request as the log keeps it: the route's pattern and the error, without the values its
 * queries were sent (drizzle lists them in its message after "params:"), which can hold a code or
 * the person responding. A Postgres error keeps only its SQLSTATE.
 */
function failure(request: FastifyRequest, error: FastifyError) {
  const sqlState = sqlStateOf(error);
  return {
    route: request.routeOptions.url,
    error: {
      name: error.name,
      message: (error.message.split('params:')[0] ?? '').trim(),
      stack: (error.stack ?? '')
        .split('\n')
        .filter((line) => STACK_LINE.test(line))
        .join('\n'),
      ...(sqlState === undefined ? {} : { sqlState }),
    },
  };
}

/** Change link has nothing to send: no body, or {}. */
const changeLinkRequest = z.strictObject({}).optional();

export default async function formRoutes(app: FastifyInstance) {
  // Until core's request log masks codes, quiet routes write no log lines, so their failures
  // (500s) are logged here with the instance's logger: the route's pattern and the error only.
  app.addHook('onError', async (request, _reply, error) => {
    if (request.routeOptions.logLevel !== 'silent' || (error.statusCode ?? 500) < 500) return;
    app.log.error(failure(request, error), 'forms: a request failed');
  });

  /** A code Change link replaced: 410 with the package's words if its form is there, else 404. */
  async function replaced(link: FormLink): Promise<never> {
    const record = await loadDatabase(app.db, link.databaseId);
    const view = record && !record.inTrash ? formViewOf(record, link.viewId) : null;
    const gate = view ? replacedCodeGate(view.form, link.code) : null;
    if (gate?.state !== 'link_changed') throw notFound();
    throw httpError(410, 'not_found', gate.message);
  }

  // The fill screen for someone signed in: the gate, and the form's questions when it's open. An
  // unknown code answers 404 at once, and a revoked one 410 while its form is there.
  app.get('/:code', quiet, async (request): Promise<FillScreen> => {
    const user = signedIn(request);
    const link = await findLink(app.db, param(request, 'code'));
    if (!link) throw notFound();
    if (link.revoked) return replaced(link);
    const record = await loadDatabase(app.db, link.databaseId);
    const view = record ? formViewOf(record, link.viewId) : null;
    if (!record || !view) throw notFound();
    const visit = await visitFor(app.db, {
      record,
      form: view.form,
      viewId: view.id,
      linkCode: link.code,
      user,
    });
    const mentioned = formMentions(view.form);
    const levels =
      mentioned.length > 0 ? await getAccessForPages(app.db, user.id, mentioned) : null;
    return fillScreen(record, view, {
      gate: gateOf(visit),
      respondent: { userId: user.id, timeZone: user.timeZone },
      openable: new Set(mentioned.filter((id) => atLeast(levels?.get(id), 'view'))),
    });
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
