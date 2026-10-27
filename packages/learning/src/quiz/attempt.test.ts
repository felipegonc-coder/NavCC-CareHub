import { describe, expect, it } from 'vitest';
import type {
  BankDraw,
  Question,
  QuestionResponse,
  QuizLesson,
  QuizSettings,
  RichText,
} from '../format/index';
import { scoreAttempt, type AttemptPlan } from './index';

// Fictional content only.
const rt = (text: string): RichText => [{ runs: [{ text }] }];
const prompt = rt('Fictional prompt');
const RIGHT = rt('Right: Pinecrest Wireless refunds go through billing.');
const WRONG = rt('Not quite: check the billing guide.');

const qa: Question = {
  id: 'qa',
  type: 'single_choice',
  prompt,
  points: 1,
  feedback: { correct: RIGHT, incorrect: WRONG },
  options: [
    { id: 'a', text: 'Transfer to sales', correct: false },
    { id: 'b', text: 'Open a billing case', correct: true },
  ],
};

const qb: Question = {
  id: 'qb',
  type: 'multiple_choice',
  prompt,
  points: 2,
  options: [
    { id: 'a', text: 'Account holder name', correct: true },
    { id: 'b', text: 'Account PIN', correct: true },
    { id: 'c', text: 'Favourite colour', correct: false },
  ],
};

const qc: Question = { id: 'qc', type: 'true_false', prompt, points: 3, answer: false };

const qd: Question = {
  id: 'qd',
  type: 'ordering',
  prompt,
  points: 2,
  items: [
    { id: 'o1', text: 'Greet the caller' },
    { id: 'o2', text: 'Verify the account' },
    { id: 'o3', text: 'Explain the charge' },
  ],
};

const right: Record<string, QuestionResponse> = {
  qa: { type: 'single_choice', optionId: 'b' },
  qb: { type: 'multiple_choice', optionIds: ['b', 'a'] },
  qc: { type: 'true_false', value: false },
  qd: { type: 'ordering', order: ['o1', 'o2', 'o3'] },
};

function quiz(
  questions: Question[],
  settings: Partial<QuizSettings> = {},
  bankDraws?: BankDraw[],
): QuizLesson {
  const lesson: QuizLesson = {
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
    questions,
  };
  return bankDraws === undefined ? lesson : { ...lesson, bankDraws };
}

const plan = (questionIds: string[]): AttemptPlan => ({
  attemptId: 'att-1',
  seed: 1,
  questionIds,
  optionOrder: {},
});

/**
 * A quiz of true/false questions worth `points`; the first `rightCount` are answered right, the
 * rest wrong.
 */
function scored(points: number[], rightCount: number, passMark = 80) {
  const questions: Question[] = points.map((p, i) => ({
    id: `t${i}`,
    type: 'true_false',
    prompt,
    points: p,
    answer: true,
  }));
  const responses: Record<string, QuestionResponse> = {};
  for (const [i, q] of questions.entries())
    responses[q.id] = { type: 'true_false', value: i < rightCount };
  return scoreAttempt(quiz(questions, { passMark }), plan(questions.map((q) => q.id)), responses);
}

describe('scoreAttempt', () => {
  const lesson = quiz([qa, qb, qc, qd]);

  it('scores the planned questions in plan order', () => {
    const result = scoreAttempt(lesson, plan(['qc', 'qa', 'qd']), right);
    expect(result.attemptId).toBe('att-1');
    expect(result.results.map((r) => r.questionId)).toEqual(['qc', 'qa', 'qd']);
    expect(result.results.map((r) => r.correct)).toEqual([true, true, true]);
    expect(result).toMatchObject({ earned: 6, max: 6, percent: 100, passed: true });
  });

  it("ignores responses to questions that weren't planned", () => {
    const result = scoreAttempt(lesson, plan(['qa']), right);
    expect(result.results.map((r) => r.questionId)).toEqual(['qa']);
    expect(result).toMatchObject({ earned: 1, max: 1, percent: 100, passed: true });
  });

  it('scores a missing response as an unanswered 0', () => {
    const result = scoreAttempt(lesson, plan(['qa', 'qc']), {
      qa: { type: 'single_choice', optionId: 'b' },
    });
    expect(result.results[1]).toMatchObject({
      questionId: 'qc',
      answered: false,
      correct: false,
      earned: 0,
      max: 3,
    });
    expect(result).toMatchObject({ earned: 1, max: 4, percent: 25, passed: false });
  });

  it("scores wrong answers as 0 with the question's feedback", () => {
    const result = scoreAttempt(lesson, plan(['qa', 'qb']), {
      qa: { type: 'single_choice', optionId: 'a' },
      qb: { type: 'multiple_choice', optionIds: ['a'] },
    });
    expect(result.results[0]).toMatchObject({
      answered: true,
      correct: false,
      earned: 0,
      max: 1,
      feedback: WRONG,
    });
    expect(result).toMatchObject({ earned: 0, max: 3, percent: 0, passed: false });
  });

  it("scores each planned id once and skips ids that aren't in the quiz", () => {
    const result = scoreAttempt(lesson, plan(['qa', 'ghost', 'qa', 'qc']), right);
    expect(result.results.map((r) => r.questionId)).toEqual(['qa', 'qc']);
    expect(result).toMatchObject({ earned: 4, max: 4 });
  });

  it("only counts the responses object's own properties", () => {
    const inherited = Object.create(right) as Record<string, QuestionResponse>;
    const result = scoreAttempt(lesson, plan(['qa']), inherited);
    expect(result.results[0]?.answered).toBe(false);
    expect(result.earned).toBe(0);
  });

  it("finds questions in bank snapshots; the lesson's own question wins when ids clash", () => {
    const bankQuestion: Question = {
      id: 'bq1',
      type: 'true_false',
      prompt,
      points: 5,
      answer: true,
    };
    const clash: Question = { id: 'qa', type: 'true_false', prompt, points: 50, answer: true };
    const withBank = quiz([qa], {}, [
      { bankId: 'bank-draft', count: 2 },
      { bankId: 'bank-billing', count: 1, questions: [clash, bankQuestion] },
    ]);
    const result = scoreAttempt(withBank, plan(['qa', 'bq1']), {
      qa: right['qa'] as QuestionResponse,
      bq1: { type: 'true_false', value: true },
    });
    expect(result.results.map((r) => [r.questionId, r.max])).toEqual([
      ['qa', 1],
      ['bq1', 5],
    ]);
    expect(result).toMatchObject({ earned: 6, max: 6, percent: 100, passed: true });
  });

  const rounding: [string, number[], number, number][] = [
    ['1 of 8 rounds 12.5 up to 13', [1, 1, 1, 1, 1, 1, 1, 1], 1, 13],
    ['57 of 200 gives 29 (57 / 200 × 100 would give 28)', [57, 100, 43], 1, 29],
    ['2 of 3 rounds to 67', [1, 1, 1], 2, 67],
    ['1 of 3 rounds to 33', [1, 1, 1], 1, 33],
    ['none right is 0', [2, 1], 0, 0],
    ['all right is 100', [100, 100, 100], 3, 100],
  ];
  for (const [name, points, rightCount, percent] of rounding) {
    it(`percent: ${name}`, () => {
      expect(scored(points, rightCount).percent).toBe(percent);
    });
  }

  const passMarks: [number, boolean][] = [
    [0, true],
    [50, true],
    [66.66, true],
    [66.67, false],
    [67, false],
    [100, false],
  ];
  for (const [passMark, passed] of passMarks) {
    it(`2 of 3 points ${passed ? 'passes' : 'fails'} a pass mark of ${passMark} (no rounding; percent shows 67)`, () => {
      const result = scored([1, 1, 1], 2, passMark);
      expect(result.percent).toBe(67);
      expect(result.passed).toBe(passed);
    });
  }

  it('passes a pass mark of 100 only with every point, and a pass mark of 0 with none', () => {
    expect(scored([1, 2, 3], 3, 100).passed).toBe(true);
    expect(scored([1, 2, 3], 0, 0).passed).toBe(true);
  });

  it('never passes an attempt with nothing to score', () => {
    for (const passMark of [0, 80]) {
      const result = scoreAttempt(quiz([qa], { passMark }), plan([]), right);
      expect(result).toEqual({
        attemptId: 'att-1',
        results: [],
        earned: 0,
        max: 0,
        percent: 0,
        passed: false,
      });
    }
  });

  it('gives a survey no score, correctness or feedback but keeps what was picked', () => {
    const survey = quiz([qa, qb], { mode: 'survey', passMark: 0 });
    const result = scoreAttempt(survey, plan(['qa', 'qb']), {
      qa: right['qa'] as QuestionResponse,
    });
    expect(result).toEqual({
      attemptId: 'att-1',
      results: [
        {
          questionId: 'qa',
          answered: true,
          correct: false,
          earned: 0,
          max: 0,
          fraction: 0,
          feedback: null,
          picked: ['b'],
        },
        {
          questionId: 'qb',
          answered: false,
          correct: false,
          earned: 0,
          max: 0,
          fraction: 0,
          feedback: null,
          picked: [],
        },
      ],
      earned: 0,
      max: 0,
      percent: 0,
      passed: false,
    });
  });

  it('scores a quiz without a mode as graded', () => {
    const graded = quiz([qa], { mode: 'graded' });
    expect(scoreAttempt(graded, plan(['qa']), right)).toEqual(
      scoreAttempt(quiz([qa]), plan(['qa']), right),
    );
  });
});
