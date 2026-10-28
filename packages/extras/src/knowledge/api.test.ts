import { describe, expect, it } from 'vitest';
import {
  ownersInputSchema,
  reviewInputSchema,
  settingsInputSchema,
  statusInputSchema,
  verifyInputSchema,
} from './api';

const ids = [
  '6f1c2b9e-4d3a-4e5f-9a8b-1c2d3e4f5a6b',
  '0b7d4c3a-2e1f-4a5b-8c6d-7e8f9a0b1c2d',
  'a3e5c7d9-1b2f-4c6e-8a0d-2f4b6d8e0a1c',
  'b1c3e5a7-9d2f-4b6a-8c0e-1d3f5a7c9e2b',
  'c2d4f6a8-0e3b-4d7f-9b1a-3c5e7a9c1e4d',
  'd3e5a7b9-1f4c-4e8a-8c2b-4d6f8b0d2f5e',
];

describe('request bodies', () => {
  it('takes a period, or a date for Verify until a date', () => {
    expect(verifyInputSchema.safeParse({ period: '90d' }).success).toBe(true);
    expect(verifyInputSchema.safeParse({ period: 'none' }).success).toBe(true);
    expect(verifyInputSchema.safeParse({ period: 'date', until: '2027-01-20' }).success).toBe(true);
    expect(verifyInputSchema.safeParse({ period: 'date' }).success).toBe(false);
    expect(verifyInputSchema.safeParse({ period: '90d', until: '2027-01-20' }).success).toBe(false);
    expect(verifyInputSchema.safeParse({ period: 'date', until: '2027-02-30' }).success).toBe(
      false,
    );
    expect(verifyInputSchema.safeParse({ period: 'forever' }).success).toBe(false);
  });

  it('takes up to 5 different owners', () => {
    expect(ownersInputSchema.safeParse({ owners: ids.slice(0, 5) }).success).toBe(true);
    expect(ownersInputSchema.safeParse({ owners: [] }).success).toBe(true);
    expect(ownersInputSchema.safeParse({ owners: ids }).success).toBe(false);
    expect(ownersInputSchema.safeParse({ owners: [ids[0], ids[0]] }).success).toBe(false);
    expect(ownersInputSchema.safeParse({ owners: ['riley'] }).success).toBe(false);
  });

  it('checks status, review and settings bodies', () => {
    expect(statusInputSchema.safeParse({ status: 'published' }).success).toBe(true);
    expect(statusInputSchema.safeParse({ status: 'archived' }).success).toBe(false);
    expect(reviewInputSchema.safeParse({ action: 'needs_changes' }).success).toBe(true);
    expect(reviewInputSchema.safeParse({ action: 'delete' }).success).toBe(false);
    expect(settingsInputSchema.safeParse({ defaultPeriod: '6m' }).success).toBe(true);
    expect(settingsInputSchema.safeParse({ editingRemovesVerification: true }).success).toBe(true);
    expect(settingsInputSchema.safeParse({}).success).toBe(false);
    expect(settingsInputSchema.safeParse({ defaultPeriod: 'date' }).success).toBe(false);
  });
});
