// What the 🔔 Care Hub chat shows, worked out without React so it's easy to test.
import {
  datePart,
  formatDayDivider,
  formatTime,
  todayIn,
  toCivil,
  type CivilDate,
  type TimePrefs,
} from '@carehub/team-time';
import type { NoticeCardView, NoticeFilter, NoticeKind, NoticePage, NoticeView } from './api';

export const FILTER_LABELS: Readonly<Record<NoticeFilter, string>> = {
  all: 'All',
  mentions: 'Mentions and replies',
  following: 'Following',
  reminders: 'Reminders',
  requests: 'Requests',
  unread: 'Unread',
};

/** Each kind's icon, for notices sent without one. */
const KIND_ICONS: Readonly<Record<string, string>> = {
  reminder: '⏰',
  alert: '⚠️',
  mention: '💬',
  comment: '💬',
  automation: '⚡',
  reply: '↩️',
  suggestion: '✏️',
  suggestion_accepted: '✅',
  suggestion_rejected: '✖️',
  edit_summary: '📝',
  shared: '🔗',
  access_request: '🔑',
  import: '📥',
  export: '📤',
  review: '👀',
} satisfies Record<NoticeKind, string>;

export function noticeIcon(notice: Pick<NoticeView, 'icon' | 'kind'>): string {
  return notice.icon ?? KIND_ICONS[notice.kind] ?? '🔔';
}

/** Every loaded notice once, oldest first (each page comes newest first). */
export function chatNotices(pages: readonly NoticePage[]): NoticeView[] {
  const byId = new Map<string, NoticeView>();
  for (const page of pages) {
    for (const notice of page.notices) if (!byId.has(notice.id)) byId.set(notice.id, notice);
  }
  return [...byId.values()].sort((a, b) => a.position - b.position);
}

export interface ChatDay {
  /** Unique in the chat, even when a day shows up twice (clock changes). */
  key: string;
  date: CivilDate;
  /** 'Today', 'Yesterday', 'Mon, Oct 26', or 'Fri, Dec 26, 2025' in another year. */
  label: string;
  notices: NoticeView[];
}

/** The day each notice last arrived, in the person's time zone. */
function noticeDate(notice: NoticeView, timeZone: string): CivilDate {
  return datePart(toCivil(new Date(notice.latestAt), timeZone));
}

/** Notices (oldest first) under day dividers. */
export function chatDays(
  notices: readonly NoticeView[],
  prefs: Pick<TimePrefs, 'timeZone'>,
  now: Date,
): ChatDay[] {
  const today = todayIn(prefs.timeZone, now);
  const days: ChatDay[] = [];
  const seen = new Map<CivilDate, number>();
  for (const notice of notices) {
    const date = noticeDate(notice, prefs.timeZone);
    const last = days.at(-1);
    if (last?.date === date) {
      last.notices.push(notice);
      continue;
    }
    const times = (seen.get(date) ?? 0) + 1;
    seen.set(date, times);
    const key = times === 1 ? date : `${date}#${times}`;
    days.push({ key, date, label: formatDayDivider(date, today), notices: [notice] });
  }
  return days;
}

/** '3:30 PM', or '15:30' with the 24-hour setting, in the person's time zone. */
export function noticeTime(notice: NoticeView, prefs: Pick<TimePrefs, 'timeZone' | 'use24h'>) {
  return formatTime(toCivil(new Date(notice.latestAt), prefs.timeZone), prefs);
}

/** Where the "New messages" line goes: above the oldest unread notice, if any. */
export function firstUnreadId(notices: readonly NoticeView[]): string | null {
  return notices.find((notice) => !notice.read)?.id ?? null;
}

/**
 * Notices that arrived after the newest one shown before. A grouped notice that arrives again
 * moves to a new, higher position, so it counts too.
 */
export function arrivals(notices: readonly NoticeView[], newestBefore: number): NoticeView[] {
  return notices.filter((notice) => notice.position > newestBefore);
}

/** What screen readers hear when notices arrive while the chat is open. */
export function arrivalMessage(arrived: readonly NoticeView[]): string {
  const [only] = arrived;
  if (!only) return '';
  if (arrived.length > 1) return `${arrived.length} new notices`;
  return `New notice from ${only.sender}: ${only.title}`;
}

/** A card the reader can't open, or one that's gone: no title, just what happened. */
export function closedCardText(card: Extract<NoticeCardView, { state: 'locked' | 'deleted' }>) {
  if (card.state === 'locked') {
    return card.type === 'page' ? "🔒 A page you can't open" : "🔒 An event you can't open";
  }
  return card.type === 'page' ? 'This page was deleted' : 'This event was deleted';
}

/** The page with these notices read, or the same page when nothing changes. */
export function withRead(page: NoticePage, isRead: (notice: NoticeView) => boolean): NoticePage {
  let changed = false;
  const notices = page.notices.map((notice) => {
    if (notice.read || !isRead(notice)) return notice;
    changed = true;
    return { ...notice, read: true };
  });
  return changed ? { ...page, notices } : page;
}

/** The empty chat's text. */
export function emptyText(filter: NoticeFilter): string {
  return filter === 'all' ? 'No notices yet.' : 'No notices here.';
}
