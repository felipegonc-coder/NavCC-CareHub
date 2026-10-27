import type { Id, QuestionResponse, QuizPaperQuestion, ResponseFor } from '@carehub/learning';

/** What every answer input gets. Knowledge checks and quizzes share the inputs. */
export type AnswerInputProps = {
  /** The question as the learner sees it: a quiz paper question, without its answers. */
  question: QuizPaperQuestion;
  /** The answer so far, in the paper's ids; undefined before the learner answers. */
  response: QuestionResponse | undefined;
  onChange(response: QuestionResponse): void;
  /** Locks the answer once it is checked or sent. */
  disabled?: boolean | undefined;
  /** The id of the element that names the question (its prompt). */
  labelledBy: string;
};

/** The props of the input for one question type. */
export type InputProps<T extends QuizPaperQuestion['type']> = Omit<AnswerInputProps, 'question'> & {
  question: Extract<QuizPaperQuestion, { type: T }>;
};

/** `response` when it answers a question of `type`, else undefined. */
export function answerFor<T extends QuizPaperQuestion['type']>(
  type: T,
  response: QuestionResponse | undefined,
): ResponseFor<T> | undefined {
  return response?.type === type ? (response as ResponseFor<T>) : undefined;
}

/** The answer as given. An ordering question's first answer is the order it is shown in. */
export function givenAnswer(
  question: QuizPaperQuestion,
  response: QuestionResponse | undefined,
): QuestionResponse | undefined {
  if (response || question.type !== 'ordering') return response;
  return { type: 'ordering', order: question.items.map((item) => item.id) };
}

/** True when the answer gives something: a choice, a match, a filled-in blank or a place. */
export function hasAnswer(
  question: QuizPaperQuestion,
  response: QuestionResponse | undefined,
): boolean {
  const given = givenAnswer(question, response);
  if (given?.type !== question.type) return false;
  switch (given.type) {
    case 'multiple_choice':
      return given.optionIds.length > 0;
    case 'matching':
    case 'drag_matching':
      return Object.keys(given.matches).length > 0;
    case 'fill_blank':
      return Object.values(given.blanks).some((text) => text.trim() !== '');
    default:
      return true;
  }
}

/** The record's own value for `key` (never one inherited from Object). */
export function own<T>(record: Readonly<Record<Id, T>>, key: Id): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

/** `record` with `key` set to `value`, or without `key` when `value` is undefined. */
export function withEntry<T>(
  record: Readonly<Record<Id, T>>,
  key: Id,
  value: T | undefined,
): Record<Id, T> {
  const kept = Object.entries(record).filter(([id]) => id !== key);
  return Object.fromEntries(value === undefined ? kept : [...kept, [key, value]]);
}
