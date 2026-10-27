/**
 * The contract between the database shell and the layouts (table, board, list, gallery, calendar,
 * timeline, chart, feed, dashboard and form). The shell loads the database and the view's rows and
 * hands them to the layout as LayoutProps; a layout changes anything only through `actions`.
 *
 * The query answer types mirror `@carehub/databases/engine` (engine/shapes.ts). Until the engine is
 * on main they live here; then this file re-exports the engine's types and nothing else changes.
 */
import type { ViewTotal } from '@carehub/databases/aggregate';
import type {
  ComputedValue,
  DatabaseMeta,
  Id,
  Instant,
  OptionColor,
  Row,
  View,
  ViewOverride,
  Viewer,
} from '@carehub/databases';

// ---------------------------------------------------------------- the query answer (engine shapes)

/** A row as the viewer may see it. */
export interface QueryRow {
  id: Id;
  title: string;
  icon: string | null;
  /** The form (view id) it was sent with, if any. */
  formId: Id | null;
  /** Stored values of the properties the viewer can see; relations list only rows they can open. */
  values: Partial<Record<Id, unknown>>;
  /** Formula and rollup results the viewer can see. */
  computed: Partial<Record<Id, ComputedValue>>;
  /** Relation property id → links left out because the viewer can't open them. */
  hiddenLinks: Partial<Record<Id, number>>;
  /** null when every property that shows it is hidden from the viewer. */
  createdAt: Instant | null;
  createdBy: Id | null;
  editedAt: Instant | null;
  editedBy: Id | null;
  uniqueNumber: number | null;
  /** Sub-items only: where the line sits. */
  depth?: number;
  parentId?: Id | null;
  childCount?: number;
  /** Greyed out: it doesn't match, but a sub-item under it does. */
  context?: boolean;
}

/** A group (board column, table group) or a board sub-group. */
export interface QueryGroup {
  key: string;
  label: string;
  color?: OptionColor;
  hidden: boolean;
  collapsedKey: string;
  /** Rows in the group that match, all of them (not just the ones loaded). */
  count: number;
  /** The view's calculations over those rows. */
  totals: Partial<Record<Id, ViewTotal>>;
  /** Board column headers: the header calculation, when the board sets one on a property. */
  header?: ViewTotal;
  /** This page of the group's rows (none for hidden groups until asked for). */
  rows: QueryRow[];
  /** For "Load more"; null when everything is loaded. */
  nextCursor: string | null;
  /** Boards with sub-groups: one per lane, in lane order. The rows are in these. */
  subGroups?: QueryGroup[];
}

/** A board lane (sub-group) across every column. */
export interface QueryLane {
  key: string;
  label: string;
  color?: OptionColor;
  hidden: boolean;
  collapsedKey: string;
  count: number;
}

/** The answer for a view. */
export interface ViewQueryData {
  /** Rows that match the filter and search among the rows the viewer can open. */
  count: number;
  totals: Partial<Record<Id, ViewTotal>>;
  /** Ungrouped views: this page of rows ([] when grouped). */
  rows: QueryRow[];
  nextCursor: string | null;
  groups: QueryGroup[] | null;
  lanes: QueryLane[] | null;
  /** Titles of the rows these rows link to (only ones the viewer can open). */
  rowTitles: Record<Id, string>;
  /** The properties the viewer can see, in database order. */
  propertyIds: Id[];
  /** An answer to a cursor: only that group (and sub-group) is listed, or none if it's gone. */
  continued: boolean;
  /** The time budget ran out; some results say "⚠ Too slow". */
  timedOut: boolean;
}

/** The whole answer for a view that uses a property the viewer can't see. */
export interface ViewQueryBlocked {
  blocked: string;
}

export type ViewQueryResult = ViewQueryBlocked | ViewQueryData;

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
