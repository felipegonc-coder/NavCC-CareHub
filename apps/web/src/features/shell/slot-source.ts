import type { SidebarItem, SidebarSection } from './types';

// Stand-in until apps/web/src/slots.ts lands (0007 §5.3). Then the layout reads `sidebarItems`
// and `sidebarSections` from there, and this file goes.
export const sidebarItems: readonly SidebarItem[] = [];
export const sidebarSections: readonly SidebarSection[] = [];
