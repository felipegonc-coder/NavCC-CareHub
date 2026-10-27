import { describe, expect, it } from 'vitest';
import { LEARNING_DAY_ZONE, learningToday } from './day';

describe('learningToday', () => {
  it('is the day in America/Denver, in summer time and in winter time', () => {
    expect(LEARNING_DAY_ZONE).toBe('America/Denver');
    expect(learningToday(new Date('2026-10-28T05:59:00Z'))).toBe('2026-10-27');
    expect(learningToday(new Date('2026-10-28T06:00:00Z'))).toBe('2026-10-28');
    expect(learningToday(new Date('2026-12-01T06:59:00Z'))).toBe('2026-11-30');
    expect(learningToday(new Date('2026-12-01T07:00:00Z'))).toBe('2026-12-01');
  });
});
