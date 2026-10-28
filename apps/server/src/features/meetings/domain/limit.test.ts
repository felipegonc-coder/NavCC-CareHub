import { describe, expect, it } from 'vitest';
import { perMinuteLimit } from './limit';

describe('perMinuteLimit', () => {
  it('allows the limit in a minute for each person, then again in the next minute', () => {
    let now = 0;
    const limit = perMinuteLimit(3, () => now);
    expect([1, 2, 3, 4].map(() => limit.allow('avery'))).toEqual([true, true, true, false]);
    expect(limit.allow('sam')).toBe(true);
    now = 59_999;
    expect(limit.allow('avery')).toBe(false);
    now = 60_000;
    expect(limit.allow('avery')).toBe(true);
  });
});
