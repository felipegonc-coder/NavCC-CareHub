import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CourseSchema } from '@carehub/learning';
import type { Block, Course, CourseType, Id } from '@carehub/learning';
import { useStudioClient } from '../context';
import { StudioError } from './client';
import type { StudioDraft } from './client';

/** TanStack Query keys for Studio data; they start with the feature name (0007 section 5.2). */
export const studioKeys = {
  all: ['learning', 'studio'] as const,
  courseLists: ['learning', 'studio', 'courses'] as const,
  courses: (archived: boolean) =>
    ['learning', 'studio', 'courses', archived ? 'archived' : 'active'] as const,
  draft: (courseId: Id) => ['learning', 'studio', 'draft', courseId] as const,
  preview: (courseId: Id) => ['learning', 'studio', 'draft', courseId, 'preview'] as const,
  examples: ['learning', 'studio', 'examples'] as const,
  versions: (courseId: Id) => ['learning', 'studio', 'versions', courseId] as const,
  templates: ['learning', 'studio', 'templates'] as const,
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

/** The saved draft for the preview: its own query, so it never shows the copy an editor opened with. */
export function usePreviewDraft(courseId: Id) {
  const client = useStudioClient();
  return useQuery({
    queryKey: studioKeys.preview(courseId),
    queryFn: () => client.getCourse(courseId),
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

/**
 * Saves a course that Learning help drafted and the author accepted (0315): a new course of its type and title,
 * then the draft's content under the new course's id. A draft that isn't a valid course is refused before
 * anything is created.
 */
export function useCreateCourseFromDraft() {
  const client = useStudioClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (draft: Course): Promise<StudioDraft> => {
      if (!CourseSchema.safeParse(draft).success)
        throw new StudioError('invalid', "This draft can't be saved as it is.");
      const blank = await client.createCourse({ type: draft.type, title: draft.title });
      const course: Course = { ...draft, id: blank.course.id };
      const { revision } = await client.saveCourse(course.id, course, blank.revision);
      return { ...blank, course, revision };
    },
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

/** The saved block templates, for the add-block menu. */
export function useBlockTemplates() {
  const client = useStudioClient();
  return useQuery({
    queryKey: studioKeys.templates,
    queryFn: () => client.listBlockTemplates(),
  });
}

/** Saves blocks as a template (`{ name, blocks }`), then refreshes the list. */
export function useSaveBlockTemplate() {
  const client = useStudioClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; blocks: Block[] }) => client.saveBlockTemplate(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: studioKeys.templates }),
  });
}

/** Deletes a template, then refreshes the list. */
export function useDeleteBlockTemplate() {
  const client = useStudioClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (templateId: Id) => client.deleteBlockTemplate(templateId),
    onSettled: () => queryClient.invalidateQueries({ queryKey: studioKeys.templates }),
  });
}
