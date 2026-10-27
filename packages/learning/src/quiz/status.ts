import type { QuizLesson } from '../format/index';
import type { AttemptResult } from './attempt';

/** Where a learner stands on a quiz after their submitted attempts. */
export type QuizStatus = {
  attemptsUsed: number;
  /** Attempts left; null when attempts are unlimited. */
  attemptsRemaining: number | null;
  /** Best attempt percent; null before the first attempt. */
  bestPercent: number | null;
  /** True when any attempt passed. */
  passed: boolean;
  /**
   * True when another attempt may be started (including the first): not passed and attempts left.
   */
  canRetry: boolean;
  /** Whether correct answers may be shown, by the quiz's `revealAnswers` policy. */
  revealAnswers: boolean;
};

/**
 * Summarizes submitted attempts (duplicates of an `attemptId` count once, the first kept). Answers
 * are revealed by policy: never; after_each_attempt once an attempt exists; after_passing once
 * passed; after_final_attempt once passed or out of attempts. A survey allows one submission and
 * never passes, scores or reveals answers (it counts as done once submitted, which progress
 * decides).
 */
export function quizStatus(
  quiz: QuizLesson,
  attempts: readonly Pick<AttemptResult, 'attemptId' | 'percent' | 'passed'>[],
): QuizStatus {
  const seen = new Set<string>();
  const counted: Pick<AttemptResult, 'percent' | 'passed'>[] = [];
  for (const attempt of attempts) {
    if (seen.has(attempt.attemptId)) continue;
    seen.add(attempt.attemptId);
    counted.push(attempt);
  }
  const { maxAttempts, revealAnswers } = quiz.settings;
  const attemptsUsed = counted.length;
  if (quiz.settings.mode === 'survey') {
    const left = Math.max(0, 1 - attemptsUsed);
    return {
      attemptsUsed,
      attemptsRemaining: left,
      bestPercent: null,
      passed: false,
      canRetry: left > 0,
      revealAnswers: false,
    };
  }
  const attemptsRemaining = maxAttempts === null ? null : Math.max(0, maxAttempts - attemptsUsed);
  const passed = counted.some((a) => a.passed);
  const outOfAttempts = attemptsRemaining === 0;
  const bestPercent = counted.reduce<number | null>(
    (best, a) => (best === null || a.percent > best ? a.percent : best),
    null,
  );
  return {
    attemptsUsed,
    attemptsRemaining,
    bestPercent,
    passed,
    canRetry: !passed && !outOfAttempts,
    revealAnswers: reveal(revealAnswers, attemptsUsed, passed, outOfAttempts),
  };
}

function reveal(
  policy: QuizLesson['settings']['revealAnswers'],
  attemptsUsed: number,
  passed: boolean,
  outOfAttempts: boolean,
): boolean {
  switch (policy) {
    case 'never':
      return false;
    case 'after_each_attempt':
      return attemptsUsed > 0;
    case 'after_passing':
      return passed;
    case 'after_final_attempt':
      return passed || outOfAttempts;
  }
}
