/**
 * Answering a view (additions 12): property access, row access, "Changed for you only", filter,
 * search, sort, groups and sub-groups, totals and paging, over the rows one viewer can open. Pure:
 * the same input gives the same answer whatever order the rows come in.
 */
import { viewTotals, type ViewTotal } from '../aggregate';
import { filterPredicate, pruneFilter } from '../filter';
import { groupRows, type RowGroup } from '../group';
import { rowSearchText, searchWords, textHasWords } from '../search';
import { pruneSorts, sortRows } from '../sort';
import {
  ACCESS_LEVELS,
  LIMITS,
  type AccessLevel,
  type Id,
  type OptionColor,
  type Property,
  type Row,
  type View,
} from '../types';
import { makeContext } from './context';
import { decodeCursor, pageSize, pageStart, shareRows, takePage } from './paging';
import { hiddenMetaFields, projectRow, withoutHidden, type Projection } from './rows';
import {
  VIEW_BLOCKED,
  type ArrangedLine,
  type ComputeContext,
  type QueryGroup,
  type QueryRow,
  type ViewQueryBlocked,
  type ViewQueryData,
  type ViewQueryInput,
  type ViewQueryResult,
} from './shapes';
import { applyOverride, usesHiddenProperty, visiblePropertyIds } from './visibility';

/** Layouts that show groups (spec 3.2: table, list, gallery and timeline optionally; boards always). */
const GROUPED_LAYOUTS: ReadonlySet<View['layout']> = new Set([
  'table',
  'board',
  'list',
  'gallery',
  'timeline',
]);
const VIEW_INDEX = ACCESS_LEVELS.indexOf('view');

/** A group's or sub-group's lines and the rows it counts (lines that aren't context). */
interface Cell {
  meta: RowGroup;
  lines: ArrangedLine[];
  counted: Row[];
  subs: Cell[] | null;
}

/** Everything worked out before paging. */
interface Prepared {
  view: View;
  ctx: ComputeContext;
  properties: Property[];
  hiddenMeta: Set<string>;
  /** Every counted row, in view order. */
  counted: Row[];
  /** Ungrouped views. */
  lines: ArrangedLine[] | null;
  groups: Cell[] | null;
  lanes: RowGroup[] | null;
  placed: boolean;
  state: { timedOut: boolean };
}

const canView = (level: AccessLevel): boolean => ACCESS_LEVELS.indexOf(level) >= VIEW_INDEX;
const flat = (row: Row): ArrangedLine => ({
  row,
  depth: 0,
  parentId: null,
  childCount: 0,
  context: false,
});
const countedRows = (lines: readonly ArrangedLine[]): Row[] =>
  lines.filter((l) => !l.context).map((l) => l.row);

/** A group with its lines (and sub-groups), keeping only lines from rows that were given. */
function cellOf(meta: RowGroup, lines: ArrangedLine[], subs: Cell[] | null = null): Cell {
  return { meta, lines, counted: countedRows(lines), subs };
}

/** Steps 1–5 of the query: everything but totals, paging and the rows sent out. */
function prepare(input: ViewQueryInput): Prepared | ViewQueryBlocked {
  const view = applyOverride(input.view, input.override);
  const visible = visiblePropertyIds(input.properties, input.canSeeProperty, input.dependsOn);
  if (usesHiddenProperty(view, input.properties, visible)) return { blocked: VIEW_BLOCKED };
  const properties = input.properties.filter((p) => visible.has(p.id));
  const stripping = properties.length < input.properties.length;
  // One fixed order (by id) first, so the answer can't depend on the order rows came in.
  const rows = [...input.rows]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .filter((row) => canView(input.rowAccess(row)))
    .map((row) => withoutHidden(row, visible, stripping));
  const open = new Map(rows.map((r) => [r.id, r]));
  const state = { timedOut: false };
  const ctx = makeContext(input, properties, open, state);

  const filter = filterPredicate(pruneFilter(view.filter, properties), ctx);
  const words = searchWords(input.search ?? '');
  const seen = new Map<Id, boolean>();
  const matches = (row: Row): boolean => {
    let yes = seen.get(row.id);
    if (yes === undefined) {
      yes = filter(row) && (!words.length || textHasWords(rowSearchText(row, ctx), words));
      seen.set(row.id, yes);
    }
    return yes;
  };

  const grouping = GROUPED_LAYOUTS.has(view.layout) ? view.grouping : null;
  const subGrouping = grouping && view.layout === 'board' ? view.subGrouping : null;
  const arrange = subGrouping ? undefined : input.arrange;
  const pool = arrange ? rows : rows.filter(matches);
  const sorted =
    view.layout === 'feed' && !pruneSorts(view.sorts, properties).length
      ? sortRows(pool, [], ctx).reverse()
      : sortRows(pool, view.sorts, ctx, view.manualOrder);
  const linesOf = (list: readonly Row[]): ArrangedLine[] => {
    if (!arrange) return list.map(flat);
    const given = new Map(list.map((r) => [r.id, r]));
    return arrange(list, matches).flatMap((l) => {
      const row = given.get(l.row.id);
      return row ? [{ ...l, row }] : [];
    });
  };

  const base = { view, ctx, properties, state, placed: Boolean(arrange) };
  const hiddenMeta = hiddenMetaFields(input.properties, visible);
  if (!grouping) {
    const lines = linesOf(sorted);
    const counted = countedRows(lines);
    return { ...base, hiddenMeta, counted, lines, groups: null, lanes: null };
  }
  const board = view.layout === 'board';
  let groups = groupRows(sorted, grouping, ctx, { includeEmptyGroups: board }).map((g) =>
    cellOf(g, linesOf(g.rows)),
  );
  if (arrange) {
    // Groups that only hold rows that don't match go, unless a board always lists them.
    const listed = new Set(
      board && !grouping.hideEmpty
        ? groupRows([], grouping, ctx, { includeEmptyGroups: true }).map((g) => g.key)
        : [],
    );
    groups = groups.filter((g) => g.lines.length > 0 || listed.has(g.meta.key));
  }
  let lanes: RowGroup[] | null = null;
  if (subGrouping) {
    const laneList = groupRows(sorted, subGrouping, ctx, { includeEmptyGroups: true });
    lanes = laneList;
    groups = groups.map((g) => {
      const inGroup = new Map(groupRows(g.meta.rows, subGrouping, ctx).map((s) => [s.key, s]));
      const subs = laneList.map((lane) => {
        const rowsHere = inGroup.get(lane.key)?.rows ?? [];
        return cellOf({ ...lane, rows: rowsHere }, rowsHere.map(flat));
      });
      return cellOf(g.meta, g.lines, subs);
    });
  }
  const ids = new Set(groups.flatMap((g) => g.counted.map((r) => r.id)));
  const counted = sorted.filter((r) => ids.has(r.id));
  return { ...base, hiddenMeta, counted, lines: null, groups, lanes };
}

/** A leaf: a group without sub-groups, or one sub-group, with its cursor path. */
interface Leaf {
  path: string[];
  cell: Cell;
  hidden: boolean;
}

function leavesOf(groups: readonly Cell[]): Leaf[] {
  return groups.flatMap((g) =>
    g.subs
      ? g.subs.map((s) => ({
          path: [g.meta.key, s.meta.key],
          cell: s,
          hidden: g.meta.hidden || s.meta.hidden,
        }))
      : [{ path: [g.meta.key], cell: g, hidden: g.meta.hidden }],
  );
}

const pathKey = (path: readonly string[]): string => JSON.stringify(path);
const sameRows = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((k, i) => k === b[i]);

type Page = { rows: QueryRow[]; next: string | null };

/**
 * Answers a view for one viewer (W1c-1):
 * 1. A view (after the override) that uses a property the viewer can't see gives only `{ blocked }`,
 *    checked on every query rather than only when the view was saved.
 * 2. Only rows the viewer can open take part in anything after that, counts included.
 * 3. The override ("Changed for you only") applies on top of the saved view.
 * 4. Filter (cleaned against the visible properties), search, sort (manual order with no sorts;
 *    feeds newest first), then groups and board sub-groups.
 * 5. Totals over every matching row, overall and per group.
 * 6. One page per group (the load limit; at most LIMITS.queryPageRows rows in all), with cursors.
 * 7. Rows carry only what the viewer may see (see projectRow).
 * Formula and rollup results are worked out once per row and property, guarded against loops, and
 * stop with "⚠ Too slow" once the time budget runs out.
 */
export function runViewQuery(input: ViewQueryInput): ViewQueryResult {
  const prep = prepare(input);
  if ('blocked' in prep) return prep;
  const { view, ctx } = prep;
  const size = pageSize(view);
  const continued = Boolean(input.cursor);
  const cursor = input.cursor ? decodeCursor(input.cursor) : null;
  const proj: Projection = {
    properties: prep.properties,
    ctx,
    hiddenMeta: prep.hiddenMeta,
    titles: {},
  };
  const page = (lines: readonly ArrangedLine[], path: string[], start: number, n: number): Page => {
    const { page: part, next } = takePage(lines, (l) => l.row.id, path, start, n);
    return { rows: part.map((l) => projectRow(l, proj, prep.placed)), next };
  };
  const totals = (rows: readonly Row[]): Partial<Record<Id, ViewTotal>> =>
    viewTotals(rows, view.calculations, ctx);
  const out: ViewQueryData = {
    count: prep.counted.length,
    totals: totals(prep.counted),
    rows: [],
    nextCursor: null,
    groups: null,
    lanes: null,
    rowTitles: proj.titles,
    propertyIds: prep.properties.map((p) => p.id),
    continued,
    timedOut: false,
  };

  if (prep.lines) {
    const lines = prep.lines;
    const ok = !continued || (cursor !== null && cursor.path.length === 0);
    const start = cursor
      ? pageStart(
          lines.map((l) => l.row.id),
          cursor,
        )
      : 0;
    const first = ok ? page(lines, [], start, size) : { rows: [], next: null };
    out.rows = first.rows;
    out.nextCursor = first.next;
  } else if (prep.groups) {
    const leaves = leavesOf(prep.groups);
    const pages = new Map<string, Page>();
    if (!continued) {
      const wants = leaves.map((l) => (l.hidden ? 0 : Math.min(size, l.cell.lines.length)));
      const shares = shareRows(wants, LIMITS.queryPageRows);
      leaves.forEach((l, i) =>
        pages.set(pathKey(l.path), page(l.cell.lines, l.path, 0, shares[i] ?? 0)),
      );
    } else if (cursor) {
      const leaf = leaves.find((l) => sameRows(l.path, cursor.path));
      if (leaf) {
        const start = pageStart(
          leaf.cell.lines.map((l) => l.row.id),
          cursor,
        );
        pages.set(pathKey(leaf.path), page(leaf.cell.lines, leaf.path, start, size));
      }
    }
    out.groups = groupsOut(prep, pages, continued);
    out.lanes = prep.lanes?.map((lane) => ({ ...laneMeta(lane), count: lane.rows.length })) ?? null;
  }
  out.timedOut = prep.state.timedOut;
  return out;
}

type GroupMeta = Pick<QueryGroup, 'key' | 'label' | 'color' | 'hidden' | 'collapsedKey'>;

function laneMeta(g: RowGroup): GroupMeta {
  const meta: GroupMeta = {
    key: g.key,
    label: g.label,
    hidden: g.hidden,
    collapsedKey: g.collapsedKey,
  };
  if (g.color) meta.color = g.color;
  return meta;
}

/** The groups sent out: all of them, or only the continued one (and its sub-group). */
function groupsOut(
  prep: Prepared,
  pages: ReadonlyMap<string, Page>,
  continued: boolean,
): QueryGroup[] {
  const { view, ctx } = prep;
  const header = view.layout === 'board' ? view.board?.headerCalculation : undefined;
  const make = (cell: Cell, path: string[], top: boolean): QueryGroup | null => {
    const subs = cell.subs
      ?.map((s) => make(s, [...path, s.meta.key], false))
      .filter((s): s is QueryGroup => s !== null);
    const own = pages.get(pathKey(path));
    if (continued && !own && !subs?.length) return null;
    const group: QueryGroup = {
      ...laneMeta(cell.meta),
      count: cell.counted.length,
      totals: viewTotals(cell.counted, view.calculations, ctx),
      rows: own?.rows ?? [],
      nextCursor: own?.next ?? null,
    };
    if (subs) group.subGroups = subs;
    if (top && header?.propertyId && header.aggregate !== 'none') {
      const total = viewTotals(cell.counted, { [header.propertyId]: header.aggregate }, ctx);
      const value = total[header.propertyId];
      if (value) group.header = value;
    }
    return group;
  };
  return (prep.groups ?? [])
    .map((g) => make(g, [g.meta.key], true))
    .filter((g): g is QueryGroup => g !== null);
}

/** Group counts without rows, totals or paging. */
export interface GroupCount {
  key: string;
  label: string;
  color?: OptionColor;
  hidden: boolean;
  count: number;
  subGroups?: GroupCount[];
}

/** What countRows gives. */
export type RowCounts =
  ViewQueryBlocked | { count: number; groups: GroupCount[] | null; lanes: GroupCount[] | null };

/**
 * How many rows the view shows, overall and per group (and board sub-group), for the same viewer
 * and with the same rules as runViewQuery, without sending rows or working out totals.
 */
export function countRows(input: Omit<ViewQueryInput, 'cursor'>): RowCounts {
  const prep = prepare(input);
  if ('blocked' in prep) return prep;
  const count = (cell: Cell): GroupCount => {
    const { key, label, color, hidden } = cell.meta;
    const out: GroupCount = { key, label, hidden, count: cell.counted.length };
    if (color) out.color = color;
    if (cell.subs) out.subGroups = cell.subs.map(count);
    return out;
  };
  return {
    count: prep.counted.length,
    groups: prep.groups?.map(count) ?? null,
    lanes: prep.lanes?.map((lane) => count(cellOf(lane, lane.rows.map(flat)))) ?? null,
  };
}
