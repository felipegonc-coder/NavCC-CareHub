import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VERSION_RETENTION_DAYS,
  VERSION_RETENTION_CHOICES,
  versionRetentionSchema,
} from './index';

describe('how long versions are kept', () => {
  it('keeps them 30, 90 or 365 days, or forever', () => {
    for (const days of VERSION_RETENTION_CHOICES) {
      expect(versionRetentionSchema.parse(days)).toBe(days);
    }
    for (const other of [7, 0, -30, '30', undefined]) {
      expect(versionRetentionSchema.safeParse(other).success).toBe(false);
    }
  });

  it('keeps them a year by default', () => {
    expect(DEFAULT_VERSION_RETENTION_DAYS).toBe(365);
  });
});
