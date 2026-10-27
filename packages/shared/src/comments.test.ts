import { describe, expect, it } from 'vitest';
import {
  COMMENT_MAX_CHARS,
  commentTextSchema,
  createCommentSchema,
  listCommentsQuerySchema,
  mentionedUserIds,
  spotOf,
} from './index';

const pageId = '7d3c1a52-5b8e-4c1f-9a7e-2f4b6c8d0e13';
const samId = '0f6e2b9a-3c41-4d7e-8a95-6b1c2d3e4f50';

describe('comment text', () => {
  it('is trimmed, with line breaks as \\n', () => {
    expect(commentTextSchema.parse('  Call the family first.\r\nThen the clinic.\r ')).toBe(
      'Call the family first.\nThen the clinic.',
    );
  });

  it('needs some text', () => {
    expect(commentTextSchema.safeParse(' \n ').error?.issues[0]?.message).toBe(
      'Write a comment first.',
    );
    expect(commentTextSchema.safeParse(undefined).success).toBe(false);
  });

  it('counts characters as code points, up to 4,000', () => {
    expect(commentTextSchema.parse('😀'.repeat(COMMENT_MAX_CHARS))).toHaveLength(8000);
    const long = commentTextSchema.safeParse('a'.repeat(COMMENT_MAX_CHARS + 1));
    expect(long.error?.issues[0]?.message).toBe('A comment can be up to 4,000 characters.');
  });
});

describe('createCommentSchema', () => {
  it('takes a page comment, a reply and a text comment', () => {
    expect(createCommentSchema.parse({ pageId, text: 'Looks good' })).toEqual({
      pageId,
      text: 'Looks good',
    });
    const threadId = '5a0d9c1e-8f2b-4e6a-b7c3-1d2e3f4a5b6c';
    expect(createCommentSchema.parse({ pageId, threadId, text: 'Agreed' }).threadId).toBe(threadId);
    const quote = ` ${'Refund within 3 days. '.repeat(100)}`;
    const parsed = createCommentSchema.parse({
      pageId,
      text: 'Which days?',
      blockId: 'b-1',
      quote,
    });
    expect(parsed.quote).toHaveLength(1000);
    expect(parsed.quote?.startsWith('Refund')).toBe(true);
  });

  it('refuses bad IDs and mixed spots', () => {
    expect(createCommentSchema.safeParse({ pageId: 'p1', text: 'Hi' }).success).toBe(false);
    expect(createCommentSchema.safeParse({ pageId, text: 'Hi', blockId: 'a b' }).success).toBe(
      false,
    );
    const both = createCommentSchema.safeParse({
      pageId,
      text: 'Hi',
      blockId: 'b',
      propertyId: 'p',
    });
    expect(both.error?.issues[0]?.message).toBe(
      'A comment goes on a block or on a property, not both.',
    );
    const quoteOnly = createCommentSchema.safeParse({ pageId, text: 'Hi', quote: 'Refund' });
    expect(quoteOnly.error?.issues[0]?.path).toEqual(['blockId']);
  });
});

describe('spotOf', () => {
  it('works out where a new thread goes', () => {
    expect(spotOf({})).toBe('page');
    expect(spotOf({ blockId: 'b' })).toBe('block');
    expect(spotOf({ blockId: 'b', quote: '' })).toBe('block');
    expect(spotOf({ blockId: 'b', quote: 'Refund' })).toBe('text');
    expect(spotOf({ propertyId: 'status' })).toBe('property');
  });
});

describe('mentionedUserIds', () => {
  it('finds each mentioned person once, in order', () => {
    const avery = '1b2c3d4e-5f60-4718-9a2b-3c4d5e6f7a8b';
    expect(mentionedUserIds(`<@${samId}> and <@${avery}>, then <@${samId}> again`)).toEqual([
      samId,
      avery,
    ]);
    expect(mentionedUserIds('Email sam@example.test or <@ bad>')).toEqual([]);
  });
});

describe('listCommentsQuerySchema', () => {
  it('lists every thread unless told otherwise', () => {
    expect(listCommentsQuerySchema.parse({ pageId })).toEqual({ pageId, status: 'all' });
    expect(listCommentsQuerySchema.safeParse({ pageId, status: 'mine' }).success).toBe(false);
  });
});
