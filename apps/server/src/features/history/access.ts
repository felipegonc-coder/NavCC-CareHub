// Who may do what with a page's history (HT-15): versions need Can edit; restoring and naming
// also need the page not to be locked or archived. Missing pages and pages in Trash answer 404;
// too little access answers 403 without the page's title.
import { atLeast, type AccessLevel } from '@carehub/shared';
import type { FastifyRequest } from 'fastify';
import { httpError } from '../../core/errors';
import type { Db, Tx } from '../../db';
import { historyPages, type HistoryPage } from './pages';

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isId(value: unknown): value is string {
  return typeof value === 'string' && ID.test(value);
}

/** A page or version ID from the address; anything else can't exist, so it's a 404. */
export function idParam(value: unknown): string {
  if (!isId(value)) throw httpError(404, 'not_found');
  return value.toLowerCase();
}

export function userIdOf(request: FastifyRequest): string {
  if (!request.user) throw httpError(401, 'signed_out');
  return request.user.id;
}

/** The page, when the person has at least `min` on it. */
export async function pageFor(
  db: Db | Tx,
  userId: string,
  pageId: string,
  min: AccessLevel,
): Promise<HistoryPage> {
  const page = await historyPages().getPage(db, pageId);
  if (!page || page.trashed) throw httpError(404, 'not_found');
  const level = await historyPages().getPageAccess(db, userId, pageId);
  if (!atLeast(level, min)) throw httpError(403, 'forbidden');
  return page;
}

/** Whether versions of the page may be restored and named now. */
export function canChange(page: HistoryPage): boolean {
  return !page.locked && page.archivedAt === null;
}

export function assertCanChange(page: HistoryPage): void {
  if (page.archivedAt)
    throw httpError(403, 'forbidden', 'This page is archived. Unarchive it first.');
  if (page.locked) throw httpError(403, 'forbidden', 'This page is locked. Unlock it first.');
}
