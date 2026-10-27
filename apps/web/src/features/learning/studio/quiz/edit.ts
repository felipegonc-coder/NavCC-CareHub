import { presetFor } from '@carehub/learning';
import type { Course, Id, QuizLesson } from '@carehub/learning';

const HOST: Omit<Course, 'lessons'> = {
  formatVersion: 1,
  id: 'quiz-host',
  title: 'Quiz',
  type: 'standard',
  settings: presetFor('standard').settings,
};

/**
 * Applies one of the course-level authoring helpers (`updateQuizSettings`, `addQuestion` …) to a quiz lesson on
 * its own. With `course`, new ids stay unique across the whole course; without it, across the lesson.
 */
export function editQuiz(
  lesson: QuizLesson,
  course: Course | undefined,
  edit: (course: Course, lessonId: Id) => Course,
): QuizLesson {
  const others = (course?.lessons ?? []).filter((item) => item.id !== lesson.id);
  const host: Course = { ...(course ?? HOST), lessons: [...others, lesson] };
  const next = edit(host, lesson.id).lessons.find((item) => item.id === lesson.id);
  return next?.kind === 'quiz' ? next : lesson;
}
