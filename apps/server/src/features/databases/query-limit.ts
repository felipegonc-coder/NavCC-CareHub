// How many of one person's view queries run at once on this server (security review of W2-3):
// each one reads every row of the database, and related rows, before the formula time starts. Past
// the limit the answer is 429 until one of theirs finishes; other people aren't held up.
import { httpError } from '../../core/errors';

/** One person's view queries (and charts) at once. */
export const QUERIES_AT_ONCE = 2;

export const BUSY_MESSAGE = 'Too many of your views are loading at once. Try again in a moment.';

/** Counts each person's running work, and refuses more than `limit` at once. */
export interface PerPersonLimit {
  run<T>(userId: string, work: () => Promise<T>): Promise<T>;
  /** How many of theirs are running. */
  running(userId: string): number;
}

export function perPersonLimit(limit: number): PerPersonLimit {
  const counts = new Map<string, number>();
  return {
    async run<T>(userId: string, work: () => Promise<T>): Promise<T> {
      const now = counts.get(userId) ?? 0;
      if (now >= limit) throw httpError(429, 'rate_limited', BUSY_MESSAGE);
      counts.set(userId, now + 1);
      try {
        return await work();
      } finally {
        const left = (counts.get(userId) ?? 1) - 1;
        if (left > 0) counts.set(userId, left);
        else counts.delete(userId);
      }
    },
    running: (userId) => counts.get(userId) ?? 0,
  };
}
