// Events the page model's routes emit after their commit (decisions 0007, section 2.4, and 0012,
// point 8). A feature that calls the service functions in its own transaction emits them itself.
import type { PageKind } from '@carehub/shared';
import type { ArchivedPages } from './archive';

declare module '../../core/events' {
  interface CareHubEvents {
    'page.created': {
      pageId: string;
      workspaceId: string;
      spaceId: string;
      parentId: string | null;
      kind: PageKind;
      by: string;
    };
    /** `changes` names what changed: `title`, `icon`, `locked`, `parentId`, `position` and so on. */
    'page.updated': { pageId: string; workspaceId: string; by: string; changes: string[] };
    /** A page moved into a database became a row, or a row moved out became a page (0007). */
    'page.kindChanged': {
      pageId: string;
      workspaceId: string;
      from: PageKind;
      to: PageKind;
      by: string;
    };
    /** Archived or unarchived with the pages that went along (`pageIds`, the root included). */
    'page.archived': ArchivedPages & { by: string };
    'page.unarchived': ArchivedPages & { by: string };
  }
}
