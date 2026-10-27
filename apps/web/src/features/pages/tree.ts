/** Pure helpers for the sidebar page tree: siblings, visible rows, keyboard moves and edits. */

/** What the tree needs from an entry (a page or a full-page database). */
export interface TreeEntry {
  id: string;
  parentId: string | null;
  /** Fractional sort key; siblings sort by plain string order, like the server. */
  position: string;
}

/** Each level shows this many entries, then "Show 20 more" adds `MORE_STEP` at a time. */
export const FIRST_STEP = 50;
export const MORE_STEP = 20;

export function comparePosition(a: TreeEntry, b: TreeEntry): number {
  if (a.position !== b.position) return a.position < b.position ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/**
 * Siblings by parent, in order. An entry whose parent isn't in the list (one the person
 * can't open) is shown at the top level, as the spec asks.
 */
export function groupChildren<T extends TreeEntry>(nodes: readonly T[]): Map<string | null, T[]> {
  const ids = new Set(nodes.map((node) => node.id));
  const byParent = new Map<string | null, T[]>();
  for (const node of nodes) {
    const parent = node.parentId !== null && ids.has(node.parentId) ? node.parentId : null;
    const siblings = byParent.get(parent);
    if (siblings) siblings.push(node);
    else byParent.set(parent, [node]);
  }
  for (const siblings of byParent.values()) siblings.sort(comparePosition);
  return byParent;
}

export type TreeRow<T> =
  | {
      kind: 'node';
      key: string;
      node: T;
      level: number;
      posInSet: number;
      setSize: number;
      expandable: boolean;
      expanded: boolean;
    }
  | { kind: 'more'; key: string; parentId: string | null; level: number; posInSet: number }
  | { kind: 'empty'; key: string; parentId: string; level: number }
  | { kind: 'extra'; key: string; node: T; level: number };

export interface RowOptions<T> {
  /** Keys of open entries (see `rowKey`). */
  expanded: ReadonlySet<string>;
  /** How many entries a level shows, by parent ID (`null` for the top). */
  shown?: ReadonlyMap<string | null, number> | undefined;
  /** Entries that open into something other than sub-pages, such as a database's views. */
  hasExtra?: ((node: T) => boolean) | undefined;
  /** Prefix for keys, so the same page can be open in Favorites and closed in its space. */
  scope?: string | undefined;
  /** Start from this entry's children instead of the top. */
  rootId?: string | null | undefined;
  /** Level of the first rows. */
  firstLevel?: number | undefined;
}

export function rowKey(scope: string | undefined, id: string): string {
  return scope ? `${scope}:${id}` : id;
}

interface Walk<T> {
  byParent: ReadonlyMap<string | null, readonly T[]>;
  options: RowOptions<T>;
  rows: TreeRow<T>[];
}

/** Adds one entry's row, and what's under it when it's open. `path` guards against cycles. */
function pushEntry<T extends TreeEntry>(
  walk: Walk<T>,
  node: T,
  at: { level: number; posInSet: number; setSize: number; scope: string | undefined },
  path: ReadonlySet<string>,
) {
  const { byParent, options, rows } = walk;
  const key = rowKey(at.scope, node.id);
  const extra = options.hasExtra?.(node) ?? false;
  const kids = byParent.get(node.id)?.length ?? 0;
  const open = options.expanded.has(key);
  rows.push({
    kind: 'node',
    key,
    node,
    level: at.level,
    posInSet: at.posInSet,
    setSize: at.setSize,
    expandable: kids > 0 || extra || open,
    expanded: open,
  });
  if (!open) return;
  if (extra) rows.push({ kind: 'extra', key: `${key}:extra`, node, level: at.level + 1 });
  if (kids > 0) pushChildren(walk, node.id, at.level + 1, at.scope, new Set(path).add(node.id));
  else if (!extra) {
    rows.push({ kind: 'empty', key: `${key}:empty`, parentId: node.id, level: at.level + 1 });
  }
}

function pushChildren<T extends TreeEntry>(
  walk: Walk<T>,
  parentId: string | null,
  level: number,
  scope: string | undefined,
  path: ReadonlySet<string>,
) {
  const children = (walk.byParent.get(parentId) ?? []).filter((node) => !path.has(node.id));
  const limit = Math.max(FIRST_STEP, walk.options.shown?.get(parentId) ?? FIRST_STEP);
  const visible = children.slice(0, limit);
  const hasMore = children.length > visible.length;
  const setSize = visible.length + (hasMore ? 1 : 0);
  visible.forEach((node, index) => {
    pushEntry(walk, node, { level, posInSet: index + 1, setSize, scope }, path);
  });
  if (hasMore) {
    const key = `${rowKey(scope, parentId ?? 'top')}:more`;
    walk.rows.push({ kind: 'more', key, parentId, level, posInSet: setSize });
  }
}

/** The rows a tree shows right now, top to bottom. */
export function visibleRows<T extends TreeEntry>(
  byParent: ReadonlyMap<string | null, readonly T[]>,
  options: RowOptions<T>,
): TreeRow<T>[] {
  const walk: Walk<T> = { byParent, options, rows: [] };
  const root = options.rootId ?? null;
  pushChildren(walk, root, options.firstLevel ?? 1, options.scope, new Set(root ? [root] : []));
  return walk.rows;
}

/** Rows the keyboard can land on. */
export function isFocusable<T>(row: TreeRow<T> | undefined): boolean {
  return row?.kind === 'node' || row?.kind === 'more';
}

/** The next row ↑ (-1) or ↓ (+1) lands on, or `index` when there's none. */
export function stepFocus<T>(rows: readonly TreeRow<T>[], index: number, step: 1 | -1): number {
  for (let i = index + step; i >= 0 && i < rows.length; i += step) {
    if (isFocusable(rows[i])) return i;
  }
  return index;
}

/** The entry ← moves to: the closest row above with a lower level, or -1. */
export function parentRow<T>(rows: readonly TreeRow<T>[], index: number): number {
  const level = rows[index]?.level ?? 1;
  for (let i = index - 1; i >= 0; i -= 1) {
    const row = rows[i];
    if (row?.kind === 'node' && row.level < level) return i;
  }
  return -1;
}

export type TreeKeyAction =
  | { type: 'focus'; index: number }
  | { type: 'expand'; key: string }
  | { type: 'collapse'; key: string }
  | { type: 'open'; index: number }
  | { type: 'menu'; index: number }
  | { type: 'rename'; index: number }
  | null;

/** What a key press on row `index` does, following the tree pattern (spec section 6). */
export function keyAction<T>(
  rows: readonly TreeRow<T>[],
  index: number,
  key: string,
  modifiers: { shift?: boolean; ctrl?: boolean } = {},
): TreeKeyAction {
  const row = rows[index];
  if (!row) return null;
  switch (key) {
    case 'ArrowDown':
      return { type: 'focus', index: stepFocus(rows, index, 1) };
    case 'ArrowUp':
      return { type: 'focus', index: stepFocus(rows, index, -1) };
    case 'Home':
      return { type: 'focus', index: stepFocus(rows, -1, 1) };
    case 'End':
      return { type: 'focus', index: stepFocus(rows, rows.length, -1) };
    case 'ArrowRight':
      if (row.kind !== 'node' || !row.expandable) return null;
      if (!row.expanded) return { type: 'expand', key: row.key };
      return isFocusable(rows[index + 1]) && (rows[index + 1]?.level ?? 0) > row.level
        ? { type: 'focus', index: index + 1 }
        : null;
    case 'ArrowLeft': {
      if (row.kind === 'node' && row.expanded) return { type: 'collapse', key: row.key };
      const parent = parentRow(rows, index);
      return parent >= 0 ? { type: 'focus', index: parent } : null;
    }
    case 'Enter':
    case ' ':
      return { type: 'open', index };
    case 'F10':
      return modifiers.shift && row.kind === 'node' ? { type: 'menu', index } : null;
    case 'ContextMenu':
      return row.kind === 'node' ? { type: 'menu', index } : null;
    case 'F2':
      return row.kind === 'node' ? { type: 'rename', index } : null;
    default:
      return null;
  }
}

/**
 * IDs from the top down to the entry's parent, so the open page can be shown, or null when the
 * entry isn't in the tree.
 */
export function pathTo<T extends TreeEntry>(
  byParent: ReadonlyMap<string | null, readonly T[]>,
  id: string,
): string[] | null {
  const parentOf = new Map<string, string | null>();
  for (const [parent, children] of byParent) {
    for (const child of children) parentOf.set(child.id, parent);
  }
  if (!parentOf.has(id)) return null;
  const path: string[] = [];
  let parent = parentOf.get(id) ?? null;
  while (parent !== null && parent !== id && !path.includes(parent)) {
    path.unshift(parent);
    parent = parentOf.get(parent) ?? null;
  }
  return path;
}
