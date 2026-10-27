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
