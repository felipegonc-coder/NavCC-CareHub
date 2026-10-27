/** A source of random numbers in [0, 1), like `Math.random`. Use `mulberry32(seed)` for repeatable results. */
export type Random = () => number;

/**
 * Seeded pseudo-random generator (Mulberry32). The same seed always gives the same sequence, so quiz
 * attempts can be replayed on the server. The seed is reduced to 32 bits; not for security uses.
 */
export function mulberry32(seed: number): Random {
  let state = Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A whole number from 0 up to (not including) `max`, drawn from `random`. Returns 0 when `max` < 1. */
export function randomInt(random: Random, max: number): number {
  const limit = Math.floor(max);
  if (!(limit >= 1)) return 0;
  const n = Math.floor(random() * limit);
  return Math.min(Math.max(n, 0), limit - 1);
}

/** A shuffled copy of `items` (Fisher–Yates). The input array is not changed. */
export function shuffle<T>(items: readonly T[], random: Random): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(random, i + 1);
    const picked = out[j] as T;
    out[j] = out[i] as T;
    out[i] = picked;
  }
  return out;
}

/**
 * `count` items drawn without replacement (clamped to 0..items.length), in draw order, or in their
 * original order with `keepOrder`. The input array is not changed.
 */
export function sample<T>(
  items: readonly T[],
  count: number,
  random: Random,
  options: { keepOrder?: boolean } = {},
): T[] {
  const n = Math.min(Math.max(Math.floor(count) || 0, 0), items.length);
  const indexes = items.map((_, i) => i);
  for (let i = 0; i < n; i++) {
    const j = i + randomInt(random, indexes.length - i);
    const picked = indexes[j] as number;
    indexes[j] = indexes[i] as number;
    indexes[i] = picked;
  }
  const chosen = indexes.slice(0, n);
  if (options.keepOrder) chosen.sort((a, b) => a - b);
  return chosen.map((i) => items[i] as T);
}
