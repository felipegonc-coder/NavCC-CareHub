import type { Id, Question, QuestionResponse, QuizLesson } from '../format/index';
import { ownValue } from '../questions/helpers';
import { scoreQuestion, type QuestionResult } from '../questions/score';
import type { AttemptPlan } from './plan';

/** The scored outcome of one quiz attempt. */
export type AttemptResult = {
  attemptId: Id;
  /** One result per planned question, in plan order. */
  results: QuestionResult[];
  earned: number;
  max: number;
  /** Math.round(earned / max × 100); 0 when max is 0. */
  percent: number;
  /**
   * earned × 100 ≥ passMark × max, compared exactly (no rounding). Always false for a survey and
   * when there is nothing to score (max 0), so an emptied plan can't pass.
   */
  passed: boolean;
};

/**
 * Scores an attempt against its plan. Only `plan.questionIds` are scored (each once, in plan
 * order), looked up in the lesson's questions and then its bank-draw snapshots; other responses are
 * ignored and planned ids found nowhere are skipped. Missing responses score 0. A survey (`mode:
 * "survey"`) has no score: its results keep `answered` and `picked` but have 0 points, no
 * correctness and no feedback.
 */
export function scoreAttempt(
  quiz: QuizLesson,
  plan: AttemptPlan,
  responses: Readonly<Record<Id, QuestionResponse>>,
): AttemptResult {
  const byId = new Map<Id, Question>();
  const pools = [quiz.questions, ...(quiz.bankDraws ?? []).map((draw) => draw.questions ?? [])];
  for (const pool of pools)
    for (const question of pool) if (!byId.has(question.id)) byId.set(question.id, question);
  const survey = quiz.settings.mode === 'survey';
  const results: QuestionResult[] = [];
  for (const id of new Set(plan.questionIds)) {
    const question = byId.get(id);
    if (!question) continue;
    const result = scoreQuestion(question, ownValue(responses, id));
    results.push(
      survey
        ? { ...result, correct: false, earned: 0, max: 0, fraction: 0, feedback: null }
        : result,
    );
  }
  let earned = 0;
  let max = 0;
  for (const result of results) {
    earned += result.earned;
    max += result.max;
  }
  // earned × 100 / max rounds more exactly than earned / max × 100 (57 / 200 gives 29, not 28).
  const percent = max > 0 ? Math.round((earned * 100) / max) : 0;
  const passed = !survey && max > 0 && earned * 100 >= quiz.settings.passMark * max;
  return { attemptId: plan.attemptId, results, earned, max, percent, passed };
}
