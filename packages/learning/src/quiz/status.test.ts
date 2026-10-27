import { describe, expect, it } from 'vitest';
import type { QuizLesson, QuizSettings, RichText } from '../format/index';
import { quizStatus, type AttemptResult, type QuizStatus } from './index';

// Fictional content only.
const rt = (text: string): RichText => [{ runs: [{ text }] }];

function quiz(settings: Partial<QuizSettings> = {}): QuizLesson {
  return {
    id: 'quiz-billing',
    kind: 'quiz',
    title: 'Pinecrest Wireless billing check',
    settings: {
      passMark: 80,
      maxAttempts: 3,
      shuffleQuestions: false,
      shuffleOptions: false,
      revealAnswers: 'after_each_attempt',
      ...settings,
    },
    questions: [
      { id: 'q1', type: 'true_false', prompt: rt('Fictional prompt'), points: 1, answer: true },
    ],
  };
}

const status = (value: QuizStatus): QuizStatus => value;
const failed = (attemptId: string, percent = 40) => ({ attemptId, percent, passed: false });
const passing = (attemptId: string, percent = 90) => ({ attemptId, percent, passed: true });

describe('quizStatus', () => {
  it('allows the first attempt before any is submitted', () => {
    expect(quizStatus(quiz(), [])).toEqual(
      status({
        attemptsUsed: 0,
        attemptsRemaining: 3,
        bestPercent: null,
        passed: false,
        canRetry: true,
        revealAnswers: false,
      }),
    );
  });

  it('allows a retry after a failed attempt while attempts are left', () => {
    expect(quizStatus(quiz(), [failed('a1', 40), failed('a2', 75)])).toEqual(
      status({
        attemptsUsed: 2,
        attemptsRemaining: 1,
        bestPercent: 75,
        passed: false,
        canRetry: true,
        revealAnswers: true,
      }),
    );
  });

  it('stops retries once an attempt passed', () => {
    const status = quizStatus(quiz(), [failed('a1'), passing('a2', 85)]);
    expect(status).toMatchObject({
      attemptsUsed: 2,
      attemptsRemaining: 1,
      bestPercent: 85,
      passed: true,
      canRetry: false,
    });
  });

  it('stays passed and keeps the best percent when a later attempt does worse', () => {
    const status = quizStatus(quiz({ maxAttempts: null }), [passing('a1', 95), failed('a2', 20)]);
    expect(status).toMatchObject({ passed: true, bestPercent: 95, canRetry: false });
  });

  it('stops retries when attempts run out without a pass', () => {
    const status = quizStatus(quiz(), [failed('a1'), failed('a2'), failed('a3', 70)]);
    expect(status).toMatchObject({
      attemptsUsed: 3,
      attemptsRemaining: 0,
      bestPercent: 70,
      passed: false,
      canRetry: false,
    });
  });

  it('never reports fewer than 0 attempts left (e.g. after maxAttempts was lowered)', () => {
    const status = quizStatus(quiz({ maxAttempts: 1 }), [failed('a1'), failed('a2')]);
    expect(status).toMatchObject({ attemptsUsed: 2, attemptsRemaining: 0, canRetry: false });
  });

  it('has no attempt limit when maxAttempts is null', () => {
    const attempts = Array.from({ length: 12 }, (_, i) => failed(`a${i}`, i));
    expect(quizStatus(quiz({ maxAttempts: null }), attempts)).toMatchObject({
      attemptsUsed: 12,
      attemptsRemaining: null,
      bestPercent: 11,
      canRetry: true,
    });
  });

  it('counts an attempt id once, keeping its first result', () => {
    const status = quizStatus(quiz(), [failed('a1', 40), passing('a1', 100), failed('a2', 60)]);
    expect(status).toMatchObject({
      attemptsUsed: 2,
      attemptsRemaining: 1,
      bestPercent: 60,
      passed: false,
    });
  });

  it('accepts full attempt results', () => {
    const result: AttemptResult = {
      attemptId: 'a1',
      results: [],
      earned: 1,
      max: 1,
      percent: 100,
      passed: true,
    };
    expect(quizStatus(quiz(), [result])).toMatchObject({
      attemptsUsed: 1,
      passed: true,
      bestPercent: 100,
    });
  });

  // Situations: no attempt yet, failed with attempts left, passed, out of attempts without a pass.
  const situations = [
    [],
    [failed('a1')],
    [passing('a1')],
    [failed('a1'), failed('a2'), failed('a3')],
  ];
  const policies: [QuizSettings['revealAnswers'], boolean[]][] = [
    ['never', [false, false, false, false]],
    ['after_each_attempt', [false, true, true, true]],
    ['after_passing', [false, false, true, false]],
    ['after_final_attempt', [false, false, true, true]],
  ];
  for (const [revealAnswers, expected] of policies) {
    it(`reveals answers by the ${revealAnswers} policy`, () => {
      expect(
        situations.map((attempts) => quizStatus(quiz({ revealAnswers }), attempts).revealAnswers),
      ).toEqual(expected);
    });
  }

  it('never reveals answers after the final attempt of an unlimited quiz until it is passed', () => {
    const attempts = Array.from({ length: 5 }, (_, i) => failed(`a${i}`));
    expect(
      quizStatus(quiz({ maxAttempts: null, revealAnswers: 'after_final_attempt' }), attempts)
        .revealAnswers,
    ).toBe(false);
  });

  it('allows a survey one submission, with no score, pass or answers', () => {
    const survey = quiz({ mode: 'survey', maxAttempts: 5, revealAnswers: 'after_each_attempt' });
    expect(quizStatus(survey, [])).toEqual(
      status({
        attemptsUsed: 0,
        attemptsRemaining: 1,
        bestPercent: null,
        passed: false,
        canRetry: true,
        revealAnswers: false,
      }),
    );
    expect(quizStatus(survey, [passing('s1', 100)])).toEqual(
      status({
        attemptsUsed: 1,
        attemptsRemaining: 0,
        bestPercent: null,
        passed: false,
        canRetry: false,
        revealAnswers: false,
      }),
    );
  });
});
