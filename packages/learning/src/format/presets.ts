import type { ContentLesson, Course, CourseSettings, CourseType, QuizSettings } from './course';
import { newId } from './ids';
import { LIMITS } from './primitives';

export type CoursePreset = { settings: CourseSettings; quiz: QuizSettings };

/** The acknowledgement statement new required-read courses start with. */
export const DEFAULT_ACKNOWLEDGEMENT = 'I have read and understood this course.';

const quiz = (
  passMark: number,
  revealAnswers: QuizSettings['revealAnswers'],
  more: Partial<QuizSettings> = {},
): QuizSettings => ({
  passMark,
  maxAttempts: null,
  shuffleQuestions: false,
  shuffleOptions: false,
  revealAnswers,
  ...more,
});

const settings = (
  lessonOrder: CourseSettings['lessonOrder'],
  requireQuizPass: boolean,
  more: Partial<CourseSettings> = {},
): CourseSettings => ({
  lessonOrder,
  completion: { requireAllLessons: true, requireQuizPass, requireAcknowledgement: false },
  catalog: { listed: true },
  certificate: { enabled: false },
  ...more,
});

/**
 * Default course and quiz settings for a course type (the preset table in course-format.md). Standard courses
 * only ask for a quiz pass when they have a quiz (`hasQuiz`). Returns new objects on every call.
 */
export function presetFor(type: CourseType, options: { hasQuiz?: boolean } = {}): CoursePreset {
  switch (type) {
    case 'standard':
      return {
        settings: settings('free', options.hasQuiz === true),
        quiz: quiz(80, 'after_each_attempt'),
      };
    case 'scenario_lab':
      return { settings: settings('free', false), quiz: quiz(70, 'after_each_attempt') };
    case 'required_read':
      return {
        settings: settings('sequential', true, {
          completion: {
            requireAllLessons: true,
            requireQuizPass: true,
            requireAcknowledgement: true,
          },
          acknowledgement: { statement: DEFAULT_ACKNOWLEDGEMENT },
        }),
        quiz: quiz(100, 'after_passing'),
      };
    case 'microlearning':
      return { settings: settings('free', false), quiz: quiz(80, 'after_each_attempt') };
    case 'certification':
      return {
        settings: settings('sequential', true, {
          certificate: { enabled: true, validForMonths: 12 },
        }),
        quiz: quiz(90, 'after_final_attempt', {
          maxAttempts: 3,
          shuffleQuestions: true,
          shuffleOptions: true,
        }),
      };
  }
}

/**
 * A new draft course with the preset settings for its type. Microlearning starts with one empty lesson
 * named after the course. A blank title becomes "Untitled course"; long titles are cut to the limit.
 */
export function createCourse(input: { type: CourseType; title: string; id?: string }): Course {
  const title = input.title.trim().slice(0, LIMITS.title) || 'Untitled course';
  const lessons: ContentLesson[] =
    input.type === 'microlearning' ? [{ id: newId(), kind: 'content', title, blocks: [] }] : [];
  return {
    formatVersion: 1,
    id: input.id ?? newId(),
    title,
    type: input.type,
    settings: presetFor(input.type).settings,
    lessons,
  };
}
