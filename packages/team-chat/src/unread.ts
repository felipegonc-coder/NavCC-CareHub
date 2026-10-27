import { BADGE_MAX } from './constants';
import type { MessageKind } from './types';

/** What unread counting needs to know about a message. */
export interface UnreadMessage {
  /** Grows with every message in the chat (a bigserial ID works). */
  seq: number;
  kind: MessageKind;
  /** null for notices from Care Hub. */
  senderId: string | null;
  deleted: boolean;
  mentionedUserIds: readonly string[];
}

/** Messages from others and notices count; your own, system lines and deleted ones don't. */
export function countsAsUnread(message: UnreadMessage, viewerId: string): boolean {
  return message.kind !== 'system' && !message.deleted && message.senderId !== viewerId;
}

const isAfter = (message: UnreadMessage, lastReadSeq: number | null) =>
  lastReadSeq === null || message.seq > lastReadSeq;

export interface UnreadCounts {
  /** Shown on the chat in the list (grey when muted). */
  unread: number;
  /** Unread messages that @mention the viewer. */
  mentions: number;
}

/** Counts a chat's unread messages after the viewer's read marker (null: nothing read yet). */
export function unreadCounts(
  messages: readonly UnreadMessage[],
  viewerId: string,
  lastReadSeq: number | null,
): UnreadCounts {
  let unread = 0;
  let mentions = 0;
  for (const message of messages) {
    if (!isAfter(message, lastReadSeq) || !countsAsUnread(message, viewerId)) continue;
    unread += 1;
    if (message.mentionedUserIds.includes(viewerId)) mentions += 1;
  }
  return { unread, mentions };
}

/**
 * The sidebar badge (MS-06): unread messages and notices in unmuted chats, plus @mentions in muted
 * ones. Muting the 🔔 Care Hub chat silences its notices too. Reactions never count.
 */
export function badgeCount(chats: readonly (UnreadCounts & { muted: boolean })[]): number {
  return chats.reduce((sum, chat) => sum + (chat.muted ? chat.mentions : chat.unread), 0);
}

/** "1" to "99", then "99+"; null when there's nothing to show. */
export function badgeText(count: number): string | null {
  if (count <= 0) return null;
  return count > BADGE_MAX ? `${BADGE_MAX}+` : String(count);
}

/** The first unread message: the "New messages" line goes above it (MS-11). */
export function firstUnreadSeq(
  messages: readonly UnreadMessage[],
  viewerId: string,
  lastReadSeq: number | null,
): number | null {
  const first = messages
    .filter((message) => isAfter(message, lastReadSeq) && countsAsUnread(message, viewerId))
    .reduce<number | null>(
      (min, message) => (min === null || message.seq < min ? message.seq : min),
      null,
    );
  return first;
}

/** A chat counts as read when it's open, the tab is in front and the newest messages show. */
export function isChatRead(view: {
  chatOpen: boolean;
  tabVisible: boolean;
  newestOnScreen: boolean;
}): boolean {
  return view.chatOpen && view.tabVisible && view.newestOnScreen;
}

/** Read markers only move forward (except Mark as unread). */
export function advanceReadMarker(lastReadSeq: number | null, seenSeq: number): number {
  return lastReadSeq === null ? seenSeq : Math.max(lastReadSeq, seenSeq);
}

/** Mark as unread: the marker moves to just before the newest message from someone else. */
export function markAsUnreadSeq(
  messages: readonly UnreadMessage[],
  viewerId: string,
): number | null {
  let newest: number | null = null;
  for (const message of messages) {
    if (countsAsUnread(message, viewerId) && (newest === null || message.seq > newest)) {
      newest = message.seq;
    }
  }
  return newest === null ? null : newest - 1;
}
