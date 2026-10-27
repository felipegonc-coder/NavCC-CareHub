// Each person's own order of their spaces in the sidebar (Sidebar spec, section 3.3), saved as a
// list of space IDs. Spaces missing from it, such as one just joined, follow in the server's order.

/** Where a dragged space goes: just above or just below another. */
export type SpacePlace = 'before' | 'after';

/** The spaces in the person's order. */
export function orderSpaces<T extends { id: string }>(
  spaces: readonly T[],
  order: readonly string[],
): T[] {
  const rank = new Map(order.map((id, index) => [id, index]));
  const placed = spaces
    .filter((space) => rank.has(space.id))
    .sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
  return [...placed, ...spaces.filter((space) => !rank.has(space.id))];
}

/** The order with `id` moved above or below `target`; null when that changes nothing. */
export function placeSpace(
  ids: readonly string[],
  id: string,
  target: string,
  place: SpacePlace,
): string[] | null {
  if (id === target || !ids.includes(id) || !ids.includes(target)) return null;
  const rest = ids.filter((other) => other !== id);
  const at = rest.indexOf(target) + (place === 'after' ? 1 : 0);
  const next = [...rest.slice(0, at), id, ...rest.slice(at)];
  return next.some((other, index) => other !== ids[index]) ? next : null;
}

/** The order with `id` one place up (-1) or down (1); null at either end. */
export function stepSpace(ids: readonly string[], id: string, by: 1 | -1): string[] | null {
  const target = ids[ids.indexOf(id) + by];
  if (!ids.includes(id) || target === undefined) return null;
  return placeSpace(ids, id, target, by < 0 ? 'before' : 'after');
}
