/**
 * Manual order (spec 3.2): with no sort, rows keep the order people drag them into, per view.
 * The same helpers order a grouping's groups by hand (Grouping.order holds group keys).
 */
import type { Id } from './types';

/**
 * The order things show in by hand: the saved `order` (only ids that still exist, each once), then
 * the rest of `allIds` in their own order. Rows missing from a view's manual order come last,
 * oldest first, so pass `allIds` oldest first.
 */
export function effectiveOrder(order: readonly Id[], allIds: readonly Id[]): Id[] {
  const exists = new Set(allIds);
  const seen = new Set<Id>();
  const out: Id[] = [];
  for (const id of [...order, ...allIds]) {
    if (exists.has(id) && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * The new manual order after dropping `moving` just before `beforeId` (null: at the end).
 *
 * `order` is the saved order (it may miss new rows and still list deleted ones); `allIds` lists
 * everything that exists, oldest first (see effectiveOrder). The moved ids keep the order they
 * were in. Dropping onto one of the moved ids puts them before the next id that isn't moving.
 * Unknown ids are ignored; an unknown `beforeId` means the end. The result lists every id in
 * `allIds` exactly once, so it can be saved as is.
 */
export function moveInOrder(
  order: readonly Id[],
  allIds: readonly Id[],
  moving: readonly Id[],
  beforeId: Id | null,
): Id[] {
  const current = effectiveOrder(order, allIds);
  const move = new Set(moving);
  const moved = current.filter((id) => move.has(id));
  if (!moved.length) return current;
  const rest = current.filter((id) => !move.has(id));
  const from = beforeId === null ? -1 : current.indexOf(beforeId);
  const anchor = from < 0 ? undefined : current.slice(from).find((id) => !move.has(id));
  const at = anchor === undefined ? rest.length : rest.indexOf(anchor);
  return [...rest.slice(0, at), ...moved, ...rest.slice(at)];
}
