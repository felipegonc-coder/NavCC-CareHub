/**
 * Editing a view's sorts (Databases spec 3.4): up to 10, in order, each on a different property.
 * Which properties can sort comes from the package (canSortBy).
 */
import { LIMITS, type Id, type Property, type Sort } from '@carehub/databases';
import { canSortBy } from '@carehub/databases/sort';

/** Properties a view can sort by, in database order (only the ones the viewer sees). */
export function sortableProperties(
  properties: readonly Property[],
  visible?: readonly Id[],
): Property[] {
  const seen = visible ? new Set(visible) : null;
  return properties.filter((p) => (!seen || seen.has(p.id)) && canSortBy(p));
}

/** Whether another sort fits: under 10, and a property left to sort by. */
export function canAddSort(sorts: readonly Sort[], candidates: readonly Property[]): boolean {
  return (
    sorts.length < LIMITS.sorts && candidates.some((p) => !sorts.some((s) => s.propertyId === p.id))
  );
}

/** Adds an ascending sort on the first property not sorted by yet (no change if none fits). */
export function addSort(sorts: readonly Sort[], candidates: readonly Property[]): Sort[] {
  if (!canAddSort(sorts, candidates)) return [...sorts];
  const prop = candidates.find((p) => !sorts.some((s) => s.propertyId === p.id));
  return prop ? [...sorts, { propertyId: prop.id, direction: 'asc' }] : [...sorts];
}

export function removeSort(sorts: readonly Sort[], index: number): Sort[] {
  return sorts.filter((_, i) => i !== index);
}

/** Moves the sort at `from` to `to` (both in the current order). */
export function moveSort(sorts: readonly Sort[], from: number, to: number): Sort[] {
  const next = [...sorts];
  const [moved] = next.splice(from, 1);
  if (!moved) return [...sorts];
  next.splice(Math.max(0, Math.min(to, next.length)), 0, moved);
  return next;
}

export function changeSort(sorts: readonly Sort[], index: number, change: Partial<Sort>): Sort[] {
  return sorts.map((s, i) => (i === index ? { ...s, ...change } : s));
}

/**
 * Where a dragged sort lands: how many of the other rows have their middle above the pointer.
 * `middles` are the rows' vertical middles in the current order.
 */
export function dropIndex(middles: readonly number[], y: number, from: number): number {
  return middles.filter((middle, i) => i !== from && middle < y).length;
}
