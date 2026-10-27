import type { Id, LearningPath } from '../format/index';
import type { PathPage } from './api';
import { pathProgress, statusOf, type StatusByCourse } from './progress';

/** A course of the path that the learner can open, with what the path page shows of it. */
export type PathCourseInfo = {
  id: Id;
  title: string;
  summary?: string | undefined;
  estimatedMinutes?: number | undefined;
};

/**
 * A learner's path page (GET /paths/:id): the path with only the courses they can open (`courses`:
 * published, not archived and visible to them), in path order, each with its status and whether it
 * is locked, and their progress over those courses. Courses missing from `courses` are left out,
 * so the page never names a course the learner can't open.
 */
export function pathPage(
  path: LearningPath,
  courses: readonly PathCourseInfo[],
  statusByCourse: StatusByCourse,
): PathPage {
  const byId = new Map(courses.map((course) => [course.id, course] as const));
  const courseIds = [...new Set(path.courseIds)].filter((id) => byId.has(id));
  const progress = pathProgress({ courseIds, order: path.order }, statusByCourse);
  const locked = new Set(progress.lockedCourseIds);
  return {
    path: { ...path, courseIds },
    courses: courseIds.flatMap((id) => {
      const course = byId.get(id);
      if (!course) return [];
      const { title, summary, estimatedMinutes } = course;
      return [
        {
          id,
          title,
          ...(summary !== undefined && { summary }),
          ...(estimatedMinutes !== undefined && { estimatedMinutes }),
          status: statusOf(statusByCourse, id),
          locked: locked.has(id),
        },
      ];
    }),
    progress,
  };
}
