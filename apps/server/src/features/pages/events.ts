// Events the page model's routes emit after their commit (decisions 0007, section 2.4, and 0012,
// point 8). A feature that calls the service functions in its own transaction emits them itself.
import type { PageKind } from '@carehub/shared';

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
    /** `changes` names what changed: `title`, `icon`, `cover`, `locked` and so on. */
    'page.updated': { pageId: string; workspaceId: string; by: string; changes: string[] };
  }
}
