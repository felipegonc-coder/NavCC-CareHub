/**
 * The contract between the database shell and the layouts (table, board, list, gallery, calendar,
 * timeline, chart, feed, dashboard and form), and between the toolbar and its panels. The shell
 * loads the database and the view's rows and hands them to the layout as LayoutProps; a layout or
 * panel changes anything only through `actions`.
 *
 * The query answer (rows, groups, lanes, counts and totals) is the engine's, from
 * `@carehub/databases/engine`, with the names of the people in it. `cellContext` turns what a
 * layout gets into the `ctx` that cells (`./cells`) need.
 */
import type {
  DatabaseMeta,
  FileRef,
  Id,
  Row,
  SelectOption,
  View,
  ViewOverride,
  Viewer,
} from '@carehub/databases';
import { can } from '@carehub/databases/access';
import type { ViewQueryBlocked, ViewQueryData as EngineQueryData } from '@carehub/databases/engine';
import { pageUrl } from '@carehub/shared';
import type { ViewChange } from './api';
import type { CellContext, PersonChoice } from './cells/types';

export type { QueryGroup, QueryLane, QueryRow, ViewQueryBlocked } from '@carehub/databases/engine';

/** Someone the rows name (Person, Created by, Edited by), as the server sends them. */
export interface PersonName {
  name: string;
  avatarUrl: string | null;
}

/** The answer for a view: the engine's, with the names and photos of the people it names. */
export interface ViewQueryData extends EngineQueryData {
  /** By user id. "Load more" answers add theirs. Absent: no names yet (cells show none). */
  people?: Record<Id, PersonName>;
}

/** What POST /:id/query answers: the rows, or why the view can't show them. */
export type ViewQueryResult = ViewQueryBlocked | ViewQueryData;

/** The view uses a property the viewer can't see: the block shows `blocked` instead of rows. */
export function isBlocked(result: ViewQueryResult): result is ViewQueryBlocked {
  return 'blocked' in result;
}

// ---------------------------------------------------------------- what a layout gets

/** The rows a layout draws: the query answer plus what is loading. */
export interface ViewData extends ViewQueryData {
  /** Showing the previous answer while a newer one loads (after a change, search or filter). */
  refreshing: boolean;
  /** "Load more" requests in flight, by loadMoreKey(groupKey, subGroupKey). */
  loadingMore: readonly string[];
}

/** Names one "Load more": the view (''), a group, or a board sub-group inside a group. */
export function loadMoreKey(groupKey?: string, subGroupKey?: string): string {
  if (subGroupKey === undefined) return groupKey ?? '';
  return JSON.stringify([groupKey ?? '', subGroupKey]);
}

/** Where pages open: the view's "Open pages in" setting. */
export type OpenMode = View['openPagesIn'];

/** A new row from a layout. The shell adds the view and the default template. */
export interface NewRow {
  title?: string;
  /** Stored values to start with (for example the date of the calendar day it was made on). */
  values?: Partial<Record<Id, unknown>>;
  /** A template other than the view's default; null: an empty row. */
  templateId?: Id | null;
  /** Grouped views: the group it was made in (the server sets the group's value). */
  groupKey?: string;
  /** Goes right after this row in manual order; absent: at the end. */
  afterRowId?: Id;
}

/** Where a moved row lands (drag and drop, or Move to in the row's menu). */
export interface RowPlace {
  /** The row it goes before; absent or null: the end. */
  beforeRowId?: Id | null;
  /** Grouped views: the group it leaves and the group it lands in. */
  fromGroupKey?: string;
  toGroupKey?: string;
  /** Boards with sub-groups: the lane it leaves and the lane it lands in. */
  fromSubGroupKey?: string;
  toSubGroupKey?: string;
}

/**
 * Everything a layout may change. Each change shows at once. If the server refuses, it rolls back,
 * the shell says why in a toast, and the promise rejects with the error (nothing more to show).
 */
export interface ViewActions {
  /** Opens the row where the view says ("Open pages in"), or in `mode`. */
  openRow(rowId: Id, mode?: OpenMode): void;
  /** Resolves to the row the server made. */
  createRow(input?: NewRow): Promise<Row>;
  /**
   * Changed properties only. A null value clears it; the Name property's value is the title.
   * `newOptions`: options typed into Select or Multi-select cells (CommitDetails.newOptions), by
   * property id. They go into the property first (as addOptions), and both changes show at once.
   */
  updateValues(
    rowId: Id,
    values: Partial<Record<Id, unknown>>,
    newOptions?: Partial<Record<Id, readonly SelectOption[]>>,
  ): Promise<Row>;
  /**
   * Adds options to a Select or Multi-select property (Can edit, and Lock structure off).
   * One whose name the property already has, ignoring case, isn't added again: the answer maps
   * each option's id to the id to save (its own, or the one of that name).
   */
  addOptions(propertyId: Id, options: readonly SelectOption[]): Promise<Record<Id, Id>>;
  /**
   * People to pick in Person cells: the workspace's members and guests whose name or email
   * matches ("" lists everyone). A read, so it rejects without a toast.
   */
  searchPeople(query: string): Promise<PersonChoice[]>;
  /** Copies the rows (values and content, new ID numbers). Resolves to the copies, in order. */
  duplicateRows(rowIds: readonly Id[]): Promise<Row[]>;
  /** Moves the rows to Trash; the shell offers Undo for 8 seconds. */
  trashRows(rowIds: readonly Id[]): Promise<void>;
  /**
   * Manual order, and moves between groups: the shell writes the value of the group (and lane) the
   * row lands in. A group that can't set a value (dates, formulas, "Rows you can't open") keeps the
   * row where it was, and sorted views keep their order.
   */
  moveRow(rowId: Id, place: RowPlace): Promise<void>;
  /**
   * View settings (not its id, dashboard or row order). With edit_views they're saved for everyone;
   * for anyone else the filter, sorts and grouping become "Changed for you only" (as setOverride)
   * and the rest is left out.
   */
  updateView(patch: ViewChange): Promise<void>;
  /** "Changed for you only": filter, sorts or grouping on top of the saved view. Never saved. */
  setOverride(override: ViewOverride | null): void;
  /** The next page of the view, of a group or of a board sub-group. */
  loadMore(groupKey?: string, subGroupKey?: string): Promise<void>;
  /**
   * Opens a toolbar panel as its button would (under the toolbar, or as a dialog), at `target`:
   * a column's Filter is `openPanel('filter', { propertyId })`. When it closes, focus goes back to
   * `opener` if it's still on the page.
   */
  openPanel(panel: PanelName, target?: PanelTarget, opener?: HTMLElement | null): void;
}

/** What the shell hands to a layout. */
export interface LayoutProps {
  meta: DatabaseMeta;
  /** The saved view with the viewer's "Changed for you only" override applied. */
  view: View;
  /**
   * Table, list, gallery and feed layouts always get rows: without any, the shell shows "No rows
   * yet." or "No rows match." instead. The other layouts draw their frame without rows.
   */
  data: ViewData;
  viewer: Viewer;
  actions: ViewActions;
  /** The viewer can't change rows here (Can view, Can comment, or offline). */
  readOnly: boolean;
}

/**
 * Whether the viewer may change properties and views for everyone: Can edit, and Lock structure
 * off. (Rows stay editable with Lock structure on.)
 */
export function canEditStructure(meta: Pick<DatabaseMeta, 'viewerAccess' | 'locked'>): boolean {
  return can('edit_properties', meta.viewerAccess, { locked: meta.locked });
}

/** Where an uploaded file opens (GET /api/files/:id); web links open their own address. */
export function fileUrl(file: Pick<FileRef, 'id'>): string {
  return `/api/files/${encodeURIComponent(file.id)}`;
}

/**
 * The `ctx` for CellView and CellEditor: the viewer, people's names and photos, related rows'
 * titles, and where related rows and files open. Make it once per answer (useMemo).
 */
export function cellContext(
  meta: Pick<DatabaseMeta, 'properties'>,
  data: Pick<ViewQueryData, 'people' | 'rowTitles'>,
  viewer: Viewer,
): CellContext {
  const { people, rowTitles } = data;
  return {
    viewer,
    properties: meta.properties,
    userName: (id) => people?.[id]?.name,
    userAvatar: (id) => people?.[id]?.avatarUrl ?? undefined,
    rowTitle: (id) => rowTitles[id],
    rowHref: (id) => pageUrl(id),
    fileHref: fileUrl,
  };
}

// ---------------------------------------------------------------- what a toolbar panel gets

/**
 * What the toolbar opens: Filter, Sort, Group and Properties (its buttons) and Layout ("…" →
 * Layout) open under the toolbar; Import CSV, Export CSV, Row access and Property access ("…")
 * open as dialogs, with the title and Close drawn by the shell.
 */
export const PANEL_NAMES = [
  'filter',
  'sort',
  'group',
  'properties',
  'layout',
  'importCsv',
  'exportCsv',
  'rowAccess',
  'propertyAccess',
] as const;

export type PanelName = (typeof PANEL_NAMES)[number];

export const PANEL_LABELS: Record<PanelName, string> = {
  filter: 'Filter',
  sort: 'Sort',
  group: 'Group',
  properties: 'Properties',
  layout: 'Layout',
  importCsv: 'Import CSV',
  exportCsv: 'Export CSV',
  rowAccess: 'Row access',
  propertyAccess: 'Property access',
};

/** The panels drawn as dialogs: the CSV dialogs of spec section 2, and access (section 3.12). */
export const DIALOG_PANELS: ReadonlySet<PanelName> = new Set<PanelName>([
  'importCsv',
  'exportCsv',
  'rowAccess',
  'propertyAccess',
]);

/**
 * Where a panel opens when something other than its button opens it (Filter, so far). The panel
 * decides what that shows.
 */
export interface PanelTarget {
  /** A column's Filter (actions.openPanel): the rule on this property, or a new one. */
  propertyId?: Id;
  /** A rule's chip in the filter bar: that rule. */
  ruleId?: Id;
  /** The "Advanced filter" chip: the filter's groups. */
  advanced?: boolean;
}

/** What the shell hands to a panel. */
export interface PanelProps {
  /** Which panel this is (one component may draw several). */
  panel: PanelName;
  meta: DatabaseMeta;
  /** The view as shown: the saved view with the viewer's "Changed for you only" override. */
  view: View;
  /** The view as saved for everyone. */
  savedView: View;
  viewer: Viewer;
  /**
   * `actions.updateView` saves for everyone when canEditViews; otherwise the filter, sorts and
   * grouping in the change become "Changed for you only" and the rest is left out.
   */
  actions: ViewActions;
  /** Can edit, Lock structure off and online: changes to the view are saved for everyone. */
  canEditViews: boolean;
  /**
   * The view's answer as the layout gets it: rows, groups, lanes and counts. Absent until it
   * loads, and while the view is blocked.
   */
  data?: ViewData;
  /** From the view's answer: the properties the viewer can see, in database order. */
  propertyIds?: readonly Id[];
  /** From the view's answer: the titles of the rows its rows link to. */
  rowTitles?: Readonly<Record<Id, string>>;
  /** Where it was opened at (actions.openPanel, a filter chip). Absent: from its button. */
  target?: PanelTarget;
  /** Closes the panel and gives focus back to its button. Esc and presses outside close it too. */
  close(): void;
}
