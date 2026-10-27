import { meResponseSchema, type MeResponse } from '@carehub/shared';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';

/** The me query: `MeResponse`, or `null` when signed out. */
export const meQueryKey = ['auth', 'me'] as const;

/** GET /api/auth/me, with `null` for signed out (401). */
export async function fetchMe(signal?: AbortSignal): Promise<MeResponse | null> {
  try {
    return await api.get('/api/auth/me', { schema: meResponseSchema, signal });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

/**
 * The me query. It stays until sign-in or sign-out clears the cache, or a change such as the
 * profile's calls `queryClient.invalidateQueries({ queryKey: meQueryKey })`.
 */
export function useMeQuery() {
  return useQuery({
    queryKey: meQueryKey,
    queryFn: ({ signal }) => fetchMe(signal),
    staleTime: Infinity,
  });
}

/**
 * `{ user, member, workspace }` of the person signed in. Inside the app shell it is always there
 * once sign-in is required (config.ts); until then it is undefined while loading or signed out.
 */
export function useMe(): MeResponse | undefined {
  return useMeQuery().data ?? undefined;
}
