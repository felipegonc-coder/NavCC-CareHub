import { describe, expect, it } from 'vitest';
import { askRequestSchema, chatTitleFrom, CHAT_TITLE_MAX, renameChatSchema } from './assistant';

const pageId = '6f1c1a52-8f0e-4d1a-9b8e-2f4d8f0b6a11';

describe('assistant requests', () => {
  it('takes a question with its chip and up to 5 @ pages', () => {
    expect(askRequestSchema.parse({ question: ' How long? ', scope: 'no_pages' })).toEqual({
      question: 'How long?',
      scope: 'no_pages',
      pageIds: [],
    });
    const six = Array.from({ length: 6 }, () => pageId);
    expect(
      askRequestSchema.safeParse({ question: 'Q', scope: 'all_pages', pageIds: six }).success,
    ).toBe(false);
    expect(askRequestSchema.safeParse({ question: '  ', scope: 'no_pages' }).success).toBe(false);
    expect(
      askRequestSchema.safeParse({ question: 'x'.repeat(4_001), scope: 'no_pages' }).success,
    ).toBe(false);
    expect(askRequestSchema.safeParse({ question: 'Q', scope: 'everything' }).success).toBe(false);
    expect(
      askRequestSchema.safeParse({ question: 'Q', scope: 'no_pages', text: 'extra' }).success,
    ).toBe(false);
  });

  it('needs the open page for This page', () => {
    const missing = askRequestSchema.safeParse({ question: 'Q', scope: 'this_page' });
    expect(missing.success).toBe(false);
    expect(missing.error?.issues[0]?.message).toBe('Open a page to ask about it.');
    expect(askRequestSchema.parse({ question: 'Q', scope: 'this_page', pageId }).pageId).toBe(
      pageId,
    );
  });

  it('renames with 1 to 80 characters', () => {
    expect(renameChatSchema.parse({ title: '  Refunds ' })).toEqual({ title: 'Refunds' });
    expect(renameChatSchema.safeParse({ title: '' }).success).toBe(false);
    expect(renameChatSchema.safeParse({ title: 'x'.repeat(81) }).success).toBe(false);
  });
});

describe('chatTitleFrom', () => {
  it("is the question's first line", () => {
    expect(chatTitleFrom('\n  How long do   refunds take?\nAsking for Sam.')).toBe(
      'How long do refunds take?',
    );
    expect(chatTitleFrom('   ')).toBe('New chat');
  });

  it('cuts a long question at a word', () => {
    const title = chatTitleFrom(`${'refund '.repeat(20)}policy`);
    expect(title.length).toBeLessThanOrEqual(CHAT_TITLE_MAX);
    expect(title.endsWith('refund…')).toBe(true);
    expect(chatTitleFrom('x'.repeat(100))).toBe(`${'x'.repeat(79)}…`);
  });
});
