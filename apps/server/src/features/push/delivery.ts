// Push notifications for new notices (Messages, "Unread and notifications"). Push is for when Care
// Hub isn't open: someone with a Care Hub tab open hears about it in the tab instead. The rules
// (Settings → Notifications, mute, @mentions) are team-chat's notifyDecision.
import type { NotifyDecision, NotifyInput, QuietReason } from '@carehub/team-chat';
import type { NoticeCreatedEvent, NoticeSummary } from '../notices';
import { isCareHubPath, type PushNotice } from './payload';
import { pushToUser, type PushRuntime, type PushSummary } from './service';

/** What delivery reads from other features: sources.ts in the app, fakes in tests. */
export interface DeliverySources {
  /** Live's `hasOpenTabs`: true while the person has a Care Hub tab connected. */
  hasOpenTabs(userId: string): boolean;
  /** Notices' `getNotice`: the notice, or null when there's no such notice. */
  getNotice(noticeId: string): Promise<NoticeSummary | null>;
  /** Team-chat's `notifyDecision`. */
  decide(input: NotifyInput): NotifyDecision;
}

/** What happened, for tests and logs. */
export type DeliveryOutcome =
  | { pushed: PushSummary }
  | { skipped: QuietReason | 'push-off' | 'not-found' | 'tab-open' | 'failed' };

export interface PushDelivery {
  /** For `notices.notice.created`. Never throws: a failure is logged. */
  noticeCreated(event: Pick<NoticeCreatedEvent, 'userId' | 'noticeId'>): Promise<DeliveryOutcome>;
}

/** Where a notice opens when its link isn't a Care Hub path. */
const CARE_HUB_CHAT = '/messages/care-hub';
/** Notices that shouldn't wait for a phone to wake up. */
const URGENT_KINDS: ReadonlySet<string> = new Set(['reminder', 'alert']);

export function createPushDelivery(runtime: PushRuntime, sources: DeliverySources): PushDelivery {
  async function deliverNotice(userId: string, noticeId: string): Promise<DeliveryOutcome> {
    if (!runtime.config.enabled) return { skipped: 'push-off' };
    const [browsers, preferences] = await Promise.all([
      runtime.store.listSubscriptions(userId),
      runtime.store.getPreferences(userId),
    ]);
    if (browsers.length === 0) return { skipped: 'no-device' };
    const notice = await sources.getNotice(noticeId);
    // Only the person whose 🔔 chat it's in may see it.
    if (!notice || notice.userId !== userId) return { skipped: 'not-found' };
    const decision = sources.decide({
      settings: {
        notifyAbout: preferences.notifyAbout,
        showText: preferences.showText,
        paused: false,
      },
      // Everyone is in their own 🔔 chat.
      membership: { muted: false },
      chatType: 'careHub',
      kind: 'notice',
      own: false,
      mentionsUser: notice.kind === 'mention',
      readingChat: false,
      tabOpen: sources.hasOpenTabs(userId),
      hasPushDevice: true,
    });
    if (!decision.notify) return { skipped: decision.reason };
    if (decision.via === 'tab') return { skipped: 'tab-open' };
    const urgency = URGENT_KINDS.has(notice.kind) ? 'high' : 'normal';
    return { pushed: await pushToUser(runtime, userId, noticePush(notice), { urgency }) };
  }

  return {
    async noticeCreated({ userId, noticeId }) {
      try {
        return await deliverNotice(userId, noticeId);
      } catch (error) {
        runtime.log?.warn({ noticeId, err: error }, 'A notice could not be pushed.');
        return { skipped: 'failed' };
      }
    },
  };
}

/**
 * One notification per notice. A grouped notice keeps its ID, so its newest part replaces the
 * notification of the one before.
 */
function noticePush(notice: NoticeSummary): PushNotice {
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
