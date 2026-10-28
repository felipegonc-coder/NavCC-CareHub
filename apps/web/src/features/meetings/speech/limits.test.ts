import { describe, expect, it } from 'vitest';
import { LIMIT_MS, WARNING_MS, WorkRate } from './limits';

describe('limits', () => {
  it('stops at 3:00:00 and warns at 2:55:00', () => {
    expect(LIMIT_MS).toBe(10_800_000);
    expect(WARNING_MS).toBe(10_500_000);
  });

  it('learns the work per second of sound', () => {
    const rate = new WorkRate();
    expect(rate.remaining(60_000)).toBeNull();
    rate.add(10_000, 30_000);
    expect(rate.remaining(60_000)).toBe(20_000);
    rate.add(20_000, 30_000);
    expect(rate.remaining(30_000)).toBe(13_000);
  });
});
