import type { LucideIcon } from 'lucide-react';
import type { ComponentType } from 'react';

/** A top link in the sidebar (0007 §5.3 `sidebarItems`): Home, Messages, Calendar, Learning. */
export interface SidebarItem {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Where it goes, such as '/messages'. It shows as current there and on the paths under it. */
  to: string;
  /** Lower numbers come first. */
  order: number;
  /** A hook giving the count to show (unread messages), or undefined for none. */
  useBadge?(): number | undefined;
}

/** A block under the top links (0007 §5.3 `sidebarSections`), such as Upcoming or the page tree. */
export interface SidebarSection {
  id: string;
  order: number;
  Component: ComponentType;
}
