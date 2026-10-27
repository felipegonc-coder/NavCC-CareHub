// Page data as the server sends it (decision 0007, section 4.1).
import type { AccessLevel } from './access';

export type PageIcon =
  { type: 'emoji'; emoji: string } | { type: 'icon'; name: string; color?: string | undefined };

/** An entry in a sidebar tree: a page or a full-page database (rows never show). */
export interface TreeNode {
  id: string;
  parentId: string | null;
  kind: 'page' | 'database';
  title: string;
  icon: PageIcon | null;
  /** Fractional sort key among siblings. */
  position: string;
  hasChildren: boolean;
  access: AccessLevel;
  /** Shared pages: true when the parent is a page the person can't open. */
  pathHidden?: boolean | undefined;
}

export interface Space {
  id: string;
  /** 'personal' is the person's own Private section. */
  kind: 'open' | 'closed' | 'private' | 'personal';
  name: string;
  icon: PageIcon | null;
  /** Whether the person may add top-level pages. Missing means "if they have Create". */
  canAddPages?: boolean | undefined;
}

/** A starred page, or one opened lately. */
export interface PageLink {
  id: string;
  kind: 'page' | 'database' | 'row';
  title: string;
  icon: PageIcon | null;
  access: AccessLevel;
  /** The space it lives in; missing for pages shared with the person outside their spaces. */
  spaceId?: string | undefined;
}
