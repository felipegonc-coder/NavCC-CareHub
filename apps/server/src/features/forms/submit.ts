// Sending a form response (Forms spec, section 3; decision 0200). Everything is checked again on
// the server, in one transaction under the form's lock: the gate (who can respond, open, closed,
// full, one response per person), the rate limit, and every answer with the package's
// checkSubmission, show-if included. Only the form's own questions are written, through the
// databases feature's createRow. An anonymous response keeps nothing about its sender: no Created
// by, no actor in history or events, no name in notices, and its routes write no log lines.
import { LIMITS, type Id, type Property } from '@carehub/databases';
import { atLeast } from '@carehub/databases/access';
import { checkSubmission, isAnonymousForm, responseRateLimit } from '@carehub/databases/forms';
import { idListSchema, parseRequest, valuesSchema } from '@carehub/databases/schemas';
import { validateValue } from '@carehub/databases/values';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { httpError } from '../../core/errors';
import type { Tx } from '../../db';
import { createRow, runRowWrites } from '../databases/api';
import { invalidRequest, notFound } from '../databases/errors';
import { isUuid } from '../databases/record';
import { loadDatabase, uuidList } from '../databases/store';
import { getAccessForPages } from '../pages';
import { askedQuestions, FILES_UNAVAILABLE, withoutFileUploads } from './fill';
import { formViewOf, lockForm } from './links';
import type { ResponseLimiter } from './rate';
import { gateOf, visitFor } from './visit';

/** The answers by property id, and the questions the person's copy of the form had. */
const responseRequest = z.strictObject({
  answers: valuesSchema,
  questionIds: idListSchema(LIMITS.formQuestions).optional(),
});

/** The signed-in person sending it (their name and id are dropped for anonymous forms). */
export interface FormUser {
  id: string;
  name: string;
  timeZone: string;
}

export interface SubmitInput {
  databaseId: string;
  viewId: string;
  /** The link's code, or null in the database's Form view. */
  linkCode: string | null;
  user: FormUser;
  body: unknown;
}

/** What the notices need about a saved response. */
export interface SavedResponse {
  workspaceId: string;
  databaseId: string;
  viewId: string;
  rowId: string;
  anonymous: boolean;
  /** The sender, for forms that record it. */
  senderId: string | null;
  notifyUserIds: readonly string[];
}

/** File answers wait for uploads; every other answer is checked like any value. */
function validate(prop: Property, value: unknown) {
  if (prop.config.type !== 'files') return validateValue(prop, value);
  if (Array.isArray(value) && value.length > 0) {
    return { ok: false as const, error: FILES_UNAVAILABLE };
  }
  return { ok: true as const, value: null };
}

/**
 * People in Person answers must be in the workspace, and the person sending the response must be
 * able to open the rows in Relation answers (createRow checks they're rows of the related database,
 * not in Trash).
 */
async function linksAllowed(
  tx: Tx,
  input: { workspaceId: string; userId: string },
  props: readonly Property[],
  values: Readonly<Record<Id, unknown>>,
): Promise<boolean> {
  for (const prop of props) {
    const type = prop.config.type;
    const value = values[prop.id];
    if ((type !== 'person' && type !== 'relation') || !Array.isArray(value)) continue;
    const ids = [...new Set(value.map(String))];
    if (!ids.every(isUuid)) return false;
    if (type === 'person') {
      const found = await tx.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM workspace_members
        WHERE workspace_id = ${input.workspaceId} AND user_id = ANY(${uuidList(ids)})`);
      if (found.rows[0]?.n !== ids.length) return false;
    } else {
      const levels = await getAccessForPages(tx, input.userId, ids);
      if (!ids.every((id) => atLeast(levels.get(id), 'view'))) return false;
    }
  }
  return true;
}

/**
 * Checks and saves one response, or throws why not: 404 for a form that's gone, 410 for a code
 * Change link replaced, 403 with the gate's words (details.gate is its state), 429 over the rate
 * limit, 400 with each question's error (details.errors, details.formChanged).
 */
export async function submitResponse(
  app: FastifyInstance,
  limiter: ResponseLimiter,
  input: SubmitInput,
): Promise<SavedResponse> {
  const parsed = parseRequest(responseRequest, input.body);
  if (!parsed.ok) throw invalidRequest();
  const { answers, questionIds } = parsed.value;
  const { user } = input;
  const taken: { key: string; at: number }[] = [];
  try {
    return await runRowWrites(app, async (tx) => {
      // The form's lock first. The count and the insert below then take turns, and the
      // database's row isn't locked.
      await lockForm(tx, input.databaseId, input.viewId);
      const record = await loadDatabase(tx, input.databaseId);
      const view = record ? formViewOf(record, input.viewId) : null;
      if (!record || !view) throw notFound();
      const form = view.form;
      const visit = await visitFor(tx, {
        record,
        form,
        viewId: view.id,
        linkCode: input.linkCode,
        user,
      });
      const gate = gateOf(visit);
      // Change link replaced the code since it was looked up.
      if (gate.state === 'link_changed') throw httpError(410, 'not_found', gate.message);
      if (gate.state !== 'open') {
        throw httpError(403, 'forbidden', gate.message ?? undefined, { gate: gate.state });
      }
      const limit = responseRateLimit(form);
      const place = {
        key: limit.per === 'form' ? view.id : `${view.id}:${user.id}`,
        at: Date.now(),
      };
      if (!limiter.take(place.key, limit.perMinute, place.at)) {
        throw httpError(429, 'rate_limited', limit.message);
      }
      taken.push(place);
      const anonymous = isAnonymousForm(form);
      const props = askedQuestions(form, record.properties).map((asked) => asked.prop);
      const checked = checkSubmission(withoutFileUploads(form, props), props, answers, {
        validate,
        respondentName: anonymous ? null : user.name,
        anonymous,
        ...(questionIds ? { seenQuestionIds: questionIds } : {}),
        viewer: { userId: user.id, timeZone: user.timeZone },
      });
      if (!checked.ok) {
        const { errors, formChanged } = checked;
        throw httpError(400, 'invalid', checked.summary, { errors, formChanged });
      }
      const where = { workspaceId: record.workspaceId, userId: user.id };
      if (!(await linksAllowed(tx, where, props, checked.values))) throw invalidRequest();
      const name = record.properties.find((p) => p.config.type === 'title');
      const { rowId } = await createRow(tx, {
        databaseId: record.id,
        templateId: null,
        values: name ? { ...checked.values, [name.id]: checked.title } : checked.values,
        actorUserId: anonymous ? null : user.id,
        source: 'form',
        formId: view.id,
      });
      return {
        workspaceId: record.workspaceId,
        databaseId: record.id,
        viewId: view.id,
        rowId,
        anonymous,
        senderId: anonymous ? null : user.id,
        notifyUserIds: form.notifyUserIds,
      };
    });
  } catch (error) {
    for (const place of taken) limiter.giveBack(place.key, place.at);
    throw error;
  }
}
