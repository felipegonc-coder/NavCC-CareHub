import { describe, expect, it } from 'vitest';
import { historyQuerySchema, newChatBodySchema } from './api';

const avery = '0b8f3c52-6d1e-4a7b-9c2d-1e5f7a9b3c41';

describe('newChatBodySchema', () => {
  it('takes 1 to 50 people, a name and startNew (false by default)', () => {
    expect(newChatBodySchema.parse({ userIds: [avery] })).toEqual({
      userIds: [avery],
      startNew: false,
    });
    expect(newChatBodySchema.parse({ userIds: [avery], name: 'QA', startNew: true })).toEqual({
      userIds: [avery],
      name: 'QA',
      startNew: true,
    });
    expect(newChatBodySchema.safeParse({ userIds: [] }).success).toBe(false);
    const fiftyOne = Array.from({ length: 51 }, (_, index) => `person-${index}`);
    expect(newChatBodySchema.safeParse({ userIds: fiftyOne }).success).toBe(false);
    expect(newChatBodySchema.safeParse({ userIds: ['not an id'] }).success).toBe(false);
  });
});

describe('historyQuerySchema', () => {
  it('reads query strings, with 50 by default and at most', () => {
    expect(historyQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(historyQuerySchema.parse({ before: '120', limit: '20' })).toEqual({
      before: 120,
      limit: 20,
    });
    expect(historyQuerySchema.parse({ after: '0' })).toEqual({ after: 0, limit: 50 });
  });

  it('refuses both directions at once, and numbers outside seq', () => {
    expect(historyQuerySchema.safeParse({ before: '9', after: '3' }).success).toBe(false);
    const accepted = [
      { before: '0' },
      { before: 'abc' },
      { after: '1.5' },
      { limit: '51' },
      { before: '2147483648' },
    ].filter((query) => historyQuerySchema.safeParse(query).success);
    expect(accepted).toEqual([]);
  });
});
