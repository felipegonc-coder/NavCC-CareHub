/**
 * The contract between the database shell and the layouts (table, board, list, gallery, calendar,
 * timeline, chart, feed, dashboard and form), and between the toolbar and its panels. The shell
 * loads the database and the view's rows and hands them to the layout as LayoutProps; a layout or
 * panel changes anything only through `actions`.
 *
 * The query answer (rows, groups, lanes, counts and totals) is the engine's, from
 * `@carehub/databases/engine`.
 */
import type { DatabaseMeta, Id, Row, View, ViewOverride, Viewer } from '@carehub/databases';
import type {
  ViewQueryBlocked,
  ViewQueryData,
  ViewQueryResult,
} from '@carehub/databases/engine';

export type {
  QueryGroup,
  QueryLane,
  QueryRow,
  ViewQueryBlocked,
  ViewQueryData,
  ViewQueryResult,
} from '@carehub/databases/engine';

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
  /** Changed properties only. A null value clears it; the Name property's value is the title. */
  updateValues(rowId: Id, values: Partial<Record<Id, unknown>>): Promise<Row>;
  /** Moves the rows to Trash; the shell offers Undo for 8 seconds. */
  trashRows(rowIds: readonly Id[]): Promise<void>;
  /**
   * Manual order, and moves between groups: the shell writes the value of the group (and lane) the
   * row lands in. A group that can't set a value (dates, formulas, "Rows you can't open") keeps the
   * row where it was, and sorted views keep their order.
   */
  moveRow(rowId: Id, place: RowPlace): Promise<void>;
  /**
   * View settings. With edit_views they're saved for everyone; for anyone else the filter, sorts
   * and grouping become "Changed for you only" (as setOverride) and the rest is left out.
   */
  updateView(patch: Partial<View>): Promise<void>;
  /** "Changed for you only": filter, sorts or grouping on top of the saved view. Never saved. */
  setOverride(override: ViewOverride | null): void;
  /** The next page of the view, of a group or of a board sub-group. */
  loadMore(groupKey?: string, subGroupKey?: string): Promise<void>;
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

// ---------------------------------------------------------------- what a toolbar panel gets

/**
 * What the toolbar opens: Filter, Sort, Group and Properties (its buttons) and Layout ("…" →
 * Layout) open under the toolbar; Import CSV and Export CSV ("…") open as dialogs, with the title
 * and Close drawn by the shell.
 */
export const PANEL_NAMES = [
  'filter',
  'sort',
  'group',
  'properties',
  'layout',
  'importCsv',
  'exportCsv',
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
};

/** The panels drawn as dialogs (the CSV dialogs of spec section 2). */
export const DIALOG_PANELS: ReadonlySet<PanelName> = new Set<PanelName>(['importCsv', 'exportCsv']);

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
  /** Closes the panel and gives focus back to its button. Esc and presses outside close it too. */
  close(): void;
}
