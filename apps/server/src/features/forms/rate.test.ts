// The response rate limiter: places per key in a rolling minute, given back when a response is
// refused, and forgotten after a minute.
import { describe, expect, it } from 'vitest';
import { ResponseLimiter } from './rate';

const T0 = Date.parse('2026-10-27T15:00:00Z');

describe('ResponseLimiter', () => {
  it('takes up to the limit for each key in a minute', () => {
    const limiter = new ResponseLimiter();
    for (let i = 0; i < 10; i += 1) expect(limiter.take('form:avery', 10, T0 + i)).toBe(true);
    expect(limiter.take('form:avery', 10, T0 + 10)).toBe(false);
    expect(limiter.take('form:jordan', 10, T0 + 10)).toBe(true);
    expect(limiter.take('other:avery', 10, T0 + 10)).toBe(true);
  });

  it('frees each place a minute after it was taken', () => {
    const limiter = new ResponseLimiter();
    expect(limiter.take('form', 2, T0)).toBe(true);
    expect(limiter.take('form', 2, T0 + 30_000)).toBe(true);
    expect(limiter.take('form', 2, T0 + 59_999)).toBe(false);
    expect(limiter.take('form', 2, T0 + 60_000)).toBe(true);
    expect(limiter.take('form', 2, T0 + 60_001)).toBe(false);
    expect(limiter.take('form', 2, T0 + 90_000)).toBe(true);
  });

  it('gives back a place for a response that was refused', () => {
    const limiter = new ResponseLimiter();
    expect(limiter.take('form', 1, T0)).toBe(true);
    expect(limiter.take('form', 1, T0 + 1)).toBe(false);
    limiter.giveBack('form', T0);
    expect(limiter.take('form', 1, T0 + 2)).toBe(true);
    // Giving back a place that was never taken changes nothing.
    limiter.giveBack('form', T0 + 5);
    limiter.giveBack('nobody', T0);
    expect(limiter.take('form', 1, T0 + 3)).toBe(false);
  });

  it('starts every key afresh once its minute has passed', () => {
    const limiter = new ResponseLimiter();
    for (let i = 0; i < 30; i += 1) expect(limiter.take(`key${i}`, 1, T0)).toBe(true);
    for (let i = 0; i < 30; i += 1) expect(limiter.take(`key${i}`, 1, T0 + 120_000)).toBe(true);
    expect(limiter.take('key0', 1, T0 + 120_001)).toBe(false);
  });
});
