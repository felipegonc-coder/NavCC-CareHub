import {
  PathPageResponseSchema,
  type CourseStatus,
  type Id,
  type PathProgress,
} from '@carehub/learning';
import { useQuery } from '@tanstack/react-query';
import { api, apiPath } from '../data';
import { retryOnce } from '../player/data';

// GET /paths/:id (docs/learning/api.md): a learning path's page for the signed-in learner.

/** A learning path's page: "/learning/paths/<pathId>". */
export const pathHref = (pathId: Id): string => `/learning/paths/${encodeURIComponent(pathId)}`;

/** The path, the courses in it the learner can open (in path order) and their progress. */
export function usePathPage(pathId: Id) {
  return useQuery({
    queryKey: ['learning', 'paths', pathId],
    queryFn: ({ signal }) =>
      api('GET', apiPath('paths', pathId), PathPageResponseSchema, { signal }),
    retry: retryOnce,
  });
}

/** A course's status on the path page, in a word or two. */
export const COURSE_STATUS_LABELS: Record<CourseStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  completed: 'Completed',
  passed: 'Passed',
  failed: 'Not passed',
};

/** How far the learner is along the path: "2 of 5 courses done". */
export function progressLine({ completed, total }: Pick<PathProgress, 'completed' | 'total'>) {
  if (total === 0) return 'No courses to take yet.';
  if (completed === total) return "You've finished every course in this path.";
  return `${completed} of ${total} ${total === 1 ? 'course' : 'courses'} done`;
}

/** A course's length: "About 20 minutes". */
export const minutesText = (minutes: number): string =>
  minutes === 1 ? 'About 1 minute' : `About ${minutes} minutes`;
