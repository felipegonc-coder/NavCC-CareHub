import type { Course, Question, QuizLesson } from '../format/index';
import { checkPublishable, presetFor } from '../format/index';

/** A publish problem inside one question; `path` is relative to it (`options[1].text`, or '' for all of it). */
export type QuestionProblem = { path: string; message: string };

/** `survey` checks it as a survey question: single or multiple choice only, no right answers needed. */
export type QuestionProblemOptions = { survey?: boolean };

const LESSON_PATH = 'lessons[0].questions[0]';
const LABEL = 'Lesson 1 "Check": question 1 ';

const isLessonLink = (value: unknown) =>
  typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'lesson';

/**
 * What stops one question from being published, by the same rules as `checkPublishable`, as sentences such as
 * "Option 2 needs text.", for live checks in question editors and banks. Links to lessons are left to the
 * course's own check, because a question on its own can't tell whether the lesson exists. The question must
 * already pass the schema.
 */
export function questionProblems(
  question: Question,
  options: QuestionProblemOptions = {},
): QuestionProblem[] {
  const checked = JSON.parse(JSON.stringify(question), (key, value: unknown) =>
    key === 'link' && isLessonLink(value) ? undefined : value,
  ) as Question;
  const preset = presetFor('standard', { hasQuiz: true });
  const lesson: QuizLesson = {
    id: 'check',
    kind: 'quiz',
    title: 'Check',
    settings: { ...preset.quiz, mode: options.survey ? 'survey' : 'graded' },
    questions: [checked],
  };
  const course: Course = {
    formatVersion: 1,
    id: 'check',
    title: 'Check',
    type: 'standard',
    settings: preset.settings,
    lessons: [lesson],
  };
  return checkPublishable(course).flatMap(({ path, message }) =>
    path.startsWith(LESSON_PATH) && message.startsWith(LABEL)
      ? [
          {
            path: path.slice(LESSON_PATH.length).replace(/^\./, ''),
            message: message.charAt(LABEL.length).toUpperCase() + message.slice(LABEL.length + 1),
          },
        ]
      : [],
  );
}
