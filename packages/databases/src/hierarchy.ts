/**
 * Sub-items (Databases spec 3.13): rows nested under a "Parent item" relation inside the same
 * database, paired with its two-way "Sub-items" relation.
 *
 * Pure functions: rows and settings in; trees, counts and messages out. Only the rows passed in are
 * used (the rows the viewer can open). A row whose parent isn't among them shows at the top level,
 * so nothing about other rows is revealed.
 */
import { LIMITS } from './types';
import type { DatabaseMeta, Id, Row, View } from './types';

/** The database's sub-item relations (DatabaseMeta.subItems while sub-items are on). */
export type SubItemSettings = NonNullable<DatabaseMeta['subItems']>;

/** How a view shows sub-items (View.subItems; absent means nested). */
export type SubItemMode = NonNullable<View['subItems']>;

/** Refusal when a change would make a row its own ancestor (sub-items) or its own blocker (dependencies). */
export const LOOP_MESSAGE = 'This would make a loop.';

/** Refusal when a change would nest sub-items more than LIMITS.subItemDepth levels deep. */
export const TOO_DEEP_MESSAGE = `Up to ${LIMITS.subItemDepth} levels deep.`;

/** A new value for one relation cell, as a save request carries it (null or [] clears the cell). */
export interface RelationEdit {
  rowId: Id;
  propertyId: Id;
  value: readonly Id[] | null;
}

/** One row in a sub-item tree. */
export interface SubItemNode {
  row: Row;
  /** 0 at the top level, 1 for its sub-items, and so on (at most LIMITS.subItemDepth - 1). */
  depth: number;
  /** The row it shows under; null at the top level. */
  parentId: Id | null;
  /** The sub-items shown under it, in the view's order. */
  children: SubItemNode[];
  /** How many sub-items it shows (children.length). Screens show the expand arrow when it's above 0. */
  childCount: number;
  /**
   * true when the row doesn't match the view's filter and shows only because a sub-item under it
   * does. Screens show it greyed out, as context.
   */
  context: boolean;
}

/** How subItemTree shows the rows. */
export interface SubItemTreeOptions {
  /** View.subItems. Absent: nested. */
  mode?: SubItemMode | undefined;
  /** Whether a row matches the view's filter and search. Absent: every row matches. */
  matches?: ((row: Row) => boolean) | undefined;
  /**
   * Nested only. false (default): filters apply to top-level rows, and a matching one shows with all
   * its sub-items. true: filters apply to sub-items too; a matching sub-item shows under its parents,
   * and parents that don't match are marked `context`. Pass View.filterSubItems.
   */
  filterSubItems?: boolean | undefined;
}

/** One line of a table or list that shows sub-items. */
export interface SubItemLine {
  row: Row;
  depth: number;
  parentId: Id | null;
  childCount: number;
  context: boolean;
  /** Its sub-items are the lines right after it. */
  expanded: boolean;
}

/** The ids in a relation cell (empty or malformed: none). */
function links(row: Row, propertyId: Id): Id[] {
  const v = row.values[propertyId];
  return Array.isArray(v) ? v.filter((x): x is Id => typeof x === 'string' && x !== '') : [];
}

/** The rows in the caller's order, each id once (the first copy wins). */
function uniqueRows(rows: readonly Row[]): Row[] {
  const seen = new Set<Id>();
  const out: Row[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

/** Adds an item to the list kept under a key. */
function pushTo<T>(map: Map<Id, T[]>, key: Id, item: T): void {
  const list = map.get(key);
  if (list) list.push(item);
  else map.set(key, [item]);
}

/** The parent a row's Parent item cell names (its first link), or null. */
export function storedParentId(row: Row, settings: SubItemSettings): Id | null {
  return links(row, settings.parentPropertyId)[0] ?? null;
}

/**
 * The parent each row shows under: its stored parent when that row is in `list`, otherwise null.
 * Older or conflicting data is repaired for display only: a loop is cut at its first row in the
 * caller's order, and a row that would sit deeper than LIMITS.subItemDepth levels goes to the top.
 */
function shownParents(list: readonly Row[], settings: SubItemSettings): Map<Id, Id | null> {
  const ids = new Set(list.map((r) => r.id));
  const parent = new Map<Id, Id | null>();
  for (const row of list) {
    const p = storedParentId(row, settings);
    parent.set(row.id, p !== null && p !== row.id && ids.has(p) ? p : null);
  }
  const position = new Map(list.map((r, i) => [r.id, i]));
  const state = new Map<Id, 'open' | 'done'>();
  for (const row of list) {
    const path: Id[] = [];
    let id: Id | null = row.id;
    while (id !== null && !state.has(id)) {
      state.set(id, 'open');
      path.push(id);
      id = parent.get(id) ?? null;
    }
    if (id !== null && state.get(id) === 'open') {
      const loop = path.slice(path.indexOf(id));
      const first = loop.reduce((a, b) =>
        (position.get(b) ?? 0) < (position.get(a) ?? 0) ? b : a,
      );
      parent.set(first, null);
    }
    for (const p of path) state.set(p, 'done');
  }
  const depth = new Map<Id, number>();
  for (const row of list) {
    const chain: Id[] = [];
    let id: Id | null = row.id;
    while (id !== null && !depth.has(id)) {
      chain.push(id);
      id = parent.get(id) ?? null;
    }
    let d = id === null ? -1 : (depth.get(id) ?? -1);
    for (const cur of chain.reverse()) {
      d = d + 1 >= LIMITS.subItemDepth ? 0 : d + 1;
      if (d === 0) parent.set(cur, null);
      depth.set(cur, d);
    }
  }
  return parent;
}

/** Rows grouped under the parent they show under, keeping the caller's order. */
function childrenOf(list: readonly Row[], parent: ReadonlyMap<Id, Id | null>): Map<Id, Row[]> {
  const kids = new Map<Id, Row[]>();
  for (const row of list) {
    const p = parent.get(row.id);
    if (p) pushTo(kids, p, row);
  }
  return kids;
}

const leaf = (row: Row): SubItemNode => ({
  row,
  depth: 0,
  parentId: null,
  children: [],
  childCount: 0,
  context: false,
});

/**
 * The rows of a view with sub-items. Pass every row the viewer can open in the view's order (already
 * sorted), before filtering, and the filter as `matches`; each level keeps that order, which is the
 * view's sort applied within the level.
 * - nested: top-level rows with their sub-items under them (see `filterSubItems`).
 * - flattened: every matching row on its own.
 * - parents_only: matching top-level rows only.
 * With `settings` null (sub-items off), every matching row shows on its own.
 */
export function subItemTree(
  rows: readonly Row[],
  settings: SubItemSettings | null,
  opts: SubItemTreeOptions = {},
): SubItemNode[] {
  const list = uniqueRows(rows);
  const matches = opts.matches ?? (() => true);
  const mode = opts.mode ?? 'nested';
  if (!settings || mode === 'flattened') return list.filter(matches).map(leaf);
  const parent = shownParents(list, settings);
  const top = list.filter((r) => parent.get(r.id) === null);
  if (mode === 'parents_only') return top.filter(matches).map(leaf);
  const kids = childrenOf(list, parent);
  const node = (row: Row, depth: number, parentId: Id | null, children: SubItemNode[]) => ({
    row,
    depth,
    parentId,
    children,
    childCount: children.length,
    context: false,
  });
  const whole = (row: Row, depth: number, parentId: Id | null): SubItemNode =>
    node(
      row,
      depth,
      parentId,
      (kids.get(row.id) ?? []).map((c) => whole(c, depth + 1, row.id)),
    );
  const pruned = (row: Row, depth: number, parentId: Id | null): SubItemNode | null => {
    const children = (kids.get(row.id) ?? [])
      .map((c) => pruned(c, depth + 1, row.id))
      .filter((c): c is SubItemNode => c !== null);
    const own = matches(row);
    return own || children.length
      ? { ...node(row, depth, parentId, children), context: !own }
      : null;
  };
  if (!opts.filterSubItems) return top.filter(matches).map((r) => whole(r, 0, null));
  return top.map((r) => pruned(r, 0, null)).filter((n): n is SubItemNode => n !== null);
}

/**
 * A tree as the lines a table or list shows, top to bottom: a row's sub-items follow it while
 * `isExpanded` says so (expanding and collapsing is the screen's job; many screens also expand
 * context rows so the matching sub-item shows).
 */
export function subItemLines(
  tree: readonly SubItemNode[],
  isExpanded: (node: SubItemNode) => boolean,
): SubItemLine[] {
  const out: SubItemLine[] = [];
  const walk = (nodes: readonly SubItemNode[]): void => {
    for (const n of nodes) {
      const expanded = n.childCount > 0 && isExpanded(n);
      const { row, depth, parentId, childCount, context } = n;
      out.push({ row, depth, parentId, childCount, context, expanded });
      if (expanded) walk(n.children);
    }
  };
  walk(tree);
  return out;
}

/**
 * How many sub-items each row has among `rows`, before any filter (rows with none are left out).
 * Counts follow the nested tree, so they never include rows the viewer can't open.
 */
export function subItemCounts(rows: readonly Row[], settings: SubItemSettings): Map<Id, number> {
  const list = uniqueRows(rows);
  const counts = new Map<Id, number>();
  for (const [id, kids] of childrenOf(list, shownParents(list, settings)))
    counts.set(id, kids.length);
  return counts;
}

/**
 * Checks a save that changes Parent item or Sub-items cells, of one row or many, before it's made:
 * LOOP_MESSAGE when a row would become its own ancestor, TOO_DEEP_MESSAGE when a chain would be more
 * than LIMITS.subItemDepth levels deep, otherwise null. Setting a row's Sub-items moves those rows
 * under it and sends the ones left out to the top level. Edits to other properties are ignored.
 * Only `rows` are known: a parent missing from them counts as a top-level row, and the server checks
 * again with every row of the database.
 */
export function checkSubItemEdits(
  rows: readonly Row[],
  settings: SubItemSettings,
  edits: readonly RelationEdit[],
): string | null {
  const parent = new Map<Id, Id | null>();
  for (const row of uniqueRows(rows)) parent.set(row.id, storedParentId(row, settings));
  const changed = new Set<Id>();
  const setParent = (child: Id, p: Id | null) => {
    parent.set(child, p);
    changed.add(child);
  };
  for (const edit of edits) {
    const ids = (edit.value ?? []).filter((id) => typeof id === 'string' && id !== '');
    if (edit.propertyId === settings.parentPropertyId) setParent(edit.rowId, ids[0] ?? null);
    if (edit.propertyId !== settings.childrenPropertyId) continue;
    const leaving = [...parent].filter(([id, p]) => p === edit.rowId && !ids.includes(id));
    for (const [id] of leaving) setParent(id, null);
    for (const id of ids) setParent(id, edit.rowId);
  }
  const above = new Map<Id, number>();
  for (const id of changed) {
    const seen = new Set<Id>([id]);
    let levels = 0;
    for (let p = parent.get(id) ?? null; p !== null; p = parent.get(p) ?? null) {
      if (seen.has(p)) return LOOP_MESSAGE;
      seen.add(p);
      levels++;
    }
    above.set(id, levels);
  }
  const kids = new Map<Id, Id[]>();
  for (const [id, p] of parent) if (p !== null) pushTo(kids, p, id);
  for (const [id, levels] of above) {
    let height = 0;
    const seen = new Set<Id>();
    for (let level = [id]; level.length; height++) {
      level.forEach((x) => seen.add(x));
      level = level.flatMap((x) => kids.get(x) ?? []).filter((x) => !seen.has(x));
    }
    if (levels + height > LIMITS.subItemDepth) return TOO_DEEP_MESSAGE;
  }
  return null;
}
