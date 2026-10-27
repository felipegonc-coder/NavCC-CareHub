import { z } from 'zod';
import { idSchema } from './compose';
import { COPY, NOTIFICATION_TEXT_LENGTH } from './constants';
import { truncateText } from './text';
import type { ChatType, MessageKind } from './types';

/** Settings → Notifications: all messages (default); only direct messages, @mentions and notices; or nothing. */
export const NOTIFICATION_LEVELS = ['all', 'directAndMentions', 'nothing'] as const;
export type NotificationLevel = (typeof NOTIFICATION_LEVELS)[number];

/** A person's notification settings. Missing values get the defaults. */
export const notificationSettingsSchema = z.object({
  level: z.enum(NOTIFICATION_LEVELS).default('all'),
  /** Show message text in notifications. */
  showText: z.boolean().default(true),
});
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = { level: 'all', showText: true };

export interface NotifyInput {
  recipientId: string;
  settings: NotificationSettings;
  /** The recipient's membership in the chat right now, or null if they're not in it. */
  membership: { muted: boolean } | null;
  chatType: ChatType;
  message: { kind: MessageKind; senderId: string | null; mentionedUserIds: readonly string[] };
  /** The recipient is reading the chat (see `isChatRead`). */
  readingChat: boolean;
  /** A Care Hub tab is open for the recipient (it has a live connection). */
  tabOpen: boolean;
  /** The recipient has at least one push subscription. */
  hasPushDevice: boolean;
}

/** Why a new message doesn't notify someone. */
export type QuietReason =
  | 'system-line'
  | 'own-message'
  | 'not-in-chat'
  | 'turned-off'
  | 'muted'
  | 'not-direct-or-mention'
  | 'reading'
  | 'no-device';

export type NotifyDecision =
  { notify: true; via: 'tab' | 'push' } | { notify: false; reason: QuietReason };

/**
 * Whether a new message or notice notifies someone, and how. Muted chats notify only for
 * @mentions. An open tab shows the notification itself; when Care Hub isn't open, web push is used.
 * Only new messages notify: edits, deletes and reactions never do.
 */
export function notifyDecision(input: NotifyInput): NotifyDecision {
  const { message, membership, settings } = input;
  const quiet = (reason: QuietReason): NotifyDecision => ({ notify: false, reason });
  if (message.kind === 'system') return quiet('system-line');
  if (message.senderId === input.recipientId) return quiet('own-message');
  if (!membership) return quiet('not-in-chat');
  if (settings.level === 'nothing') return quiet('turned-off');
  const mentioned = message.mentionedUserIds.includes(input.recipientId);
  if (membership.muted && !mentioned) return quiet('muted');
  const directOrNotice = input.chatType === 'direct' || message.kind === 'notice';
  if (settings.level === 'directAndMentions' && !mentioned && !directOrNotice) {
    return quiet('not-direct-or-mention');
  }
  if (input.readingChat) return quiet('reading');
  if (input.tabOpen) return { notify: true, via: 'tab' };
  if (input.hasPushDevice) return { notify: true, via: 'push' };
  return quiet('no-device');
}

/** What a notification shows. Also the web push payload, which the service worker parses. */
export const notificationContentSchema = z.object({
  /** The sender: a person's name, "Care Hub" or what sent the notice. */
  title: z.string().max(200),
  /** The first 100 characters, or "New message" / "New notice" when text is hidden. */
  body: z.string().max(400),
  /** One notification per chat: a newer one replaces the older (the Notification `tag`). */
  tag: z.string().max(100),
  /** Clicking the notification opens this chat at this message. */
  chatId: idSchema,
  messageId: idSchema,
});
export type NotificationContent = z.infer<typeof notificationContentSchema>;

export function notificationTag(chatId: string): string {
  return `chat:${chatId}`;
}

export function notificationContent(input: {
  chatId: string;
  messageId: string;
  kind: 'message' | 'notice';
  senderName: string;
  /** `messagePreview` of the message. */
  preview: string;
  showText: boolean;
}): NotificationContent {
  const hidden = input.kind === 'notice' ? COPY.hiddenNoticeText : COPY.hiddenMessageText;
  return {
    title: truncateText(input.senderName, 100),
    body: input.showText ? truncateText(input.preview, NOTIFICATION_TEXT_LENGTH) : hidden,
    tag: notificationTag(input.chatId),
    chatId: input.chatId,
    messageId: input.messageId,
  };
}
