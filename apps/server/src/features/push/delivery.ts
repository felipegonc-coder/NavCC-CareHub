// Push notifications for new notices and messages (Messages, "Unread and notifications"). Push is
// for when Care Hub isn't open: someone with a Care Hub tab open hears about it there instead, and
// team-chat's notifyDecision says whether a person hears about it at all (settings, mute,
// @mentions). While a person has paused notifications, nothing is pushed to them; notices still
// arrive in their 🔔 chat.
import { activePause, type NotificationPreferences } from './domain/preferences';
import { isCareHubPath, type PushNotice } from './payload';
import { pushToUser, type PushRuntime, type PushSummary, type PushToUserOptions } from './service';

/** What team-chat's `notifyDecision` is given. */
export interface NotifyInput {
  settings: Pick<NotificationPreferences, 'notifyAbout' | 'showText'>;
  /** The person's membership of the chat; null for the 🔔 Care Hub chat. */
  membership: { muted: boolean } | null;
  chatType: 'direct' | 'group' | 'careHub';
  kind: 'message' | 'notice' | 'system';
  own: boolean;
  mentionsUser: boolean;
  readingChat: boolean;
  tabOpen: boolean;
  hasPushDevice: boolean;
}

export type NotifyDecision =
  { notify: true; via: 'tab' | 'push' } | { notify: false; reason: string };

/** A notice as notices' `getNotice` returns it (`NoticeSummary`): the parts a push needs. */
export interface NoticeForPush {
  id: string;
  /** Whose 🔔 chat it's in: the only person it may be shown to. */
  userId: string;
  kind: string;
  /** Generic, such as "Course assigned". Never a page or event title. */
  title: string;
  text: string | null;
  senderName: string;
  /** A Care Hub path, such as `/p/<pageId>`. */
  link: string;
}

/** A message as Messages' `getMessageForPush` returns it for one reader (`MessageForPush`). */
export interface MessageForPush {
  chatId: string;
  messageId: string;
  chatType: 'direct' | 'group';
  chatName: string;
  senderName: string;
  /** At most 100 characters; empty for a message with only files. */
  text: string;
  mentionsUser: boolean;
  muted: boolean;
}

/** The other features delivery reads from: sources.ts in the app, fakes in tests. */
export interface DeliverySources {
  /** True while the person has a Care Hub tab connected (live updates). */
  hasOpenTabs(userId: string): boolean;
  /** The notice, or null when there's no such notice. */
  getNotice(noticeId: string): Promise<NoticeForPush | null>;
  /** The message as this person sees it, or null when they can't see it. */
  getMessage(messageId: string, userId: string): Promise<MessageForPush | null>;
  /** team-chat's `notifyDecision`, which holds the rules. */
  decide(input: NotifyInput): NotifyDecision;
}

/** The parts of `notices.notice.created` that delivery reads. */
export interface NoticeCreated {
  userId: string;
  noticeId: string;
}

/** The parts of `messages.message.created` that delivery reads. */
export interface MessageCreated {
  messageId: string;
  senderId: string;
  recipientIds: readonly string[];
}

/** What happened for one person, for tests and logs. */
export type DeliveryOutcome =
  { userId: string; pushed: PushSummary } | { userId: string; skipped: string };

export interface PushDelivery {
  noticeCreated(event: NoticeCreated): Promise<DeliveryOutcome>;
  messageCreated(event: MessageCreated): Promise<DeliveryOutcome[]>;
}

/** Where a notice opens when its own link isn't a Care Hub path. */
const CARE_HUB_CHAT = '/messages/care-hub';
/** Notices that shouldn't wait for a phone to wake up. */
const URGENT_NOTICES = new Set(['reminder', 'alert']);
/** People handled at once for one message. */
const MESSAGE_CONCURRENCY = 4;

/** What a push says for one person, and what notifyDecision needs to know about it. */
interface Draft {
  facts: Pick<NotifyInput, 'chatType' | 'kind' | 'membership' | 'mentionsUser'>;
  notice: PushNotice;
  options?: PushToUserOptions;
}

export function createPushDelivery(runtime: PushRuntime, sources: DeliverySources): PushDelivery {
  const { store } = runtime;

  async function deliver(
    userId: string,
    draft: () => Promise<Draft | null>,
  ): Promise<DeliveryOutcome> {
    const skipped = (reason: string): DeliveryOutcome => ({ userId, skipped: reason });
    if (!runtime.config.enabled) return skipped('push-off');
    if (sources.hasOpenTabs(userId)) return skipped('tab-open');
    const [browsers, preferences] = await Promise.all([
      store.listSubscriptions(userId),
      store.getPreferences(userId),
    ]);
    if (browsers.length === 0) return skipped('no-browser');
    if (activePause(preferences.pause, runtime.now?.() ?? new Date())) return skipped('paused');
    const found = await draft();
    if (!found) return skipped('not-found');
    const decision = sources.decide({
      ...found.facts,
      settings: { notifyAbout: preferences.notifyAbout, showText: preferences.showText },
      own: false,
      readingChat: false,
      tabOpen: false,
      hasPushDevice: true,
    });
    if (!decision.notify) return skipped(decision.reason);
    if (decision.via !== 'push') return skipped('tab-open');
    return { userId, pushed: await pushToUser(runtime, userId, found.notice, found.options) };
  }

  /** Never throws: a failure for one person is logged and doesn't stop the others. */
  async function safely(userId: string, draft: () => Promise<Draft | null>) {
    try {
      return await deliver(userId, draft);
    } catch (error) {
      runtime.log?.warn({ userId, err: error }, 'A push notification could not be delivered.');
      return { userId, skipped: 'failed' };
    }
  }

  return {
    noticeCreated: ({ userId, noticeId }) =>
      safely(userId, async () => {
        const notice = await sources.getNotice(noticeId);
        if (!notice || notice.userId !== userId) return null;
        return {
          facts: {
            chatType: 'careHub',
            kind: 'notice',
            membership: null,
            mentionsUser: notice.kind === 'mention',
          },
          notice: noticePush(notice),
          options: { urgency: URGENT_NOTICES.has(notice.kind) ? 'high' : 'normal' },
        };
      }),

    messageCreated: ({ messageId, senderId, recipientIds }) => {
      const people = [...new Set(recipientIds)].filter((userId) => userId !== senderId);
      return inBatches(people, MESSAGE_CONCURRENCY, (userId) =>
        safely(userId, async () => {
          const message = await sources.getMessage(messageId, userId);
          if (!message) return null;
          return {
            facts: {
              chatType: message.chatType,
              kind: 'message',
              membership: { muted: message.muted },
              mentionsUser: message.mentionsUser,
            },
            notice: messagePush(message),
          };
        }),
      );
    },
  };
}

/** One notification per notice: a grouped notice keeps its ID, so it replaces its last one. */
function noticePush(notice: NoticeForPush): PushNotice {
  const target = {
    url: isCareHubPath(notice.link) ? notice.link : CARE_HUB_CHAT,
    tag: `notice:${notice.id}`,
  };
  const text = notice.text ?? undefined;
  switch (notice.kind) {
    case 'reminder':
      return { kind: 'reminder', text, ...target };
    case 'mention':
      return { kind: 'mention', from: notice.senderName, text, ...target };
    default:
      return { kind: 'notice', from: notice.senderName, what: notice.title, text, ...target };
  }
}

/** One notification per chat: a chat's newer message replaces its older one. */
function messagePush(message: MessageForPush): PushNotice {
  const chat = encodeURIComponent(message.chatId);
  const target = {
    url: `/messages/${chat}?message=${encodeURIComponent(message.messageId)}`,
    tag: `chat:${message.chatId}`,
  };
  if (!message.mentionsUser) {
    return { kind: 'message', from: message.senderName, text: message.text, ...target };
  }
  const title = message.chatType === 'group' ? message.chatName : undefined;
  return { kind: 'mention', from: message.senderName, title, text: message.text, ...target };
}

/** Runs `run` for every item, `size` at a time, in order. */
async function inBatches<Item, Result>(
  items: readonly Item[],
  size: number,
  run: (item: Item) => Promise<Result>,
): Promise<Result[]> {
  const results: Result[] = [];
  for (let start = 0; start < items.length; start += size) {
    results.push(...(await Promise.all(items.slice(start, start + size).map(run))));
  }
  return results;
}
