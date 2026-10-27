// Form routes at /api/forms (decision 0200): the fill screen and responses, by link code or in
// the database's Form view, and "Change link". A link code is a secret, and a response may be
// anonymous, so those routes write no request log lines (they would hold the code and the
// person's network address). Their failures are logged by this plugin's onError hook instead,
// without the URL.
import { atLeast, can } from '@carehub/databases/access';
import type { FormGate } from '@carehub/databases/forms';
import { parseRequest } from '@carehub/databases/schemas';
import type { FastifyError, FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { httpError } from '../../core/errors';
import { forbidden, invalidRequest, notFound } from '../databases/errors';
import { loadDatabase, lockDatabase } from '../databases/store';
import { publishTopic } from '../live';
import { getAccessForPages, pageAccessOf } from '../pages';
import type { DatabaseRecord } from '../databases/record';
import { fillForm, formMentions, type FillForm } from './fill';
import { changeLink, findLink, formViewOf, lockForm, type FormLink, type FormView } from './links';
import { notifyResponse } from './notify';
import { ResponseLimiter } from './rate';
import { submitResponse, type FormUser, type SubmitInput } from './submit';
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
  const limiter = new ResponseLimiter();

  // Until core's request log masks codes, quiet routes write no log lines, so their failures
  // (500s) are logged here with the instance's logger: the route's pattern and the error only.
  app.addHook('onError', async (request, _reply, error) => {
    if (request.routeOptions.logLevel !== 'silent' || (error.statusCode ?? 500) < 500) return;
    app.log.error(failure(request, error), 'forms: a request failed');
  });

  /** A code Change link replaced: 410 with the package's words while its form is there, else 404. */
  async function replaced(link: FormLink): Promise<never> {
    const record = await loadDatabase(app.db, link.databaseId);
    const view = record && !record.inTrash ? formViewOf(record, link.viewId) : null;
    const gate = view ? replacedCodeGate(view.form, link.code) : null;
    if (gate?.state !== 'link_changed') throw notFound();
    throw httpError(410, 'not_found', gate.message);
  }

  /** The gate for this person, and the form when it's open. */
  async function fillScreen(
    user: FormUser,
    record: DatabaseRecord,
    view: FormView,
    linkCode: string | null,
  ): Promise<{ gate: FormGate; form: FillForm | null }> {
    const form = view.form;
    const gate = gateOf(await visitFor(app.db, { record, form, viewId: view.id, linkCode, user }));
    if (gate.state !== 'open') return { gate, form: null };
    const mentioned = formMentions(form);
    const levels =
      mentioned.length > 0 ? await getAccessForPages(app.db, user.id, mentioned) : null;
    const openable = new Set(mentioned.filter((id) => atLeast(levels?.get(id), 'view')));
    return { gate, form: fillForm(record, view, openable) };
  }

  /** Saves a response, then tells the people who asked to hear about new ones. */
  async function respond(input: SubmitInput): Promise<{ ok: true }> {
    await notifyResponse(app, await submitResponse(app, limiter, input));
    return { ok: true };
  }

  // The fill screen for a signed-in member or guest. An unknown code answers 404 at once, and a
  // revoked one 410 while its form is there.
  app.get('/:code', quiet, async (request) => {
    const user = signedIn(request);
    const link = await findLink(app.db, param(request, 'code'));
    if (!link) throw notFound();
    if (link.revoked) return replaced(link);
    const record = await loadDatabase(app.db, link.databaseId);
    const view = record ? formViewOf(record, link.viewId) : null;
    if (!record || !view) throw notFound();
    return fillScreen(user, record, view, link.code);
  });

  app.post('/:code/responses', quiet, async (request) => {
    const user = signedIn(request);
    const link = await findLink(app.db, param(request, 'code'));
    if (!link) throw notFound();
    if (link.revoked) return replaced(link);
    const { databaseId, viewId, code } = link;
    return respond({ databaseId, viewId, linkCode: code, user, body: request.body });
  });

  // The Form view inside the database: the same screen and submit without a link code, so people
  // who can edit can test the form while it's off or closed (Forms spec, section 3).
  const onDatabase = app.requirePageAccess('view', (request) => param(request, 'databaseId'));
  app.get('/:databaseId/views/:vid', { preHandler: onDatabase }, async (request) => {
    const user = signedIn(request);
    const page = pageAccessOf(request);
    const record = page.kind === 'database' ? await loadDatabase(app.db, page.pageId) : null;
    const view = record ? formViewOf(record, param(request, 'vid')) : null;
    if (!record || !view) throw notFound();
    return fillScreen(user, record, view, null);
  });

  const inView = { ...quiet, preHandler: onDatabase };
  app.post('/:databaseId/views/:vid/responses', inView, async (request) => {
    const user = signedIn(request);
    const page = pageAccessOf(request);
    if (page.kind !== 'database') throw notFound();
    const viewId = param(request, 'vid');
    return respond({ databaseId: page.pageId, viewId, linkCode: null, user, body: request.body });
  });

  // "Change link" needs Full access (Forms spec, section 5); the old code stops working at once.
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
