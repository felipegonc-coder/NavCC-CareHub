import type { Id } from '../format/index';

// Immutable list helpers. Each returns the same array when nothing changes, so callers can detect no-ops.

/** Clamps an insert position to 0..length (non-numbers mean "at the end"). */
export function clampIndex(index: number, length: number): number {
  return Number.isFinite(index) ? Math.min(Math.max(Math.trunc(index), 0), length) : length;
}

/** A copy of `list` with `item` inserted at `index` (clamped). */
export function insertItem<T>(list: T[], index: number, item: T): T[] {
  const at = clampIndex(index, list.length);
  return [...list.slice(0, at), item, ...list.slice(at)];
}

/** Moves the item at `from` so it ends up at `to` (clamped to the list). */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (!Number.isInteger(from) || from < 0 || from >= list.length) return list;
  const target = clampIndex(to, list.length - 1);
  if (target === from) return list;
  const next = list.slice();
  const [item] = next.splice(from, 1) as [T];
  next.splice(target, 0, item);
  return next;
}

/** Moves the item with `id` so it ends up at `to`. */
export function moveItemById<T extends { id: Id }>(list: T[], id: Id, to: number): T[] {
  return moveItem(
    list,
    list.findIndex((item) => item.id === id),
    to,
  );
}

/** Replaces the item with `id` by `update(item)`. */
export function updateItemById<T extends { id: Id }>(
  list: T[],
  id: Id,
  update: (item: T) => T,
): T[] {
  let changed = false;
  const next = list.map((item) => {
    if (item.id !== id) return item;
    const updated = update(item);
    changed ||= updated !== item;
    return updated;
  });
  return changed ? next : list;
}

/** Removes the item with `id`. */
export function removeItemById<T extends { id: Id }>(list: T[], id: Id): T[] {
  const next = list.filter((item) => item.id !== id);
  return next.length === list.length ? list : next;
}
