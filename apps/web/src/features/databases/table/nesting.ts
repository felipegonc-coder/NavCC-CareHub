import type { Id } from '@carehub/databases';

/** What nesting needs from a row of the answer (QueryRow's sub-item fields). */
export interface NestedRow {
  id: Id;
  depth?: number;
  parentId?: Id | null;
  childCount?: number;
  context?: boolean;
}

/**
 * Whether a row's sub-items show: what the person chose, else closed, except context rows (greyed
 * out parents of a matching sub-item), which start open so that sub-item shows.
 */
export function isOpen(row: NestedRow, chosen: ReadonlyMap<Id, boolean>): boolean {
  return (row.childCount ?? 0) > 0 && (chosen.get(row.id) ?? row.context === true);
}

/**
 * The rows that show while some are closed. `rows` come in tree order (a row's sub-items right
 * after it). A row shows when its parent shows and is open, or when its parent isn't listed.
 */
export function visibleRows<R extends NestedRow>(
  rows: readonly R[],
  open: (row: R) => boolean,
): R[] {
  const listed = new Set(rows.map((r) => r.id));
  const openShown = new Set<Id>();
  const out: R[] = [];
  for (const row of rows) {
    const parent = row.parentId ?? null;
    if (parent !== null && listed.has(parent) && !openShown.has(parent)) continue;
    out.push(row);
    if (open(row)) openShown.add(row.id);
  }
  return out;
}

/** The rows under the same parent as `row` (itself included), in order. */
export function siblingIds(rows: readonly NestedRow[], row: NestedRow): Id[] {
  const parent = row.parentId ?? null;
  return rows.filter((r) => (r.parentId ?? null) === parent).map((r) => r.id);
}

/** A top-level row: in a nested view only these are dragged, and land before each other. */
export const isTopLevel = (row: NestedRow): boolean => (row.depth ?? 0) === 0;
