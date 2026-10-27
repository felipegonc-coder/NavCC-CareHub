// Stand-in for core pieces that aren't on main yet (0007). It goes when they land.
import type { NotesPages } from './types';

/**
 * Pages and page content: `createPage`, `getPageAccess`, `getPrivateSpaceId` and `grantAccess`
 * from features/pages, `setPageContentFromMarkdown` from features/collab. Null until they're on
 * main, so Take meeting notes answers 409 and makes nothing.
 */
export const corePages: NotesPages | null = null;
