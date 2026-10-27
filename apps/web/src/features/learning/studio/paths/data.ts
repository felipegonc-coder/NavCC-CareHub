import {
  PathListResponseSchema,
  PathResponseSchema,
  type CreatePathRequest,
  type Id,
  type LearningPath,
} from '@carehub/learning';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiPath, LearningApiError, noContent } from '../../data';
import { retryOnce } from '../../player/data';
import type { RadioChoice } from '../choices';

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

/** The two ways through a path, as the builder offers them. */
export const ORDER_CHOICES: readonly RadioChoice<LearningPath['order']>[] = [
  {
    value: 'sequential',
    label: 'In order',
    description: 'Each course opens once the ones before it are done.',
  },
  { value: 'free', label: 'Any order', description: 'Learners take the courses in any order.' },
];

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

/**
 * A path as saved, loaded fresh each time the builder opens. The builder keeps its own copy from
 * then on, so the path isn't fetched again while it is open.
 */
export function useStudioPath(pathId: Id) {
  return useQuery({
    queryKey: pathKeys.path(pathId),
    queryFn: ({ signal }) =>
      api('GET', apiPath('studio', 'paths', pathId), PathResponseSchema, { signal }),
    retry: retryOnce,
    staleTime: Infinity,
    gcTime: 0,
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

/** Saves the whole path, then refreshes the list and the path's page for learners. */
export function useSavePath() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (path: LearningPath) =>
      api('PUT', apiPath('studio', 'paths', path.id), path, PathResponseSchema),
    onSuccess: (saved) => {
      queryClient.setQueryData(pathKeys.path(saved.id), saved);
      void queryClient.invalidateQueries({ queryKey: ['learning', 'paths', saved.id] });
      return queryClient.invalidateQueries({ queryKey: pathKeys.list });
    },
  });
}

/** Deletes a path (one that is already gone counts as deleted), then refreshes the list. */
export function useDeletePath() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (pathId: Id) => {
      try {
        await api('DELETE', apiPath('studio', 'paths', pathId), noContent);
      } catch (error) {
        if (!(error instanceof LearningApiError && error.status === 404)) throw error;
      }
    },
    onSuccess: (_, pathId) => {
      queryClient.removeQueries({ queryKey: ['learning', 'paths', pathId] });
      return queryClient.invalidateQueries({ queryKey: pathKeys.list });
    },
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

/** The path as it is saved: the title trimmed, and no description when it is blank. */
export function pathToSave(path: LearningPath): LearningPath {
  const { description, ...rest } = path;
  const text = description?.trim() ? description : undefined;
  return {
    ...rest,
    title: path.title.trim(),
    ...(text === undefined ? {} : { description: text }),
  };
}

/** True when two paths save the same (field by field, so key order doesn't matter). */
export function samePath(a: LearningPath, b: LearningPath): boolean {
  const [x, y] = [pathToSave(a), pathToSave(b)];
  return (
    x.title === y.title &&
    x.description === y.description &&
    x.order === y.order &&
    x.courseIds.join(' ') === y.courseIds.join(' ')
  );
}
