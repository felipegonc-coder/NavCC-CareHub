import { z } from 'zod';
import {
  ContentLessonSchema,
  CourseSchema,
  LIMITS,
  QuizLessonSchema,
  type Course,
  type QuizLesson,
} from '../format/index';
import { plannedQuestionCount } from './plan';

/**
 * A quiz lesson as learners get it (decision 0302): no questions and no bank draws, so no answers.
 * `questionCount` is how many questions each attempt shows; the questions come one attempt at a
 * time from the attempts route, as a `quizPaper`.
 */
export const LearnerQuizLessonSchema = QuizLessonSchema.pick({
  id: true,
  kind: true,
  title: true,
  intro: true,
  settings: true,
}).extend({
  questionCount: z
    .number()
    .int()
    .min(0)
    .max(LIMITS.questions + LIMITS.bankDraws * LIMITS.bankDrawCount),
});

/** A course as learners get it from `GET /courses/:id`: `learnerCourse` of the course. */
export const LearnerCourseSchema = CourseSchema.extend({
  lessons: z
    .array(z.discriminatedUnion('kind', [ContentLessonSchema, LearnerQuizLessonSchema]))
    .max(LIMITS.lessons),
});

export type LearnerQuizLesson = z.infer<typeof LearnerQuizLessonSchema>;
export type LearnerCourse = z.infer<typeof LearnerCourseSchema>;

/**
 * The learner view of a course (decision 0302): every quiz lesson keeps its id, title, intro and
 * settings plus a question count, and loses its questions and bank-draw copies. Survey lessons are
 * treated the same, since every quiz runs on the paper of an attempt. Content lessons stay as they
 * are: knowledge checks and scenarios are practice and keep their answers.
 */
export function learnerCourse(course: Course): LearnerCourse {
  return {
    ...course,
    lessons: course.lessons.map((lesson) =>
      lesson.kind === 'quiz' ? learnerQuizLesson(lesson) : lesson,
    ),
  };
}

function learnerQuizLesson(lesson: QuizLesson): LearnerQuizLesson {
  const { id, kind, title, intro, settings } = lesson;
  return {
    id,
    kind,
    title,
    ...(intro === undefined ? {} : { intro }),
    settings,
    questionCount: plannedQuestionCount(lesson),
  };
}
