import { describe, expect, it } from 'vitest';
import {
  blockUrl,
  canOpenQuerySchema,
  commentUrl,
  createMentionSchema,
  MENTION_MAX_PEOPLE,
  MENTION_SNIPPET_MAX_CHARS,
} from './index';

const pageId = '7d3c1a52-5b8e-4c1f-9a7e-2f4b6c8d0e13';
const samId = '0f6e2b9a-3c41-4d7e-8a95-6b1c2d3e4f50';
const rileyId = '5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

describe('a mention in page text', () => {
  it('notifies by default, with the sentence on one line', () => {
    const input = createMentionSchema.parse({
      pageId,
      blockId: 'blk_7Qx-2',
      userId: samId,
      snippet: '  Ask @Sam Ortiz\nabout the refund steps.  ',
    });
    expect(input).toEqual({
      pageId,
      blockId: 'blk_7Qx-2',
      userId: samId,
      snippet: 'Ask @Sam Ortiz about the refund steps.',
      notify: true,
    });
  });

  it('cuts the sentence to 300 characters, counting code points', () => {
    const input = createMentionSchema.parse({
      pageId,
      blockId: 'b1',
      userId: samId,
      snippet: '😀'.repeat(MENTION_SNIPPET_MAX_CHARS + 20),
      notify: false,
    });
    expect(Array.from(input.snippet)).toHaveLength(MENTION_SNIPPET_MAX_CHARS);
    expect(input.notify).toBe(false);
    expect(createMentionSchema.parse({ pageId, blockId: 'b1', userId: samId }).snippet).toBe('');
  });

  it('needs a page, a block and a person', () => {
    const result = createMentionSchema.safeParse({ pageId: 'nope', blockId: 'a b', userId: 'x' });
    const messages = result.error?.issues.map((issue) => issue.message);
    expect(messages).toEqual([
      "That page ID isn't right.",
      "That block ID isn't right.",
      "That person ID isn't right.",
    ]);
  });
});

describe('the can-open check', () => {
  it('takes up to 50 people, each once', () => {
    expect(canOpenQuerySchema.parse({ pageId, userIds: `${samId}, ${rileyId},${samId},` })).toEqual(
      { pageId, userIds: [samId, rileyId] },
    );
    const many = Array.from(
      { length: MENTION_MAX_PEOPLE + 1 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    );
    expect(
      canOpenQuerySchema.safeParse({ pageId, userIds: many.join(',') }).error?.issues[0]?.message,
    ).toBe('At most 50 people at a time.');
    expect(canOpenQuerySchema.safeParse({ pageId, userIds: ' , ' }).error?.issues[0]?.message).toBe(
      'Say who to check.',
    );
  });
});

describe('links to the spot', () => {
  it('opens the block or the comment', () => {
    expect(blockUrl(pageId, 'blk_7Qx-2')).toBe(`/p/${pageId}#blk_7Qx-2`);
    expect(commentUrl(pageId, samId)).toBe(`/p/${pageId}?comment=${samId}`);
  });
});
