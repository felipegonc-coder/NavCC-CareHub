import { describe, expect, it } from 'vitest';
import {
  checkChangeMessage,
  collectPageCards,
  deletedMessageFields,
  editMessageBodySchema,
  prepareMessage,
  sendMessageBodySchema,
} from './compose';
import { pageLinkMatcher } from './tokens';

const matchPageLink = pageLinkMatcher({
  origins: ['https://carehub.example.com'],
  pathPrefix: '/p/',
});
const context = { memberIds: ['u-avery', 'u-sam'], matchPageLink };
const pageLink = (id: string) => `https://carehub.example.com/p/${id}`;

describe('MS-14 prepareMessage', () => {
  it('refuses empty and spaces-only messages', () => {
    expect(prepareMessage({ text: '' }, context)).toEqual({ ok: false, error: 'empty' });
    expect(prepareMessage({ text: ' \n\u200B ' }, context)).toEqual({ ok: false, error: 'empty' });
  });

  it('refuses text over 4,000 characters', () => {
    expect(prepareMessage({ text: 'a'.repeat(4001) }, context)).toEqual({
      ok: false,
      error: 'too-long',
    });
  });

  it('allows files only, or cards only, with no text', () => {
    expect(prepareMessage({ text: '  ', attachmentCount: 2 }, context)).toEqual({
      ok: true,
      message: { text: '', mentionedUserIds: [], pageIds: [] },
    });
    expect(prepareMessage({ text: '', pageIds: ['page-qa'] }, context)).toMatchObject({
      ok: true,
      message: { pageIds: ['page-qa'] },
    });
  });

  it('stores the trimmed text and the mentioned members once each', () => {
    const result = prepareMessage({ text: '  <@u-sam> <@u-riley> <@u-sam> hi\n' }, context);
    expect(result).toEqual({
      ok: true,
      message: {
        text: '<@u-sam> <@u-riley> <@u-sam> hi',
        mentionedUserIds: ['u-sam'],
        pageIds: [],
      },
    });
  });

  it('refuses more than 10 files', () => {
    expect(prepareMessage({ text: 'hi', attachmentCount: 11 }, context)).toEqual({
      ok: false,
      error: 'too-many-files',
    });
  });
});

describe('MS-03 / MS-04 page cards', () => {
  it('makes cards from pasted Care Hub page links, after the ones added with the button', () => {
    const text = `Read ${pageLink('p2')} and ${pageLink('p1')}, also https://example.com/p/p9`;
    expect(collectPageCards(text, ['p1'], matchPageLink)).toEqual(['p1', 'p2']);
    expect(collectPageCards(text, ['p1'])).toEqual(['p1']);
  });

  it('allows up to 10 cards per message', () => {
    const ten = Array.from({ length: 10 }, (_, i) => `p${i}`);
    expect(prepareMessage({ text: pageLink('p0'), pageIds: ten }, context).ok).toBe(true);
    expect(prepareMessage({ text: pageLink('p10'), pageIds: ten }, context)).toEqual({
      ok: false,
      error: 'too-many-page-cards',
    });
  });
});

describe('MS-05 only the sender changes a message', () => {
  const message = { kind: 'message' as const, senderId: 'u-avery', deletedAt: null };

  it('lets the sender edit or delete', () => {
    expect(checkChangeMessage(message, 'u-avery')).toEqual({ ok: true });
  });

  it('refuses everyone else, notices and system lines', () => {
    expect(checkChangeMessage(message, 'u-sam')).toEqual({ ok: false, error: 'not-yours' });
    expect(checkChangeMessage({ ...message, kind: 'notice', senderId: null }, 'u-avery')).toEqual({
      ok: false,
      error: 'not-a-message',
    });
    expect(checkChangeMessage({ ...message, kind: 'system' }, 'u-avery')).toEqual({
      ok: false,
      error: 'not-a-message',
    });
  });

  it('refuses to change a deleted message', () => {
    const deleted = { ...message, deletedAt: new Date('2026-10-26T17:00:00Z') };
    expect(checkChangeMessage(deleted, 'u-avery')).toEqual({ ok: false, error: 'deleted' });
  });

  it('erases the text, mentions and cards on delete', () => {
    const now = new Date('2026-10-26T17:00:00Z');
    expect(deletedMessageFields(now)).toEqual({
      text: '',
      mentionedUserIds: [],
      pageIds: [],
      deletedAt: now,
    });
  });
});

describe('request bodies', () => {
  const clientId = '6f1c2a9e-3b7d-4c8e-9f0a-1b2c3d4e5f60';

  it('needs a browser-made UUID and fills in defaults', () => {
    expect(sendMessageBodySchema.parse({ clientId, text: 'Hi' })).toEqual({
      clientId,
      text: 'Hi',
      pageIds: [],
      attachmentIds: [],
    });
    expect(sendMessageBodySchema.safeParse({ clientId: 'abc', text: 'Hi' }).success).toBe(false);
  });

  it('bounds lists and IDs', () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `f${i}`);
    expect(sendMessageBodySchema.safeParse({ clientId, attachmentIds: eleven }).success).toBe(
      false,
    );
    expect(sendMessageBodySchema.safeParse({ clientId, pageIds: ['no spaces'] }).success).toBe(
      false,
    );
    expect(editMessageBodySchema.parse({ text: 'Fixed' })).toEqual({
      text: 'Fixed',
      pageIds: [],
      keepAttachmentIds: [],
    });
  });
});
