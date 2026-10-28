import { checkPublishable } from '../format/publish';
import { presetFor } from '../format/presets';
import { QuestionSchema, type Question } from '../format/questions';
import type { Course, QuizLesson } from '../format/course';
import { newId as randomId } from '../format/ids';
import { richText } from '../format/rich-text';
import type { HelpQuestionDraft } from './api';

/** A fresh id for each new question and option. */
type IdGen = () => string;

function toQuestion(draft: HelpQuestionDraft, newId: IdGen): Question {
  const { prompt, explanation } = draft;
  const base = {
    id: newId(),
    prompt: richText(prompt),
    points: 1,
    ...(explanation
      ? { feedback: { correct: richText(explanation), incorrect: richText(explanation) } }
      : {}),
  };
  if (draft.type === 'true_false') return { ...base, type: draft.type, answer: draft.answer };
  const options = draft.options.map(({ text, correct }) => ({ id: newId(), text, correct }));
  return { ...base, type: draft.type, options };
}

/**
 * Claude's questions as course questions with fresh ids, keeping only those that pass the format and the
 * normal publish checks as questions of a graded quiz in this course (one correct answer for single choice,
 * at least one for multiple choice, and so on).
 */
export function helpQuestions(
  course: Course,
  drafts: readonly HelpQuestionDraft[],
  newId: IdGen = randomId,
): Question[] {
  const questions = drafts
    .map((draft) => toQuestion(draft, newId))
    .filter((question) => QuestionSchema.safeParse(question).success);
  const quiz: QuizLesson = {
    id: newId(),
    kind: 'quiz',
    title: 'Quiz',
    settings: { ...presetFor(course.type).quiz },
    questions,
  };
  const failed = new Set(
    checkPublishable({ ...course, lessons: [quiz] }).map((problem) => problem.questionId),
  );
  return questions.filter((question) => !failed.has(question.id));
}
