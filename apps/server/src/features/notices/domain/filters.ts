import type { NoticeKind } from '../types';

/** The chips above the 🔔 Care Hub chat, in order. */
export const NOTICE_FILTERS = [
  'all',
  'mentions',
  'following',
  'reminders',
  'requests',
  'unread',
] as const;
export type NoticeFilter = (typeof NOTICE_FILTERS)[number];

/**
 * The kinds each chip shows. All and Unread show every kind (Unread only the unread ones), so
 * alerts, automations, shares, imports, exports, reviews and form responses appear under those
 * two only.
 */
export const FILTER_KINDS: Readonly<Record<NoticeFilter, readonly NoticeKind[] | null>> = {
  all: null,
  mentions: ['mention', 'reply', 'suggestion_accepted', 'suggestion_rejected'],
  following: ['comment', 'suggestion', 'edit_summary'],
  reminders: ['reminder'],
  requests: ['access_request'],
  unread: null,
};

/** Whether a notice shows under this chip. */
export function matchesFilter(
  filter: NoticeFilter,
  notice: { kind: NoticeKind; readAt: Date | null },
): boolean {
  if (filter === 'unread') return notice.readAt === null;
  const kinds = FILTER_KINDS[filter];
  return kinds === null || kinds.includes(notice.kind);
}
