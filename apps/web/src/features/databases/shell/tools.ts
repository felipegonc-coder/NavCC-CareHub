/**
 * What the toolbar offers for a view, and to whom (Databases spec sections 2, 3.2, 3.12 and 5):
 * its buttons, the "…" menu and the link Copy link copies. Pure, so the rules are tested without
 * drawing anything.
 */
import type { DatabaseGrant, Id, View, ViewLayout } from '@carehub/databases';
import { can } from '@carehub/databases/access';
import { countConditions } from '@carehub/databases/filter';
import { pageUrl } from '@carehub/shared';
import type { PanelName } from '../contract';

/** The toolbar's buttons, in toolbar order. */
export type Tool = 'filter' | 'sort' | 'group' | 'search' | 'properties';

/** The buttons that open a panel: all but Search. */
export type PanelTool = Exclude<Tool, 'search'>;

export const TOOL_LABELS: Record<Tool, string> = {
  filter: 'Filter',
  sort: 'Sort',
  group: 'Group',
  search: 'Search',
  properties: 'Properties',
};

const ALL_TOOLS: readonly Tool[] = ['filter', 'sort', 'group', 'search', 'properties'];
const UNGROUPED: readonly Tool[] = ['filter', 'sort', 'search', 'properties'];

/**
 * Grouping is for table, list, gallery, board and timeline (spec 3.2). A chart is filtered here
 * but sorts and groups in its own settings; forms and dashboards have only their own settings.
 */
const LAYOUT_TOOLS: Record<ViewLayout, readonly Tool[]> = {
  table: ALL_TOOLS,
  board: ALL_TOOLS,
  list: ALL_TOOLS,
  gallery: ALL_TOOLS,
  timeline: ALL_TOOLS,
  calendar: UNGROUPED,
  feed: UNGROUPED,
  chart: ['filter'],
  form: [],
  dashboard: [],
};

/**
 * The toolbar's buttons for a view. Properties only for people whose changes are saved: everyone
 * else changes filters, sorts and grouping for themselves only.
 */
export function toolsFor(layout: ViewLayout, canEditViews: boolean): Tool[] {
  return LAYOUT_TOOLS[layout].filter((tool) => tool !== 'properties' || canEditViews);
}

/** The view has the tool's setting on, so its button shows it. */
export function toolIsOn(tool: Tool, view: View, search: string): boolean {
  switch (tool) {
    case 'filter':
      return countConditions(view.filter) > 0;
    case 'sort':
      return view.sorts.length > 0;
    case 'group':
      return view.grouping !== null;
    case 'search':
      return search.trim() !== '';
    case 'properties':
      return false;
  }
}

/** The "…" menu's items, in menu order. */
export type MoreItem =
  | 'layout'
  | 'importCsv'
  | 'exportCsv'
  | 'lock'
  | 'rowAccess'
  | 'propertyAccess'
  | 'copyLink'
  | 'delete';

/** The items that open a panel or a dialog. */
export type MorePanel = Extract<MoreItem, PanelName>;

/** The items the shell does itself. */
export type MoreAction = Exclude<MoreItem, PanelName>;

export const MORE_LABELS: Record<MoreItem, string> = {
  layout: 'Layout',
  importCsv: 'Import CSV',
  exportCsv: 'Export CSV',
  lock: 'Lock structure',
  rowAccess: 'Row access',
  propertyAccess: 'Property access',
  copyLink: 'Copy link',
  delete: 'Delete',
};

const MORE_PANELS: ReadonlySet<MoreItem> = new Set<MoreItem>([
  'layout',
  'importCsv',
  'exportCsv',
  'rowAccess',
  'propertyAccess',
]);

export function opensPanel(item: MoreItem): item is MorePanel {
  return MORE_PANELS.has(item);
}

export interface MoreInput {
  /** DatabaseMeta.viewerAccess. */
  access: DatabaseGrant;
  locked: boolean;
  online: boolean;
  /** The page or block can delete the database (it passed onDelete). */
  canDelete: boolean;
}

/**
 * The "…" menu for this person: Layout needs Can edit with Lock structure off, Import CSV Can
 * edit, Export CSV Can view; Lock structure, Row access, Property access and Delete need Full
 * access. Offline only Copy link stays.
 */
export function moreItems({ access, locked, online, canDelete }: MoreInput): MoreItem[] {
  if (!online) return ['copyLink'];
  const opts = { locked };
  const items: MoreItem[] = [];
  if (can('edit_views', access, opts)) items.push('layout');
  if (can('import', access, opts)) items.push('importCsv');
  if (can('export', access, opts)) items.push('exportCsv');
  if (can('lock', access, opts)) items.push('lock');
  if (can('set_row_rules', access, opts)) items.push('rowAccess');
  if (can('set_property_access', access, opts)) items.push('propertyAccess');
  items.push('copyLink');
  if (canDelete && can('delete_database', access, opts)) items.push('delete');
  return items;
}

/** The link to the database's page showing this view ("Links include the view", spec 3.2). */
export function databaseLink(origin: string, databaseId: Id, viewId: Id): string {
  return `${origin}${pageUrl(databaseId)}?v=${encodeURIComponent(viewId)}`;
}

export const COPY_TEXT = {
  copied: 'Link copied.',
  failed: "Couldn't copy the link.",
} as const;

/** How long Search waits after the last key before asking for rows. */
export const SEARCH_DELAY_MS = 250;
