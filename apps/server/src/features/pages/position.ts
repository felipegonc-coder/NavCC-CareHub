// Fractional position keys: siblings sort by plain string order, and there is always room
// between two keys, so a move rewrites only the moved row.
//
// A key is a string of base-62 digits read as a fraction between 0 and 1 ("V" = 31/62).
// Keys never end in "0", so each fraction has one spelling and string order equals numeric order
// (Postgres needs COLLATE "C" for that, which the migrations set).

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE = DIGITS.length;
const KEY = /^[0-9A-Za-z]*[1-9A-Za-z]$/;

export const isPositionKey = (value: unknown): value is string =>
  typeof value === 'string' && KEY.test(value);

const digitAt = (key: string, index: number) =>
  index < key.length ? DIGITS.indexOf(key.charAt(index)) : 0;

/** `lo` < result < `hi`, where '' means 0 and null means 1. `bias` keeps repeated appends short. */
function between(lo: string, hi: string | null, bias: 'low' | 'middle' | 'high'): string {
  if (hi !== null) {
    let shared = 0;
    while (digitAt(lo, shared) === digitAt(hi, shared)) shared += 1;
    if (shared > 0) return hi.slice(0, shared) + between(lo.slice(shared), hi.slice(shared), bias);
  }
  const low = digitAt(lo, 0);
  const high = hi === null ? BASE : digitAt(hi, 0);
  if (high - low > 1) {
    const digit = bias === 'low' ? low + 1 : bias === 'high' ? high - 1 : (low + high) >> 1;
    return DIGITS.charAt(digit);
  }
  if (hi !== null && hi.length > 1) return hi.charAt(0);
  return DIGITS.charAt(low) + between(lo.slice(1), null, bias);
}

/** A key that sorts after `before` and before `after` (null = no neighbour on that side). */
export function positionBetween(before: string | null, after: string | null): string {
  for (const key of [before, after]) {
    if (key !== null && !isPositionKey(key)) throw new RangeError(`Bad position key "${key}"`);
  }
  if (before !== null && after !== null && before >= after) {
    throw new RangeError(`"${before}" must sort before "${after}"`);
  }
  if (before === null) return after === null ? DIGITS.charAt(BASE / 2) : between('', after, 'high');
  return after === null ? between(before, null, 'low') : between(before, after, 'middle');
}

/**
 * The key for putting an item at `index` in a sorted list of its siblings' keys (the item itself
 * left out). No index means last. Ties (rare) are skipped so the new key is always unique.
 */
export function positionAt(sortedKeys: readonly string[], index?: number): string {
  const at = Math.min(index ?? sortedKeys.length, sortedKeys.length);
  const before = sortedKeys[at - 1] ?? null;
  const after = sortedKeys.slice(at).find((key) => before === null || key > before) ?? null;
  return positionBetween(before, after);
}
