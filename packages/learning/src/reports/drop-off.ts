import type { Id } from '../format/index';
import { isFinished } from '../delivery/internal';
import { percentOf, type EnrollmentRow } from './rows';

/** How many unfinished learners stopped at one lesson. */
export type DropOffLesson = { lessonId: Id; title: string; stopped: number; percent: number };

/**
 * Where unfinished learners (not completed or passed) stopped: for each lesson in course order, how
 * many have it as their last lesson, and what percent of the course's unfinished learners that is.
 * Learners who never opened a lesson count in no lesson. Rows for other courses are ignored.
 */
export function dropOff(
  course: { id: Id; lessons: readonly { id: Id; title: string }[] },
  rows: readonly EnrollmentRow[],
): DropOffLesson[] {
  const unfinished = rows.filter((row) => row.courseId === course.id && !isFinished(row.status));
  return course.lessons.map((lesson) => {
    const stopped = unfinished.filter((row) => row.lastLessonId === lesson.id).length;
    return {
      lessonId: lesson.id,
      title: lesson.title,
      stopped,
      percent: percentOf(stopped, unfinished.length),
    };
  });
}
