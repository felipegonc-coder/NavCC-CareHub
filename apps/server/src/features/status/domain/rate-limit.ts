// Sliding-window rate limits over the times of requests already accepted.

export interface RateRule {
  max: number;
  windowMs: number;
}

export type RateDecision = { ok: true } | { ok: false; retryAfterMs: number };

/**
 * Back up now and Test a restore now, counted together for the whole server: 3 an hour, 10 a day.
 */
export const BACKUP_REQUEST_RULES: readonly RateRule[] = [
  { max: 3, windowMs: 60 * 60_000 },
  { max: 10, windowMs: 24 * 60 * 60_000 },
];

/**
 * Whether one more request fits every rule at `now`, given when the earlier ones were accepted, and
 * if not, how long until one does.
 */
export function checkRate(
  accepted: readonly Date[],
  now: Date,
  rules: readonly RateRule[],
): RateDecision {
  const nowMs = now.getTime();
  const times = accepted.map((at) => at.getTime()).filter((at) => at <= nowMs);
  let wait = 0;
  for (const rule of rules) {
    const recent = times.filter((at) => at > nowMs - rule.windowMs).toSorted((a, b) => a - b);
    // The request that has to leave the window before another one fits.
    const blocking = recent[recent.length - rule.max];
    if (blocking !== undefined) wait = Math.max(wait, blocking + rule.windowMs - nowMs);
  }
  return wait > 0 ? { ok: false, retryAfterMs: wait } : { ok: true };
}
