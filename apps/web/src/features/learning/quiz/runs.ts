import {
  paperAnswerKey,
  paperResponses,
  planAttempt,
  quizPaper,
  quizStatus,
  scoreAttempt,
  type AttemptPlan,
  type AttemptResult,
  type Id,
  type LearnerCourseState,
  type LearnerQuizLesson,
  type ProgressRejectReason,
  type QuestionResponse,
  type QuizLesson,
  type QuizPaperQuestion,
  type QuizStatus,
} from '@carehub/learning';
import { useState } from 'react';
import { LearningApiError } from '../data';
import { useQuizAttempts } from './api';

export type Answers = Record<Id, QuestionResponse>;
/** An attempt's questions; `plan` only when the attempt was planned in the browser (a draft). */
export type Sheet = { attemptId: Id; questions: QuizPaperQuestion[]; plan?: AttemptPlan };
/**
 * A sent attempt's result and where the learner stands after it, with the right answers in the
 * paper's ids while the quiz shows them (decision 0316), else null.
 */
export type Outcome = { result: AttemptResult; status: QuizStatus; rightAnswers: Answers | null };

/** How a quiz view starts and sends attempts. Failures reject with an Error in plain words. */
export type QuizRun = {
  status: QuizStatus;
  /** An attempt was started and not sent; starting again brings its questions back. */
  open: boolean;
  start(): Promise<Sheet>;
  submit(sheet: Sheet, answers: Answers): Promise<Outcome>;
};

const START_OFFLINE = "Couldn't start the quiz. Check your connection and try again.";
const SEND_OFFLINE = "Couldn't send your answers. Check your connection and try again.";
const NOT_COUNTED = "Care Hub couldn't count these answers. Reload the page, then start again.";
const ENDED = 'This attempt has ended. Reload the page to see where you are.';
const CLOCK_AHEAD =
  "Care Hub couldn't count these answers because this device's clock is ahead. Set the right time, then send them again.";

/** Why the server refused the answers, in plain words. */
const refusal = (reason: ProgressRejectReason) =>
  reason === 'future'
    ? CLOCK_AHEAD
    : reason === 'unknown_attempt' || reason === 'restarted'
      ? ENDED
      : NOT_COUNTED;

/** The error to show: `offline` when the server couldn't be reached, else the server's words. */
const plain = (error: unknown, offline: string) =>
  new Error(
    error instanceof LearningApiError && !error.offline && error.message ? error.message : offline,
  );

/** Attempts on the server, for the learner view (it has no questions; decisions 0302 and 0314). */
export function useServerRun(
  courseId: Id,
  lesson: LearnerQuizLesson,
  state: LearnerCourseState,
): QuizRun {
  const server = useQuizAttempts(courseId);
  const progress = state.quizzes.find((quiz) => quiz.lessonId === lesson.id);
  return {
    status: progress ?? quizStatus({ ...lesson, questions: [] }, []),
    open: Boolean(progress?.openAttempt),
    start: async () => {
      const paper = await server.start(lesson.id).catch((error: unknown) => {
        throw plain(error, START_OFFLINE);
      });
      return { attemptId: paper.attemptId, questions: paper.questions };
    },
    submit: async (sheet, answers) => {
      const sent = await server.submit(lesson.id, sheet.attemptId, answers).catch((error) => {
        throw plain(error, SEND_OFFLINE);
      });
      if (sent.refused) throw new Error(refusal(sent.refused.reason));
      const quiz = sent.state.quizzes.find((entry) => entry.lessonId === lesson.id);
      const attempt = quiz?.attempts.find((entry) => entry.attemptId === sheet.attemptId);
      if (!quiz || !attempt) throw new Error(NOT_COUNTED);
      // The server keeps the right answers on the learner's own attempts while the quiz shows them.
      const rightAnswers = quiz.revealAnswers ? (attempt.answers ?? null) : null;
      return { result: attempt.result, status: quiz, rightAnswers };
    },
  };
}

/**
 * Attempts planned and scored in the browser, for the full draft (Studio preview and review
 * links, decision 0302). Nothing is recorded: the tries last while the view is open.
 */
export function useDraftRun(lesson: QuizLesson): QuizRun {
  const [results, setResults] = useState<AttemptResult[]>([]);
  return {
    status: quizStatus(lesson, results),
    open: false,
    start: async () => {
      const seed = Math.floor(Math.random() * 2 ** 31);
      const plan = planAttempt(lesson, seed, `preview-${results.length + 1}-${seed}`);
      return { attemptId: plan.attemptId, questions: quizPaper(lesson, plan), plan };
    },
    submit: async (sheet, answers) => {
      if (!sheet.plan) throw new Error(NOT_COUNTED);
      const result = scoreAttempt(lesson, sheet.plan, paperResponses(lesson, sheet.plan, answers));
      const all = [...results, result];
      setResults(all);
      const status = quizStatus(lesson, all);
      const rightAnswers = status.revealAnswers ? paperAnswerKey(lesson, sheet.plan) : null;
      return { result, status, rightAnswers };
    },
  };
}
