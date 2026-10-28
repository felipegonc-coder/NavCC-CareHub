import type {
  SearchHistoryInput,
  SearchRecentResponse,
  SearchRequest,
  SearchResponse,
} from '@carehub/extras/search';
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { api } from '../../lib/api';

// The search API (docs/extras/search.md): results, the recent lists, and what the window reports.

const RECENT = ['search', 'recent'] as const;

/** The recent pages and searches, read again each time the window opens. */
export function useRecent() {
  return useQuery({
    queryKey: RECENT,
    queryFn: ({ signal }) => api.get<SearchRecentResponse>('/api/search/recent', { signal }),
    staleTime: 0,
    // Kept, so the recent pages still show when Care Hub can't be reached.
    gcTime: Infinity,
    refetchOnMount: 'always',
    retry: false,
  });
}

/** Results 20 at a time; the previous results stay while the next ones load. */
export function useResults(request: SearchRequest | null) {
  return useInfiniteQuery({
    queryKey: ['search', 'query', request],
    queryFn: ({ pageParam, signal }) =>
      api.post<SearchResponse>('/api/search/query', { ...request, cursor: pageParam }, { signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: SearchResponse) => last.nextCursor ?? undefined,
    enabled: request !== null,
    placeholderData: keepPreviousData,
    staleTime: 10_000,
    retry: false,
  });
}

function changeRecent(
  client: QueryClient,
  change: (old: SearchRecentResponse) => SearchRecentResponse,
) {
  client.setQueryData<SearchRecentResponse>(RECENT, (old) => old && change(old));
}

/** Recording searches and opened pages, and the recent searches' ✕ and Clear. */
export function useSearchActions() {
  const client = useQueryClient();
  const reload = () => client.invalidateQueries({ queryKey: RECENT });
  return {
    /** A search ended; nothing to show if it fails. */
    record: (body: SearchHistoryInput) => {
      api.post('/api/search/history', body).then(reload, () => {});
    },
    remove: (id: string) => {
      changeRecent(client, (old) => ({
        ...old,
        searches: old.searches.filter((s) => s.id !== id),
      }));
      api.delete(`/api/search/recent/${encodeURIComponent(id)}`).catch(reload);
    },
    clear: () => {
      changeRecent(client, (old) => ({ ...old, searches: [] }));
      api.delete('/api/search/recent').catch(reload);
    },
  };
}

// stand-in: core's page.viewed event replaces this report of the page that's open.
export function reportVisit(pageId: string) {
  api.post('/api/search/visits', { pageId }).catch(() => {});
}
