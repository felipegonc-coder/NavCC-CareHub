import type {
  NoticeButton,
  NoticeButtonView,
  NoticeCard,
  NoticeCardView,
  NoticeKind,
  NoticeLinkButton,
  NoticeSummary,
  NoticeView,
  PageIcon,
} from '../types';

/** A stored notice, as the store hands it back. */
export interface NoticeRecord {
  id: string;
  workspaceId: string;
  userId: string;
  position: number;
  kind: NoticeKind;
  sender: string;
  actorUserId: string | null;
  icon: string | null;
  title: string;
  text: string | null;
  /** The first card. */
  card: NoticeCard | null;
  /** The second and third cards, in order. */
  extraCards: NoticeCard[];
  buttons: NoticeButton[];
  groupKey: string | null;
  count: number;
  createdAt: Date;
  latestAt: Date;
  readAt: Date | null;
}

/** What a reader who can open the page sees on its card. */
export interface PageCardInfo {
  title: string;
  icon: PageIcon | null;
  spaceName: string | null;
}

/** What a reader who can open the event sees on its card (from the Calendar feature). */
export interface EventCardInfo {
  title: string;
  /** When it happens, worded for this reader, such as "Tue, Oct 28 · 3:00 PM". */
  when: string | null;
  href: string;
}

/** 'locked': this reader can't open it. 'deleted': it's gone. */
export type CardLookup<T> = T | 'locked' | 'deleted';

/** One reader's view of the cards, looked up when the chat loads. Anything missing is locked. */
export interface CardLookups {
  /** By page ID. */
  pages: ReadonlyMap<string, CardLookup<PageCardInfo>>;
  /** By `eventCardKey(card)`. */
  events: ReadonlyMap<string, CardLookup<EventCardInfo>>;
}

export interface EventCardRef {
  eventId: string;
  occurrenceStart: string | null;
}

/**
 * `<eventId>|<occurrenceStart>`, or `<eventId>|` for the whole event. Event IDs never contain
 * '|', so one event's key can't be mistaken for another's.
 */
export function eventCardKey(card: { eventId: string; occurrenceStart?: string | null }): string {
  return `${card.eventId}|${card.occurrenceStart ?? ''}`;
}

type PageCard = Extract<NoticeCard, { type: 'page' }>;

/** Where a notice keeps its cards: the first one, then the rest. */
interface NoticeCards {
  card: NoticeCard | null;
  extraCards?: readonly NoticeCard[];
}

/** A notice's cards, in order. */
function noticeCards({ card, extraCards = [] }: NoticeCards): NoticeCard[] {
  return card ? [card, ...extraCards] : [...extraCards];
}

/** The pages and events these notices' cards point at, each once. */
export function collectCardRefs(records: readonly NoticeCards[]): {
  pageIds: string[];
  events: EventCardRef[];
} {
  const pageIds = new Set<string>();
  const events = new Map<string, EventCardRef>();
  for (const card of records.flatMap(noticeCards)) {
    if (card.type === 'page') pageIds.add(card.pageId);
    else {
      events.set(eventCardKey(card), {
        eventId: card.eventId,
        occurrenceStart: card.occurrenceStart ?? null,
      });
    }
  }
  return { pageIds: [...pageIds], events: [...events.values()] };
}

/** `/p/<pageId>`, the URL of every page, database and row (decision 0007, section 4.1). */
export function pageHref(pageId: string): string {
  return `/p/${pageId}`;
}

/** The card one reader sees. A locked or deleted card carries nothing but its type and state. */
export function viewCard(card: NoticeCard | null, lookups: CardLookups): NoticeCardView | null {
  if (!card) return null;
  if (card.type === 'page') {
    const page = lookups.pages.get(card.pageId) ?? 'locked';
    if (page === 'locked' || page === 'deleted') return { type: 'page', state: page };
    return {
      type: 'page',
      state: 'open',
      pageId: card.pageId,
      href: pageHref(card.pageId),
      title: page.title,
      icon: page.icon,
      spaceName: page.spaceName,
    };
  }
  const event = lookups.events.get(eventCardKey(card)) ?? 'locked';
  if (event === 'locked' || event === 'deleted') return { type: 'event', state: event };
  return {
    type: 'event',
    state: 'open',
    eventId: card.eventId,
    occurrenceStart: card.occurrenceStart ?? null,
    href: event.href,
    title: event.title,
    when: event.when,
  };
}

/** Buttons as the chat shows them: action names and values stay on the server. */
export function viewButtons(buttons: readonly NoticeButton[]): NoticeButtonView[] {
  return buttons.map((button) =>
    'href' in button
      ? { type: 'link', label: button.label, href: button.href }
      : {
          type: 'action',
          label: button.label,
          choices: (button.choices ?? []).map((choice) => choice.label),
        },
  );
}

export function toNoticeView(record: NoticeRecord, lookups: CardLookups): NoticeView {
  const cards = noticeCards(record).flatMap((card) => viewCard(card, lookups) ?? []);
  return {
    id: record.id,
    position: record.position,
    kind: record.kind,
    sender: record.sender,
    actorUserId: record.actorUserId,
    icon: record.icon,
    title: record.title,
    text: record.text,
    card: cards[0] ?? null,
    cards,
    buttons: viewButtons(record.buttons),
    count: record.count,
    createdAt: record.createdAt.toISOString(),
    latestAt: record.latestAt.toISOString(),
    read: record.readAt !== null,
  };
}

/**
 * Only the person whose 🔔 chat it's in may read a notice or use its buttons. Admins included:
 * they never read other people's notices (RP-D1).
 */
export function isNoticeOwner(
  notice: { workspaceId: string; userId: string },
  reader: { workspaceId: string; userId: string },
): boolean {
  return notice.userId === reader.userId && notice.workspaceId === reader.workspaceId;
}

/** The 🔔 Care Hub chat in the web app (Messages). */
export const NOTICES_CHAT_PATH = '/messages/care-hub';

/**
 * Where opening a notice goes: its first link button, else its first page card's page, else the
 * chat.
 */
export function noticeLink(notice: NoticeCards & { buttons: readonly NoticeButton[] }): string {
  const link = notice.buttons.find((button): button is NoticeLinkButton => 'href' in button);
  if (link) return link.href;
  const page = noticeCards(notice).find((card): card is PageCard => card.type === 'page');
  return page ? pageHref(page.pageId) : NOTICES_CHAT_PATH;
}

/** What `getNotice` returns: never a card's title, and no action names. */
export function toNoticeSummary(record: NoticeRecord): NoticeSummary {
  return {
    id: record.id,
    workspaceId: record.workspaceId,
    userId: record.userId,
    kind: record.kind,
    title: record.title,
    text: record.text,
    senderName: record.sender,
    link: noticeLink(record),
    createdAt: record.createdAt,
    latestAt: record.latestAt,
  };
}
