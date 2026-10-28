import { z } from 'zod';
import { idSchema } from './compose';
import { COPY, NOTIFICATION_TEXT_LENGTH } from './constants';
import { collapseWhitespace, isBlankText, truncateText } from './text';
import type { ChatType, MessageKind } from './types';

/**
 * Settings → Notifications, as push stores them (`push_preferences`): all messages (default);
 * `mentions`, which is direct messages, @mentions and notices; or nothing.
 */
export const NOTIFY_ABOUT = ['all', 'mentions', 'nothing'] as const;
export type NotifyAbout = (typeof NOTIFY_ABOUT)[number];

/** A person's notification settings. Missing values get the defaults. */
export const notificationSettingsSchema = z.object({
  notifyAbout: z.enum(NOTIFY_ABOUT).default('all'),
  /** Show message text in notifications. */
  showText: z.boolean().default(true),
  /** A pause is on right now (push keeps it as `pause.until`): nothing notifies until it ends. */
  paused: z.boolean().default(false),
});
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  notifyAbout: 'all',
  showText: true,
  paused: false,
};

export interface NotifyInput {
  settings: NotificationSettings;
  /** The person's membership of the chat right now, or null if they're not in it. */
  membership: { muted: boolean } | null;
  chatType: ChatType;
  kind: MessageKind;
  /** The person sent it. */
  own: boolean;
  /** It @mentions the person. */
  mentionsUser: boolean;
  /** The person is reading the chat (see `isChatRead`). Only a tab knows; the server passes false. */
  readingChat: boolean;
  /** A Care Hub tab is open for the person (live's `hasOpenTabs`). */
  tabOpen: boolean;
  /** The person has at least one push subscription. */
  hasPushDevice: boolean;
}

/** Why a new message doesn't notify someone. */
export type QuietReason =
  | 'system-line'
  | 'own-message'
  | 'not-in-chat'
  | 'turned-off'
  | 'paused'
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
  const { membership, settings } = input;
  const quiet = (reason: QuietReason): NotifyDecision => ({ notify: false, reason });
  if (input.kind === 'system') return quiet('system-line');
  if (input.own) return quiet('own-message');
  if (!membership) return quiet('not-in-chat');
  if (settings.notifyAbout === 'nothing') return quiet('turned-off');
  if (settings.paused) return quiet('paused');
  if (membership.muted && !input.mentionsUser) return quiet('muted');
  const directOrNotice = input.chatType === 'direct' || input.kind === 'notice';
  if (settings.notifyAbout === 'mentions' && !input.mentionsUser && !directOrNotice) {
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
  /**
   * What the body shows when text is on: a message's plain text (`messagePlainText`, mentions as
   * names), '' when it has only files or page cards (never file names), or a notice's
   * `messagePreview`.
   */
  text: string;
  showText: boolean;
  /** It @mentions the person: the title reads "Avery Lin mentioned you". */
  mentionsUser?: boolean;
}): NotificationContent {
  const hidden = input.kind === 'notice' ? COPY.hiddenNoticeText : COPY.hiddenMessageText;
  const sender = truncateText(input.senderName, 100);
  const text = collapseWhitespace(input.text);
  return {
    title: input.mentionsUser ? `${sender} mentioned you` : sender,
    body:
      input.showText && !isBlankText(text) ? truncateText(text, NOTIFICATION_TEXT_LENGTH) : hidden,
    tag: notificationTag(input.chatId),
    chatId: input.chatId,
    messageId: input.messageId,
  };
}
