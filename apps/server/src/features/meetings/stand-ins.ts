// Stand-in for core pieces that aren't on main yet (0007). It goes when they land.
import { getMembership } from '../workspaces';
import type { NotesCore } from './types';

/**
 * Pages and page content: `createPage`, `getPagePlace`, `getPrivateSpaceId` and `grantAccess` from
 * features/pages, `setPageContentFromMarkdown` from features/collab, and `isCurrentMember` below.
 * Null until pages are on main, so Take meeting notes answers 409 and makes nothing.
 */
export const notesCore: NotesCore | null = null;

/** A current member of the workspace, from core's `getMembership`: not a guest, not removed. */
export const isCurrentMember: NotesCore['isMember'] = async (db, workspaceId, userId) =>
  (await getMembership(db, workspaceId, userId))?.kind === 'member';
