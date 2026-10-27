import { DEFAULT_TIME_PREFS } from '@carehub/team-time';
import { Button, cn, Skeleton, VisuallyHidden } from '@carehub/ui';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ArrowDown } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { NOTICE_FILTERS, noticesApi, type NoticeFilter, type NoticePage } from './api';
import {
  arrivalMessage,
  arrivals,
  chatDays,
  chatNotices,
  emptyText,
  FILTER_LABELS,
  firstUnreadId,
} from './chat';
import { noticesKeys, useNoticeReads, useNoticesUnread } from './hooks';
import { NoticeItem } from './NoticeItem';

export interface NoticesChatProps {
  className?: string;
}

/** Loading shows nothing for this long, then a skeleton. */
const SKELETON_DELAY_MS = 300;

// Times use the default settings until the person's own reach the web app.
const prefs = DEFAULT_TIME_PREFS;

/**
 * The 🔔 Care Hub chat (Messages spec MS-09, MS-10): the person's notices, oldest at the top,
 * with filter chips. It fills its parent (a flex column) and scrolls inside; Messages gives it
 * the page and the heading, so its own headings start at h3.
 */
export default function NoticesChatView({ className }: NoticesChatProps) {
  const baseId = useId();
  const [filter, setFilter] = useState<NoticeFilter>('all');
  const unread = useNoticesUnread();
  const reads = useNoticeReads();
  const list = useInfiniteQuery({
    queryKey: noticesKeys.list(filter),
    queryFn: ({ pageParam, signal }) => noticesApi.list(filter, pageParam, signal),
    initialPageParam: null as number | null,
    getNextPageParam: (last: NoticePage) => last.nextCursor,
  });
  const notices = useMemo(() => chatNotices(list.data?.pages ?? []), [list.data]);
  const days = useMemo(() => chatDays(notices, prefs, new Date()), [notices]);
  const newest = notices.at(-1);

  // The "New messages" line stays where the first unread notice was when this view loaded.
  const [newLine, setNewLine] = useState<{ filter: NoticeFilter; id: string | null } | null>(null);
  if (list.data && newLine?.filter !== filter) {
    setNewLine({ filter, id: filter === 'unread' ? null : firstUnreadId(notices) });
  }
  const newLineId = newLine?.filter === filter ? newLine.id : null;

  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [topEdge, setTopEdge] = useState<HTMLDivElement | null>(null);
  const [bottomEdge, setBottomEdge] = useState<HTMLDivElement | null>(null);
  const atTop = useInView(scroller, topEdge);
  const atBottom = useInView(scroller, bottomEdge);
  const tabVisible = useTabVisible();

  // Scrolling: start at the "New messages" line (or the end), stay at the end while new notices
  // arrive there, and keep the place when older ones load above.
  const pinned = useRef(true);
  const olderFrom = useRef<number | null>(null);
  const placedFor = useRef<NoticeFilter | null>(null);
  useEffect(() => {
    if (atBottom !== null) pinned.current = atBottom;
  }, [atBottom]);
  useLayoutEffect(() => {
    if (!scroller || notices.length === 0) return;
    if (placedFor.current !== filter) {
      placedFor.current = filter;
      const line = newLineId ? scroller.querySelector<HTMLElement>('[data-new-line]') : null;
      pinned.current = !line;
      scroller.scrollTop = line
        ? Math.max(0, line.offsetTop - scroller.clientHeight / 3)
        : scroller.scrollHeight;
    } else if (olderFrom.current !== null) {
      scroller.scrollTop = scroller.scrollHeight - olderFrom.current;
      olderFrom.current = null;
    } else if (pinned.current) {
      scroller.scrollTop = scroller.scrollHeight;
    }
  }, [scroller, notices, filter, newLineId]);

  const { fetchNextPage, hasNextPage, isFetchingNextPage, isFetchNextPageError } = list;
  const loadOlder = useCallback(() => {
    if (!scroller || isFetchingNextPage) return;
    olderFrom.current = scroller.scrollHeight - scroller.scrollTop;
    void fetchNextPage();
  }, [scroller, isFetchingNextPage, fetchNextPage]);
  useEffect(() => {
    if (atTop && hasNextPage && !isFetchingNextPage && !isFetchNextPageError) loadOlder();
  }, [atTop, hasNextPage, isFetchingNextPage, isFetchNextPageError, loadOlder]);

  // Read up to here: in All, while the tab is in front and the newest notice is in view.
  const { mutate: readThrough } = reads.through;
  const markedThrough = useRef(0);
  const hasUnread = unread > 0 || notices.some((notice) => !notice.read);
  useEffect(() => {
    if (filter !== 'all' || !tabVisible || atBottom !== true || !newest || !hasUnread) return;
    if (newest.position <= markedThrough.current) return;
    const before = markedThrough.current;
    markedThrough.current = newest.position;
    readThrough(newest.position, {
      onError: () => {
        markedThrough.current = before;
      },
    });
  }, [filter, tabVisible, atBottom, newest, hasUnread, readThrough]);

  // Screen readers hear about notices that arrive while the chat is open.
  const [announcement, setAnnouncement] = useState('');
  const newestShown = useRef<{ filter: NoticeFilter; position: number } | null>(null);
  useEffect(() => {
    const position = notices.at(-1)?.position;
    if (position === undefined) return;
    const before = newestShown.current?.filter === filter ? newestShown.current : null;
    newestShown.current = { filter, position: Math.max(position, before?.position ?? 0) };
    if (!before || position <= before.position) return;
    const message = arrivalMessage(arrivals(notices, before.position));
    if (message) setAnnouncement(message);
  }, [filter, notices]);

  // Tab stops at one notice; ↑ and ↓ move between notices.
  const [activeId, setActiveId] = useState<string | null>(null);
  const tabbableId =
    activeId !== null && notices.some((notice) => notice.id === activeId)
      ? activeId
      : (newest?.id ?? null);
  useEffect(() => {
    if (!scroller) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      if (event.defaultPrevented || !(event.target instanceof Element)) return;
      const current = event.target.closest<HTMLElement>('[data-notice-id]');
      if (!current) return;
      const items = [...scroller.querySelectorAll<HTMLElement>('[data-notice-id]')];
      const next = items[items.indexOf(current) + (event.key === 'ArrowDown' ? 1 : -1)];
      if (!next) return;
      event.preventDefault();
      next.focus();
    };
    scroller.addEventListener('keydown', onKeyDown);
    return () => scroller.removeEventListener('keydown', onKeyDown);
  }, [scroller]);

  const jumpToLatest = () => {
    if (!scroller) return;
    scroller.scrollTop = scroller.scrollHeight;
    const items = scroller.querySelectorAll<HTMLElement>('[data-notice-id]');
    items[items.length - 1]?.focus({ preventScroll: true });
  };

  const showSkeleton = useDelayed(list.isPending, SKELETON_DELAY_MS);
  let body: ReactNode;
  if (!list.data) {
    if (list.isError) {
      body = <LoadError message={list.error?.message} onRetry={() => void list.refetch()} />;
    } else body = showSkeleton ? <ChatSkeleton /> : null;
  } else if (notices.length === 0) {
    body = <EmptyChat filter={filter} onShowAll={() => setFilter('all')} />;
  } else {
    body = (
      <>
        <div ref={setTopEdge} data-edge="top" className="h-px" />
        {hasNextPage && (
          <div className="flex justify-center py-2">
            <Button size="sm" variant="ghost" loading={isFetchingNextPage} onClick={loadOlder}>
              Load older notices
            </Button>
          </div>
        )}
        {isFetchNextPageError && (
          <p role="alert" className="px-4 py-2 text-center text-small text-danger">
            Couldn&apos;t load older notices.
          </p>
        )}
        {days.map((day) => (
          <section key={day.key} aria-labelledby={`${baseId}-${day.key}`}>
            <h3
              id={`${baseId}-${day.key}`}
              className="sticky top-0 z-10 bg-bg px-4 py-1 text-center text-label font-medium text-muted"
            >
              {day.label}
            </h3>
            <ol className="space-y-1 px-2">
              {day.notices.map((notice) => (
                <li key={notice.id}>
                  {notice.id === newLineId && <NewMessagesLine />}
                  <NoticeItem
                    notice={notice}
                    prefs={prefs}
                    tabbable={notice.id === tabbableId}
                    onFocus={() => setActiveId(notice.id)}
                    onOpen={() => {
                      if (!notice.read) reads.one.mutate(notice.id);
                    }}
                  />
                </li>
              ))}
            </ol>
          </section>
        ))}
        <div ref={setBottomEdge} data-edge="bottom" className="h-px" />
      </>
    );
  }

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <div role="group" aria-label="Filter notices" className="flex flex-1 flex-wrap gap-1">
          {NOTICE_FILTERS.map((option) => (
            <Button
              key={option}
              size="sm"
              variant={option === filter ? 'secondary' : 'ghost'}
              aria-pressed={option === filter}
              onClick={() => setFilter(option)}
            >
              {FILTER_LABELS[option]}
            </Button>
          ))}
        </div>
        <Button
          size="sm"
          variant="ghost"
          disabled={unread === 0}
          loading={reads.all.isPending}
          onClick={() => reads.all.mutate()}
        >
          Mark all as read
        </Button>
      </div>
      <div className="relative min-h-0 flex-1">
        <div
          ref={setScroller}
          aria-busy={list.isPending || undefined}
          className="absolute inset-0 overflow-y-auto overscroll-contain py-2"
        >
          {body}
        </div>
        {atBottom === false && notices.length > 0 && (
          <Button
            size="sm"
            variant="secondary"
            className="absolute bottom-3 right-4 shadow-menu"
            onClick={jumpToLatest}
          >
            <ArrowDown aria-hidden className="size-4" />
            Jump to latest
          </Button>
        )}
      </div>
      <p className="border-t border-border px-4 py-3 text-center text-small text-muted">
        Care Hub sends reminders, automations and alerts here.
      </p>
      <VisuallyHidden role="status">{announcement}</VisuallyHidden>
    </div>
  );
}

function NewMessagesLine() {
  return (
    <div
      data-new-line
      className="my-2 flex items-center gap-3 px-2 text-label font-medium text-primary"
    >
      <span aria-hidden className="h-px flex-1 bg-primary" />
      New messages
      <span aria-hidden className="h-px flex-1 bg-primary" />
    </div>
  );
}

function ChatSkeleton() {
  return (
    <div role="status" className="space-y-4 px-5 py-3">
      <VisuallyHidden>Loading notices</VisuallyHidden>
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex gap-3">
          <Skeleton className="size-6 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

function LoadError({ message, onRetry }: { message?: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 px-4 py-8 text-center">
      <p className="text-body text-fg">Couldn&apos;t load your notices.</p>
      {message && <p className="text-small text-muted">{message}</p>}
      <Button size="sm" variant="secondary" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

function EmptyChat({ filter, onShowAll }: { filter: NoticeFilter; onShowAll: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
      <p className="text-body text-muted">{emptyText(filter)}</p>
      {filter !== 'all' && (
        <Button size="sm" variant="secondary" onClick={onShowAll}>
          Show all
        </Button>
      )}
    </div>
  );
}

/** Whether `target` shows inside `root`'s scroll area: null until known (or without support). */
function useInView(root: HTMLElement | null, target: HTMLElement | null): boolean | null {
  const [inView, setInView] = useState<boolean | null>(null);
  useEffect(() => {
    if (!root || !target || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries.at(-1);
        if (entry) setInView(entry.isIntersecting);
      },
      { root },
    );
    observer.observe(target);
    return () => {
      observer.disconnect();
      setInView(null);
    };
  }, [root, target]);
  return inView;
}

function subscribeToVisibility(onChange: () => void) {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}

/** Whether this tab is the one in front. */
function useTabVisible(): boolean {
  return useSyncExternalStore(
    subscribeToVisibility,
    () => document.visibilityState === 'visible',
    () => false,
  );
}

/** `active`, but only once it has lasted `ms`. */
function useDelayed(active: boolean, ms: number): boolean {
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setWaited(true), ms);
    return () => {
      clearTimeout(timer);
      setWaited(false);
    };
  }, [active, ms]);
  return active && waited;
}
