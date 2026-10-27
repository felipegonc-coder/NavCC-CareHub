/**
 * The view engine's input and result (W1c-1). The server answers every database query with
 * runViewQuery; the web runs the same code for instant feedback while saves are in flight.
 * Access, property access, formulas and sub-items come in as functions, so this stays pure.
 */
import type { ViewTotal } from '../aggregate';
import type { RowColor } from '../color';
import type {
  AccessLevel,
  ComputedValue,
  EvalContext,
  Id,
  Instant,
  OptionColor,
  Property,
  Row,
  View,
  ViewOverride,
  Viewer,
} from '../types';

/** The whole answer for a view that uses a property the viewer can't see (spec 3.12, issue #46). */
export const VIEW_BLOCKED = "This view uses a property you can't see.";
/** A formula or rollup result asked for after the query's time budget ran out. */
export const QUERY_TOO_SLOW = '⚠ Too slow';
/**
 * Stands in for a row the viewer can't open inside formula and rollup results, so the id never
 * leaves the server; cells still show "1 row you can't open".
 */
export const HIDDEN_ROW_ID = '';

/** A time limit for one whole query, passed through to `computed` (the formula engine checks it too). */
export interface QueryBudget {
  /** Milliseconds from any fixed point (package code can't read the time itself). */
  clock(): number;
  /** Nothing more is worked out once clock() passes this. */
  deadline: number;
}

/** What `computed` is given: the query's context, the time budget and this database's open rows. */
export interface ComputeContext extends EvalContext {
  /**
   * Remembered for the whole query and guarded against loops: read this database's other formulas
   * and rollups through it (hidden ones, and properties elsewhere, give empty).
   */
  computed(row: Row, propertyId: Id): ComputedValue;
  /** A row of this database the viewer can open, with hidden values left out; undefined otherwise. */
  openRow(id: Id): Row | undefined;
  budget?: QueryBudget;
}

/** One line of a view with sub-items (hierarchy.ts's SubItemLine has this shape). */
export interface ArrangedLine {
  row: Row;
  depth: number;
  parentId: Id | null;
  childCount: number;
  /** Greyed out: it doesn't match, but a sub-item under it does. Not counted or totalled. */
  context: boolean;
}

/** Who is looking and what they may see, worked out by the caller. */
export interface ViewerAccess {
  viewer: Viewer;
  userName(id: Id): string | undefined;
  isRemovedUser?(id: Id): boolean;
  /** The viewer's access to a row of this database (database level, the row's sharing, row rules). */
  rowAccess(row: Row): AccessLevel;
  /**
   * Whether the property's see list lets the viewer in, asked again on every query. Asked for this
   * database's properties and for those of related databases that formulas and rollups read. Name
   * is always visible here whatever it says (say true for Name elsewhere too).
   */
  canSeeProperty(propertyId: Id): boolean;
  /**
   * What a formula or rollup reads directly: properties of this database and, through relations,
   * of related ones (for a rollup elsewhere: its relation and target too); [] for anything else.
   * The engine follows every chain: reading anything hidden hides it too.
   */
  dependsOn(propertyId: Id): readonly Id[];
  /** A formula or rollup result for this viewer. Absent: every result is empty. */
  computed?(row: Row, propertyId: Id, ctx: ComputeContext): ComputedValue;
  /**
   * Title of a row in another database, or undefined when the viewer can't open it. Absent: none
   * can be opened. Rows of this database follow rowAccess instead.
   */
  rowTitle?(id: Id): string | undefined;
  budget?: QueryBudget;
}

/** Everything one query needs. */
export interface ViewQueryInput extends ViewerAccess {
  /** All of the database's properties; the engine works out which the viewer sees. */
  properties: readonly Property[];
  /** Every row of the database (no templates, nothing in Trash), in any order. */
  rows: readonly Row[];
  view: View;
  /** "Changed for you only", applied on top of the saved view. */
  override?: ViewOverride | null;
  /** Toolbar search. */
  search?: string | null;
  /** "Load more": the nextCursor of a group (or of the view) from an earlier answer. */
  cursor?: string | null;
  /**
   * Sub-items (when on): the lines to show for a group's rows. Gets every row of the group the
   * viewer can open, in view order, and whether each matches the filter and search. Not used on
   * boards with sub-groups.
   */
  arrange?(rows: readonly Row[], matches: (row: Row) => boolean): readonly ArrangedLine[];
}

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
  /**
   * Conditional color (the view's color rules): the row's and each cell's, as color names the
   * screens map to the design kit. `{ row: null, cells: {} }` when nothing matches.
   */
  color: RowColor;
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

/** The whole answer when the view uses a property the viewer can't see: no rows, counts or totals. */
export interface ViewQueryBlocked {
  blocked: string;
}

/** What runViewQuery gives. */
export type ViewQueryResult = ViewQueryBlocked | ViewQueryData;
