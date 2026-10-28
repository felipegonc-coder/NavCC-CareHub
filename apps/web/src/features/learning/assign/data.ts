import {
  AssignmentListSchema,
  IdSchema,
  PathListResponseSchema,
  type CreateAssignmentsRequest,
} from '@carehub/learning';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { ApiError, api as coreApi } from '../../../lib/api';
import { useCatalog } from '../catalog/data';
import { api, LearningApiError, noContent } from '../data';
import { myLearningKey } from '../home/data';
import { retryOnce } from '../player/data';
import { courseOptions } from './form';

// The Assign screen's data (docs/learning/api.md): assignments, what can be assigned, and to whom.
// People and groups come from core (decision 0007, 4.3); until core serves them, the lists are
// null.

export const assignKeys = {
  assignments: ['learning', 'assignments'] as const,
  studioCourses: ['learning', 'assign', 'courses'] as const,
  paths: ['learning', 'assign', 'paths'] as const,
  people: ['learning', 'assign', 'people'] as const,
  groups: ['learning', 'assign', 'groups'] as const,
};

/** GET /assignments: every assignment in the workspace (learning.assign), oldest first. */
export function useAssignments() {
  return useQuery({
    queryKey: assignKeys.assignments,
    queryFn: ({ signal }) => api('GET', '/assignments', AssignmentListSchema, { signal }),
    retry: retryOnce,
  });
}

/** null instead of an error the screen can do without: no access, or not on the server yet. */
async function orNull<T>(load: Promise<T>, statuses: readonly number[]): Promise<T | null> {
  try {
    return await load;
  } catch (error) {
    const status =
      error instanceof LearningApiError || error instanceof ApiError ? error.status : null;
    if (status !== null && statuses.includes(status)) return null;
    throw error;
  }
}

// What the Assign screen reads of the Studio's course list (GET /studio/courses).
const StudioCourseSchema = z.object({
  id: IdSchema,
  title: z.string(),
  state: z.enum(['draft', 'live', 'changed']),
  archived: z.boolean(),
  listed: z.boolean(),
});
const StudioCoursesReply = z.array(StudioCourseSchema);

export function useCourseOptions() {
  const catalog = useCatalog();
  const studio = useQuery({
    queryKey: assignKeys.studioCourses,
    queryFn: ({ signal }) =>
      orNull(api('GET', '/studio/courses', StudioCoursesReply, { signal }), [403]),
    retry: retryOnce,
  });
  const data =
    catalog.data && studio.data !== undefined
      ? courseOptions(catalog.data, studio.data)
      : undefined;
  return { data, error: catalog.error ?? studio.error, loading: !data && !catalog.error };
}

/** The learning paths to choose from (Studio, learning.build), with at least one course. */
export function usePathOptions() {
  return useQuery({
    queryKey: assignKeys.paths,
    queryFn: async ({ signal }) => {
      const paths = await orNull(
        api('GET', '/studio/paths', PathListResponseSchema, { signal }),
        [403, 404],
      );
      return (paths ?? [])
        .filter((path) => path.courseCount > 0)
        .sort((a, b) => a.title.localeCompare(b.title));
    },
    retry: retryOnce,
  });
}

const MemberSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().optional(),
  isGuest: z.boolean().optional(),
});
const MembersReply = z.array(MemberSchema);
export type Person = { id: string; name: string; email?: string | undefined; isGuest: boolean };

/** The workspace's members (core's GET /api/workspace/members), by name. */
export function usePeople() {
  return useQuery({
    queryKey: assignKeys.people,
    queryFn: async ({ signal }): Promise<Person[] | null> => {
      const members = await orNull(
        coreApi.get('/api/workspace/members', { schema: MembersReply, signal }),
        [404],
      );
      if (!members) return null;
      return members
        .map(({ id, name, email, isGuest }) => ({ id, name, email, isGuest: isGuest === true }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    retry: retryOnce,
  });
}

const GroupSchema = z.object({ id: z.string(), name: z.string(), memberIds: z.array(z.string()) });
export type Group = z.infer<typeof GroupSchema>;

/** The workspace's groups (core's GET /api/workspace/groups). */
export function useGroups() {
  return useQuery({
    queryKey: assignKeys.groups,
    queryFn: async ({ signal }) => {
      const groups = await orNull(
        coreApi.get('/api/workspace/groups', { schema: z.array(GroupSchema), signal }),
        [404],
      );
      return groups && [...groups].sort((a, b) => a.name.localeCompare(b.name));
    },
    retry: retryOnce,
  });
}

/** After a change: the list, and My learning in case people assigned themselves. */
function useRefresh() {
  const client = useQueryClient();
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: assignKeys.assignments }),
      client.invalidateQueries({ queryKey: myLearningKey }),
    ]);
}

/** POST /assignments. */
export function useCreateAssignments() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (request: CreateAssignmentsRequest) =>
      api('POST', '/assignments', request, AssignmentListSchema),
    onSuccess: () => refresh(),
  });
}

/** DELETE /assignments/:id. One gone already is fine; a path assignment goes as a whole. */
export function useRemoveAssignment() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (id: string) =>
      orNull(api('DELETE', `/assignments/${encodeURIComponent(id)}`, noContent), [404]),
    onSettled: () => refresh(),
  });
}
