import { atLeast } from '@carehub/shared';
import type { Db, Tx } from '../../../db';
import type { ImportTarget } from './apply';
import { importPorts } from './ports';

// Where an import goes (Import and export spec, section 3.1): under a page the person can edit, or
// in their Private space, and only for people who may create pages. Checked when it starts and
// again when the job writes it.

export type Destination =
  | { ok: true; target: ImportTarget; title: string }
  | { ok: false; code: 'not_found' | 'forbidden' };

export const PRIVATE_TITLE = 'Private';
/** In place of the title of a page the person can no longer open. */
export const HIDDEN_TITLE = "a page you can't open";

const titled = (title: string) => title.trim() || 'Untitled';

export async function checkDestination(
  db: Db | Tx,
  userId: string,
  pageId: string | null,
): Promise<Destination> {
  const ports = importPorts();
  if (pageId === null) {
    const space = await ports.privateSpace(db, userId);
    if (!space || !(await ports.canCreatePages(db, userId, space.workspaceId))) {
      return { ok: false, code: 'forbidden' };
    }
    const target = { workspaceId: space.workspaceId, pageId: null, spaceId: space.spaceId };
    return { ok: true, target, title: PRIVATE_TITLE };
  }
  const access = await ports.pageAccess(db, userId, pageId);
  if (!access || !atLeast(access.level, 'view')) return { ok: false, code: 'not_found' };
  if (
    !atLeast(access.level, 'edit') ||
    !(await ports.canCreatePages(db, userId, access.workspaceId))
  ) {
    return { ok: false, code: 'forbidden' };
  }
  const target = { workspaceId: access.workspaceId, pageId, spaceId: null };
  return { ok: true, target, title: titled(access.title) };
}

/** The destination's name as the person sees it now. */
export async function destinationTitle(
  db: Db | Tx,
  userId: string,
  pageId: string | null,
): Promise<string> {
  if (pageId === null) return PRIVATE_TITLE;
  const access = await importPorts().pageAccess(db, userId, pageId);
  return access && atLeast(access.level, 'view') ? titled(access.title) : HIDDEN_TITLE;
}
