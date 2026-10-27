import type { Id, LearningPath } from '../format/index';

/** What the path checks need to know about each course. */
export type PathCourseCheck = { id: Id; title: string; live: boolean; archived: boolean };

/**
 * A reason a path can't be assigned yet, in plain words. `path` uses the format-issue notation,
 * e.g. `courseIds[2]`.
 */
export type PathProblem = { path: string; courseId?: Id; message: string };

/**
 * What keeps a path from being assigned: fewer than 2 courses, and courses that were deleted,
 * archived or never published (`courses` lists the ones that still exist). Learners only see the
 * published, unarchived courses of a path. No problems means the path is ready.
 */
export function pathProblems(
  path: Pick<LearningPath, 'courseIds'>,
  courses: readonly PathCourseCheck[],
): PathProblem[] {
  const byId = new Map(courses.map((course) => [course.id, course] as const));
  const problems: PathProblem[] = [];
  if (path.courseIds.length < 2) {
    problems.push({ path: 'courseIds', message: 'Add at least 2 courses to the path.' });
  }
  path.courseIds.forEach((courseId, index) => {
    const at = { path: `courseIds[${index}]`, courseId };
    const course = byId.get(courseId);
    if (!course) {
      problems.push({
        ...at,
        message: `Course ${index + 1} was deleted. Remove it from the path.`,
      });
    } else if (course.archived) {
      const message = `“${course.title}” is archived. Unarchive it or remove it from the path.`;
      problems.push({ ...at, message });
    } else if (!course.live) {
      const message = `“${course.title}” isn't published yet. Publish it or remove it from the path.`;
      problems.push({ ...at, message });
    }
  });
  return problems;
}
