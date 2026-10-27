import {
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import { useLiveEvent } from '../live';
import {
  noticesApi,
  type NoticePage,
  type NoticesPreview,
  type NoticesSummary,
  type NoticeView,
} from './api';
import { withRead } from './chat';

/** What the server sends a person's open tabs whenever their chat changes. */
export const NOTICES_CHANGED = 'notices-changed';

export const noticesKeys = {
  all: ['notices'] as const,
  summary: ['notices', 'summary'] as const,
  lists: ['notices', 'list'] as const,
  list: (filter: string) => ['notices', 'list', filter] as const,
};

const refreshing = new WeakSet<QueryClient>();

/** Refetches the notices queries once, however many components heard the same nudge. */
function refreshNotices(queryClient: QueryClient): void {
  if (refreshing.has(queryClient)) return;
  refreshing.add(queryClient);
  queueMicrotask(() => {
    refreshing.delete(queryClient);
    void queryClient.invalidateQueries({ queryKey: noticesKeys.all });
  });
}

/** Keeps the notices queries current: refetches on `notices-changed` and after a reconnect. */
export function useNoticesLive(): void {
  const queryClient = useQueryClient();
  useLiveEvent(NOTICES_CHANGED, () => refreshNotices(queryClient));
}

function useNoticesSummary() {
  useNoticesLive();
  return useQuery({
    queryKey: noticesKeys.summary,
    queryFn: ({ signal }) => noticesApi.summary(signal),
  });
}

/** How many unread notices are in the person's 🔔 Care Hub chat: 0 until loaded, kept live. */
export function useNoticesUnread(): number {
  return useNoticesSummary().data?.unread ?? 0;
}

/**
 * The newest notice, for the 🔔 Care Hub row in Messages: undefined while loading or after an
 * error, null when there are no notices. Kept live, and shares one request with
 * useNoticesUnread.
 */
export function useNoticesPreview(): NoticesPreview | null | undefined {
  return useNoticesSummary().data?.latest;
}

/** Shows notices as read in every loaded list and the unread count, before the refetch. */
function showRead(
  queryClient: QueryClient,
  isRead: (notice: NoticeView) => boolean,
  unread: number,
) {
  queryClient.setQueryData<NoticesSummary>(noticesKeys.summary, (old) => old && { ...old, unread });
  queryClient.setQueriesData<InfiniteData<NoticePage>>(
    { queryKey: noticesKeys.lists },
    (old) => old && { ...old, pages: old.pages.map((page) => withRead(page, isRead)) },
  );
}

/** Marking notices read: up to a position, one notice, or all of them. */
export function useNoticeReads() {
  const queryClient = useQueryClient();
  const through = useMutation({
    mutationFn: (position: number) => noticesApi.readThrough(position),
    onSuccess: ({ unread }, position) =>
      showRead(queryClient, (notice) => notice.position <= position, unread),
  });
  const one = useMutation({
    mutationFn: (id: string) => noticesApi.readOne(id),
    onSuccess: ({ unread }, id) => showRead(queryClient, (notice) => notice.id === id, unread),
  });
  const all = useMutation({
    mutationFn: () => noticesApi.readAll(),
    onSuccess: ({ unread }) => showRead(queryClient, () => true, unread),
  });
  return { through, one, all };
}

/** Clicking one of a notice's action buttons. The server marks the notice read too. */
export function useNoticeAction(noticeId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ button, choice }: { button: number; choice?: number }) =>
      noticesApi.click(noticeId, button, choice),
    onSuccess: ({ unread }) => showRead(queryClient, (notice) => notice.id === noticeId, unread),
  });
}
