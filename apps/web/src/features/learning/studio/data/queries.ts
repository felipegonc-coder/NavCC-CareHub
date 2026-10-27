import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CourseType, Id } from '@carehub/learning';
import { useStudioClient } from '../context';

/** TanStack Query keys for Studio data; they start with the feature name (0007 section 5.2). */
export const studioKeys = {
  all: ['learning', 'studio'] as const,
  courseLists: ['learning', 'studio', 'courses'] as const,
  courses: (archived: boolean) =>
    ['learning', 'studio', 'courses', archived ? 'archived' : 'active'] as const,
  draft: (courseId: Id) => ['learning', 'studio', 'draft', courseId] as const,
  examples: ['learning', 'studio', 'examples'] as const,
};

/** The Studio list: the courses in use, or the archived ones. */
export function useStudioCourses(archived = false) {
  const client = useStudioClient();
  return useQuery({
    queryKey: studioKeys.courses(archived),
    queryFn: () => client.listCourses({ archived }),
  });
}

/** Example courses to copy. */
export function useStudioExamples() {
  const client = useStudioClient();
  return useQuery({
    queryKey: studioKeys.examples,
    queryFn: () => client.listExamples(),
    staleTime: Infinity,
  });
}

/**
 * A draft and its revision, loaded fresh each time the editor opens. The editor keeps its own copy from then
 * on, so the draft isn't fetched again while it is open.
 */
export function useStudioDraft(courseId: Id) {
  const client = useStudioClient();
  return useQuery({
    queryKey: studioKeys.draft(courseId),
    queryFn: () => client.getCourse(courseId),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });
}

/** What New course sends: a course type, or an example to copy. */
export type NewCourseInput = { type: CourseType; title?: string; exampleId?: Id };

/** Starts a course from a type or an example. */
export function useCreateCourse() {
  const client = useStudioClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: NewCourseInput) => client.createCourse(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: studioKeys.courseLists }),
  });
}

/** What the course list can do to a course. */
export type CourseAction = 'duplicate' | 'archive' | 'unarchive';

/** Duplicates, archives or unarchives a course, then refreshes the lists. */
export function useCourseAction() {
  const client = useStudioClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ action, courseId }: { action: CourseAction; courseId: Id }) =>
      client[action](courseId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: studioKeys.courseLists }),
  });
}
