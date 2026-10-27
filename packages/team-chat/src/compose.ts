import { z } from 'zod';
import { ATTACHMENTS_MAX, MESSAGE_RAW_MAX, PAGE_CARDS_MAX } from './constants';
import { checkMessageText } from './text';
import { findLinks, findMentions, ID_PATTERN } from './tokens';
import type { PageLinkMatcher } from './tokens';
import type { MessageKind } from './types';

/** An ID in a request body. */
export const idSchema = z.string().regex(ID_PATTERN);

/** Body of a send request. `clientId` is made in the browser, so a resend never makes a duplicate. */
export const sendMessageBodySchema = z.object({
  clientId: z.uuid(),
  text: z.string().max(MESSAGE_RAW_MAX).default(''),
  pageIds: z.array(idSchema).max(PAGE_CARDS_MAX).default([]),
  attachmentIds: z.array(idSchema).max(ATTACHMENTS_MAX).default([]),
});
export type SendMessageBody = z.infer<typeof sendMessageBodySchema>;

/** Body of an edit request: new text and cards; files can only be kept or dropped. */
export const editMessageBodySchema = z.object({
  text: z.string().max(MESSAGE_RAW_MAX).default(''),
  pageIds: z.array(idSchema).max(PAGE_CARDS_MAX).default([]),
  keepAttachmentIds: z.array(idSchema).max(ATTACHMENTS_MAX).default([]),
});
export type EditMessageBody = z.infer<typeof editMessageBodySchema>;

export type DraftError = 'empty' | 'too-long' | 'too-many-page-cards' | 'too-many-files';

export interface DraftInput {
  text: string;
  /** Cards added with Share page or "@", in order; Care Hub page links in the text come after. */
  pageIds?: readonly string[];
  /** Files in the message: the new uploads, or the ones an edit keeps. */
  attachmentCount?: number;
}

export interface DraftContext {
  /** Current members of the chat; only they can be @mentioned. */
  memberIds: Iterable<string>;
  matchPageLink?: PageLinkMatcher;
}

export interface PreparedMessage {
  /** Text to store: normalized, and "" when the message is only files or cards. */
  text: string;
  /** People in the chat mentioned as `<@userId>`, each once. */
  mentionedUserIds: string[];
  /** Page cards in order, each once. */
  pageIds: string[];
}

export type DraftResult = { ok: true; message: PreparedMessage } | { ok: false; error: DraftError };

/** Cards added explicitly, then Care Hub page links found in the text; each page once. */
export function collectPageCards(
  text: string,
  explicitPageIds: readonly string[],
  matchPageLink?: PageLinkMatcher,
): string[] {
  const ids = new Set(explicitPageIds);
  for (const link of matchPageLink ? findLinks(text) : []) {
    const pageId = matchPageLink?.(link.url);
    if (pageId) ids.add(pageId);
  }
  return [...ids];
}

/**
 * Checks a new or edited message the same way on web and server (MS-14): at most 4,000
 * characters, and never empty (files only, or cards only, are fine).
 */
export function prepareMessage(input: DraftInput, context: DraftContext): DraftResult {
  const checked = checkMessageText(input.text);
  if (!checked.ok) return checked;
  const attachments = input.attachmentCount ?? 0;
  if (attachments > ATTACHMENTS_MAX) return { ok: false, error: 'too-many-files' };
  const pageIds = collectPageCards(checked.text, input.pageIds ?? [], context.matchPageLink);
  if (pageIds.length > PAGE_CARDS_MAX) return { ok: false, error: 'too-many-page-cards' };
  if (checked.text === '' && attachments === 0 && pageIds.length === 0) {
    return { ok: false, error: 'empty' };
  }
  const members = new Set(context.memberIds);
  const mentionedUserIds = findMentions(checked.text).filter((id) => members.has(id));
  return { ok: true, message: { text: checked.text, mentionedUserIds, pageIds } };
}

export interface ChangeableMessage {
  kind: MessageKind;
  senderId: string | null;
  deletedAt: Date | null;
}

/** `not-yours` and `not-a-message` are 403s; `deleted` means there's nothing left to change. */
export type ChangeError = 'not-yours' | 'not-a-message' | 'deleted';

/** Only the sender can edit or delete their message (MS-05). */
export function checkChangeMessage(
  message: ChangeableMessage,
  actorId: string,
): { ok: true } | { ok: false; error: ChangeError } {
  if (message.kind !== 'message') return { ok: false, error: 'not-a-message' };
  if (message.senderId !== actorId) return { ok: false, error: 'not-yours' };
  if (message.deletedAt) return { ok: false, error: 'deleted' };
  return { ok: true };
}

/** What a delete leaves on the server: no text, mentions or cards. Its files go within a minute. */
export function deletedMessageFields(now: Date) {
  return { text: '', mentionedUserIds: [] as string[], pageIds: [] as string[], deletedAt: now };
}
