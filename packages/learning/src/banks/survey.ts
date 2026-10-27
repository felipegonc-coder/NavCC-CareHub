import {
  plainText,
  type Id,
  type Question,
  type QuestionType,
  type QuizLesson,
} from '../format/index';

/** What a survey summary reads from one submission. Scored quiz attempts (`AttemptResult`) fit as they are. */
export type SurveySubmission = {
  results: readonly { questionId: Id; picked: readonly Id[]; answered?: boolean }[];
};

/** How many submissions picked one answer. `percent` is of those that answered the question (whole percent; null if none did). */
export type SurveyAnswerCount = {
  optionId: Id;
  text: string;
  count: number;
  percent: number | null;
};

/** One question's answers. Only single and multiple choice questions get `answers`; other types just count `answered`. */
export type SurveyQuestionSummary = {
  questionId: Id;
  type: QuestionType;
  /** The question as plain text. */
  prompt: string;
  /** Submissions that answered this question. With a question pool or bank draws, not everyone sees every question. */
  answered: number;
  /** Every option in question order, with how often it was picked. A multiple choice question's percents can add up to more than 100. */
  answers: SurveyAnswerCount[];
};

/** A survey lesson's results: answer counts per question, without names. */
export type SurveySummary = {
  lessonId: Id;
  submissions: number;
  questions: SurveyQuestionSummary[];
};

/** The survey parts of a quiz lesson: its own questions and the published snapshots of its bank draws. A `QuizLesson` fits. */
export type SurveyLesson = Pick<QuizLesson, 'id' | 'questions' | 'bankDraws'>;

/**
 * Counts how often each answer was picked in a survey lesson, per question: the lesson's own questions, then the
 * questions from its bank draws (each id once). A result counts as answered unless `answered` is false; without
 * that flag, when something was picked. Picks of unknown options, repeated picks and results for questions not in
 * the lesson are ignored, and only a submission's first result for a question counts.
 */
export function summarizeSurvey(
  lesson: SurveyLesson,
  submissions: readonly SurveySubmission[],
): SurveySummary {
  const byId = new Map<Id, Question>();
  for (const pool of [
    lesson.questions,
    ...(lesson.bankDraws ?? []).map((draw) => draw.questions ?? []),
  ]) {
    for (const question of pool) if (!byId.has(question.id)) byId.set(question.id, question);
  }
  const answered = new Map<Id, number>();
  const counts = new Map<Id, Map<Id, number>>();
  for (const submission of submissions) {
    const seen = new Set<Id>();
    for (const result of submission.results) {
      if (seen.has(result.questionId) || !byId.has(result.questionId)) continue;
      seen.add(result.questionId);
      if (!(result.answered ?? result.picked.length > 0)) continue;
      answered.set(result.questionId, (answered.get(result.questionId) ?? 0) + 1);
      const picks = counts.get(result.questionId) ?? new Map<Id, number>();
      for (const id of new Set(result.picked)) picks.set(id, (picks.get(id) ?? 0) + 1);
      counts.set(result.questionId, picks);
    }
  }
  const questions = [...byId.values()].map((question): SurveyQuestionSummary => {
    const total = answered.get(question.id) ?? 0;
    const picks = counts.get(question.id);
    const options =
      question.type === 'single_choice' || question.type === 'multiple_choice'
        ? question.options
        : [];
    const answers = options.map((option): SurveyAnswerCount => {
      const count = picks?.get(option.id) ?? 0;
      return {
        optionId: option.id,
        text: option.text,
        count,
        percent: total === 0 ? null : Math.round((count * 100) / total),
      };
    });
    return {
      questionId: question.id,
      type: question.type,
      prompt: plainText(question.prompt),
      answered: total,
      answers,
    };
  });
  return { lessonId: lesson.id, submissions: submissions.length, questions };
}
