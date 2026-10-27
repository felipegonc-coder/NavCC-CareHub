// What the database route files share (decision 0200): the checked body, the signed-in person, the
// database page requirePageAccess found, permission checks with the Lock structure message, and the
// answer of GET /:id and every settings write (the database as this person may see it).
import type { DatabaseGrant } from '@carehub/databases';
import { atLeast, can, type DbAction } from '@carehub/databases/access';
import type { RequestResult } from '@carehub/databases/schemas';
import type { FastifyRequest } from 'fastify';
import { httpError } from '../../core/errors';
import type { Db } from '../../db';
import { getAccessForPages, pageAccessOf } from '../pages';
import { DATABASE_MESSAGES, forbidden, invalidRequest, notFound } from './errors';
import { databaseMeta, mentionedPageIds, type DatabaseAnswer } from './meta';
import type { DatabaseRecord } from './record';
import { loadPropertyViewer, loadRelatedProperties } from './store';

/** The checked body, or 400 with the fixed message. */
export function accept<T>(result: RequestResult<T>): T {
  if (!result.ok) throw invalidRequest();
  return result.value;
}

export function signedIn(request: FastifyRequest): { id: string } {
  if (!request.user) throw httpError(401, 'signed_out');
  return request.user;
}

/** The database page requirePageAccess checked and the person's level on it; 404 for other pages. */
export function databasePage(request: FastifyRequest): { id: string; level: DatabaseGrant } {
  const page = pageAccessOf(request);
  if (page.kind !== 'database') throw notFound();
  return { id: page.pageId, level: page.level };
}

/** 403 unless the person may do this; the Lock structure message when only the lock stops them. */
export function allow(
  action: DbAction,
  access: DatabaseGrant | null | undefined,
  locked: boolean,
): void {
  if (can(action, access, { locked })) return;
  const lockedOut = locked && can(action, access, { locked: false });
  throw lockedOut ? forbidden(DATABASE_MESSAGES.locked) : forbidden();
}

/** The database as this person may see it, with its version (GET /:id and every settings write). */
export async function answerFor(
  db: Db,
  request: FastifyRequest,
  record: DatabaseRecord,
  access: DatabaseGrant,
): Promise<DatabaseAnswer> {
  const user = signedIn(request);
  const [viewer, related] = await Promise.all([
    loadPropertyViewer(db, user.id, record.workspaceId),
    loadRelatedProperties(db, record.properties),
  ]);
  const mentioned = mentionedPageIds(record);
  const levels = mentioned.length > 0 ? await getAccessForPages(db, user.id, mentioned) : null;
  const openablePages = new Set(mentioned.filter((id) => atLeast(levels?.get(id), 'view')));
  return databaseMeta({ record, access, viewer, related, openablePages });
}
