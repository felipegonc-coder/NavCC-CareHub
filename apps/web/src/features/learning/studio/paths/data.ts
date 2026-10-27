import {
  PathListResponseSchema,
  PathResponseSchema,
  type CreatePathRequest,
  type Id,
  type LearningPath,
} from '@carehub/learning';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, LearningApiError } from '../../data';
import { retryOnce } from '../../player/data';

// The Studio's path calls (docs/learning/api.md): GET and POST /studio/paths, and GET, PUT and
// DELETE /studio/paths/:id. Every one needs `learning.build`; the server checks it.

/** TanStack Query keys for the Studio's paths. The list's key isn't a prefix of a path's. */
export const pathKeys = {
  list: ['learning', 'studio', 'paths'] as const,
  path: (pathId: Id) => ['learning', 'studio', 'path', pathId] as const,
};

/** The Studio's list of learning paths. */
export const PATHS_STUDIO = '/learning/studio/paths';

/** The path builder's address. */
export const pathEditorPath = (pathId: Id): string =>
  `${PATHS_STUDIO}/${encodeURIComponent(pathId)}`;

/** "In order" or "Any order", for the path list. */
export const ORDER_LABELS: Record<LearningPath['order'], string> = {
  sequential: 'In order',
  free: 'Any order',
};

/** The workspace's paths, the most recently changed first. */
export function useStudioPaths() {
  return useQuery({
    queryKey: pathKeys.list,
    queryFn: ({ signal }) => api('GET', '/studio/paths', PathListResponseSchema, { signal }),
    retry: retryOnce,
  });
}

/** Starts a path (the server picks its id), then refreshes the list. */
export function useCreatePath() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePathRequest) =>
      api('POST', '/studio/paths', input, PathResponseSchema),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: pathKeys.list }),
  });
}

/** What went wrong with a path call, in plain words. */
export function pathErrorText(error: unknown): string {
  if (!(error instanceof LearningApiError)) return 'Something went wrong. Try again.';
  if (error.offline) return "You're offline. Check your connection and try again.";
  if (error.status === 404) return 'This path was deleted, or the link is wrong.';
  if (error.status === 403) return "You don't have access to learning paths. Ask an admin.";
  return error.message;
}
