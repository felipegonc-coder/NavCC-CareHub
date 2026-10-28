// The /api/notices calls behind the 🔔 Care Hub chat. The types mirror the server's views in
// apps/server/src/features/notices/types.ts.
import { api } from '../../lib/api';

/** The chips above the chat, in order. */
export const NOTICE_FILTERS = [
  'all',
  'mentions',
  'following',
  'reminders',
  'requests',
  'unread',
] as const;
export type NoticeFilter = (typeof NOTICE_FILTERS)[number];

export type NoticeKind =
  | 'reminder'
  | 'alert'
  | 'mention'
  | 'comment'
  | 'automation'
  | 'reply'
  | 'suggestion'
  | 'suggestion_accepted'
  | 'suggestion_rejected'
  | 'edit_summary'
  | 'shared'
  | 'access_request'
  | 'import'
  | 'export'
  | 'review';

/** A page icon, as the page model stores it. */
export type PageIcon =
  { type: 'emoji'; emoji: string } | { type: 'icon'; name: string; color?: string | null };

/** A card under a notice, looked up for the reader each time the chat loads. */
export type NoticeCardView =
  | {
      type: 'page';
      state: 'open';
      pageId: string;
      href: string;
      title: string;
      icon: PageIcon | null;
      spaceName: string | null;
    }
  | {
      type: 'event';
      state: 'open';
      eventId: string;
      occurrenceStart: string | null;
      href: string;
      title: string;
      /** Worded by Calendar for this reader, such as "Tue, Oct 28 · 3:00 PM". */
      when: string | null;
    }
  /** A page or event the reader can't open, or one that was deleted: nothing else is sent. */
  | { type: 'page' | 'event'; state: 'locked' | 'deleted' };

export type NoticeButtonView =
  | { type: 'link'; label: string; href: string }
  /** `choices` holds the menu's labels (empty when the button runs straight away). */
  | { type: 'action'; label: string; choices: string[] };

export interface NoticeView {
  id: string;
  /** Order in the chat: higher is newer. Paging and "read up to here" use it. */
  position: number;
  kind: NoticeKind;
  sender: string;
  actorUserId: string | null;
  /** An emoji; without one the chat shows the kind's icon. */
  icon: string | null;
  title: string;
  text: string | null;
  /** The first card. */
  card: NoticeCardView | null;
  /** Every card, in order: up to 3, `card` first. Without it, the notice shows `card`. */
  cards?: NoticeCardView[];
  buttons: NoticeButtonView[];
  /** How many notices were grouped into this one (1 when none were). */
  count: number;
  /** ISO instants: when it first arrived, and when it last arrived (the one the chat shows). */
  createdAt: string;
  latestAt: string;
  read: boolean;
}

/** One page of the chat, newest first. */
export interface NoticePage {
  notices: NoticeView[];
  /** Pass it as `before` for the next, older page; null when there's none. */
  nextCursor: number | null;
  unread: number;
}

/** The newest notice, for the 🔔 Care Hub row in Messages. */
export interface NoticesPreview {
  title: string;
  sender: string;
  /** ISO instant. */
  latestAt: string;
}

export interface NoticesSummary {
  unread: number;
  latest: NoticesPreview | null;
}

export interface NoticeUnread {
  unread: number;
}

export interface NoticeActionResult {
  /** The feature's confirmation, such as "Snoozed for 1 hour". */
  message: string | null;
  unread: number;
}

/** Notices on each page of the chat. */
export const NOTICE_PAGE_SIZE = 50;

const BASE = '/api/notices';
const noticePath = (id: string) => `${BASE}/${encodeURIComponent(id)}`;

export const noticesApi = {
  list(filter: NoticeFilter, before: number | null, signal?: AbortSignal): Promise<NoticePage> {
    const query = new URLSearchParams({ filter, limit: String(NOTICE_PAGE_SIZE) });
    if (before !== null) query.set('before', String(before));
    return api.get<NoticePage>(`${BASE}?${query.toString()}`, { signal });
  },
  summary: (signal?: AbortSignal) => api.get<NoticesSummary>(`${BASE}/summary`, { signal }),
  /** Marks every notice up to this position read ("read up to here"). */
  readThrough: (through: number) => api.post<NoticeUnread>(`${BASE}/read`, { through }),
  readAll: () => api.post<NoticeUnread>(`${BASE}/read-all`),
  readOne: (id: string) => api.post<NoticeUnread>(`${noticePath(id)}/read`),
  /** Clicks an action button, by its place on the notice (and the picked choice's). */
  click: (id: string, button: number, choice?: number) =>
    api.post<NoticeActionResult>(
      `${noticePath(id)}/actions`,
      choice === undefined ? { button } : { button, choice },
    ),
};
