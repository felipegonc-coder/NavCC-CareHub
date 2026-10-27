import type { SearchRequest, SearchResponse } from '@carehub/extras/search';
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';

// The search API (docs/extras/search.md): results 20 at a time.

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
