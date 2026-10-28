import type {
  SearchHistoryInput,
  SearchPeopleQuery,
  SearchPerson,
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
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

// The search API (docs/extras/search.md): results, the recent lists, and what the window reports.

const RECENT = ['search', 'recent'] as const;

/** The value once it has stopped changing for `ms`: searches start when typing pauses. */
export function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

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

/** Pages and databases by title, for the In chip; pickers search titles only (spec 3.1). */
export function usePagePicks(text: string, enabled: boolean) {
  const typed = useDebounced(text.trim(), 80);
  const request: SearchRequest = {
    text: typed,
    filters: { titleOnly: true, types: ['page', 'database'] },
    limit: 8,
  };
  return useQuery({
    queryKey: ['search', 'picks', typed],
    queryFn: ({ signal }) => api.post<SearchResponse>('/api/search/query', request, { signal }),
    enabled: enabled && typed !== '',
    placeholderData: keepPreviousData,
    staleTime: 10_000,
    retry: false,
  });
}

/** Who created or last edited pages the person can open, for the Created by and Edited by chips. */
export function usePeople(role: SearchPeopleQuery['role'], text: string, enabled: boolean) {
  const typed = useDebounced(text.trim(), 80);
  const query = new URLSearchParams({ role, q: typed });
  return useQuery({
    queryKey: ['search', 'people', role, typed],
    queryFn: ({ signal }) =>
      api.get<{ people: SearchPerson[] }>(`/api/search/people?${query}`, { signal }),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
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
