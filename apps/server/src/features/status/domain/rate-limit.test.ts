import { describe, expect, it } from 'vitest';
import { BACKUP_REQUEST_RULES, checkRate } from './rate-limit';

const now = new Date('2026-10-27T15:00:00Z');
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

describe('checkRate', () => {
  it('lets requests through while every window has room', () => {
    expect(checkRate([], now, BACKUP_REQUEST_RULES)).toEqual({ ok: true });
    expect(checkRate([minutesAgo(50), minutesAgo(10)], now, BACKUP_REQUEST_RULES)).toEqual({
      ok: true,
    });
  });

  it('allows 3 an hour, and says when the next one fits', () => {
    const accepted = [minutesAgo(50), minutesAgo(20), minutesAgo(5)];
    // The request from 50 minutes ago leaves the hour in 10 minutes.
    expect(checkRate(accepted, now, BACKUP_REQUEST_RULES)).toEqual({
      ok: false,
      retryAfterMs: 10 * 60_000,
    });
    expect(
      checkRate(accepted, new Date(now.getTime() + 10 * 60_000), BACKUP_REQUEST_RULES),
    ).toEqual({ ok: true });
  });

  it('allows 10 a day', () => {
    // One every two hours: never 3 in an hour, but 10 within the day.
    const accepted: Date[] = [];
    for (let i = 0; i < 10; i += 1) accepted.push(minutesAgo(23 * 60 - i * 120));
    const decision = checkRate(accepted, now, BACKUP_REQUEST_RULES);
    // The oldest, 23 hours ago, leaves the day in one hour.
    expect(decision).toEqual({ ok: false, retryAfterMs: 60 * 60_000 });
  });

  it('ignores requests that have left the window', () => {
    const accepted = [minutesAgo(25 * 60), minutesAgo(61), minutesAgo(62), minutesAgo(63)];
    expect(checkRate(accepted, now, BACKUP_REQUEST_RULES)).toEqual({ ok: true });
  });
});
