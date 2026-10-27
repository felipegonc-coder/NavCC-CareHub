import { mentionedUserIds, type CommentPerson, type CommentThreadView } from '@carehub/shared';

export type ThreadTab = 'open' | 'resolved';
/** "For me": threads that mention you or that you took part in. Suggestions come later. */
export type ThreadFilter = 'all' | 'forMe';
export type ThreadOrder = 'position' | 'newest';

/**
 * Where a thread's spot is on the page, from the editor: a position to sort by, null once its
 * text or block is gone, or undefined while there's no editor to ask.
 */
export type LocateThread = (thread: CommentThreadView) => number | null | undefined;

export interface ThreadView {
  tab: ThreadTab;
  filter: ThreadFilter;
  order: ThreadOrder;
  viewerId?: string | undefined;
  locate?: LocateThread | undefined;
}

export function isForMe(thread: CommentThreadView, viewerId: string | undefined): boolean {
  if (!viewerId) return false;
  return thread.comments.some(
    (comment) => comment.authorId === viewerId || mentionedUserIds(comment.text).includes(viewerId),
  );
}

// By position: the page's own threads, then a row's properties, then the content top to bottom.
const RANK = { page: 0, property: 1, block: 2, text: 2 } as const;

/** The threads a tab shows, filtered and in order. */
export function visibleThreads(
  threads: readonly CommentThreadView[],
  view: ThreadView,
): CommentThreadView[] {
  const shown = threads.filter(
    (thread) =>
      (thread.resolvedAt !== null) === (view.tab === 'resolved') &&
      (view.filter === 'all' || isForMe(thread, view.viewerId)),
  );
  if (view.order === 'newest') {
    return shown.sort((a, b) => b.lastCommentAt.localeCompare(a.lastCommentAt));
  }
  const keyed = shown.map((thread) => {
    const rank = RANK[thread.spot];
    // A spot the editor can't find (or no editor yet) goes after the others, oldest first.
    const at = rank === 2 ? (view.locate?.(thread) ?? Infinity) : 0;
    return { thread, rank, at };
  });
  keyed.sort(
    (a, b) =>
      a.rank - b.rank ||
      (a.at === b.at ? 0 : a.at - b.at) ||
      a.thread.createdAt.localeCompare(b.thread.createdAt),
  );
  return keyed.map(({ thread }) => thread);
}

/** A person's current name, or "(removed)" once they're no longer in the workspace. */
export function nameOf(people: Record<string, CommentPerson>, userId: string): string {
  return people[userId]?.name ?? '(removed)';
}

export type TextPart = { text: string } | { userId: string };

/** Comment text in parts: plain text, and the people mentioned as `<@userId>`. */
export function textParts(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(/<@([\w-]{1,64})>/g)) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index) });
    parts.push({ userId: match[1] ?? '' });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

const clock = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const thisYear = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const otherYear = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
export const fullDate = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'long',
  timeStyle: 'short',
});

/** "Just now", "5 min ago", the time for today, else the day ("Oct 26"). */
export function formatWhen(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (date.toDateString() === now.toDateString()) return clock.format(date);
  return (date.getFullYear() === now.getFullYear() ? thisYear : otherYear).format(date);
}
