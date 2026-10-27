import { describe, expect, it } from 'vitest';
import { presetFor, richText, type Question, type QuizLesson } from '../format/index';
import {
  BankListSchema,
  BankReplySchema,
  CreateBankRequestSchema,
  createQuestionBank,
  ImportQuestionsReplySchema,
  ImportQuestionsRequestSchema,
  parseQuestionCsv,
  QUESTION_CSV_MAX_CHARACTERS,
  SaveBankRequestSchema,
  summarizeSurvey,
  SurveySummarySchema,
} from './index';

// Fictional content only.
const question: Question = {
  id: 'refunds',
  type: 'single_choice',
  prompt: richText('Who approves refunds over $50?'),
  points: 1,
  options: [
    { id: 'lead', text: 'A team lead', correct: true },
    { id: 'agent', text: 'Any agent', correct: false },
  ],
};
const bank = {
  ...createQuestionBank({ title: 'Billing basics', id: 'billing' }),
  questions: [question],
};
const updatedAt = '2026-10-27T15:00:00.000Z';

describe('bank API schemas', () => {
  it('reads the bank list and one bank with its revision', () => {
    const summary = { id: 'billing', title: 'Billing basics', questionCount: 1, updatedAt };
    expect(BankListSchema.parse([summary])).toEqual([summary]);
    expect(BankListSchema.safeParse([{ ...summary, questionCount: -1 }]).success).toBe(false);
    expect(BankReplySchema.parse({ bank, revision: 3, updatedAt })).toEqual({
      bank,
      revision: 3,
      updatedAt,
    });
  });

  it('trims a new bank title and refuses a blank one', () => {
    expect(CreateBankRequestSchema.parse({ title: '  Billing basics ' })).toEqual({
      title: 'Billing basics',
    });
    const blank = CreateBankRequestSchema.safeParse({ title: '   ' });
    expect(blank.success || blank.error.issues[0]?.message).toBe('Give the bank a title.');
    expect(CreateBankRequestSchema.safeParse({ title: 'Billing', questions: [] }).success).toBe(
      false,
    );
  });

  it('checks a saved bank as a whole, including repeated question ids', () => {
    expect(SaveBankRequestSchema.parse({ bank, revision: 0 })).toEqual({ bank, revision: 0 });
    const twice = SaveBankRequestSchema.safeParse({
      bank: { ...bank, questions: [question, question] },
      revision: 0,
    });
    expect(twice.success || twice.error.issues.map((issue) => issue.path)).toEqual([
      ['bank', 'questions', 1, 'id'],
    ]);
    expect(SaveBankRequestSchema.safeParse({ bank, revision: 1.5 }).success).toBe(false);
  });

  it('limits an import to about 2 MB and reads its reply', () => {
    expect(ImportQuestionsRequestSchema.safeParse({ csv: 'Type,Question' }).success).toBe(true);
    const big = ImportQuestionsRequestSchema.safeParse({
      csv: 'x'.repeat(QUESTION_CSV_MAX_CHARACTERS + 1),
    });
    expect(big.success || big.error.issues[0]?.message).toBe(
      'This file is too big. Import at most about 2 MB at a time.',
    );
    const { errors } = parseQuestionCsv('Type,Question\nSingle choice,\n');
    expect(errors.length).toBeGreaterThan(0);
    expect(ImportQuestionsReplySchema.parse({ added: 0, errors })).toEqual({ added: 0, errors });
  });
});

describe('survey summary schema', () => {
  it('reads what summarizeSurvey returns', () => {
    const lesson: QuizLesson = {
      id: 'feedback',
      kind: 'quiz',
      title: 'Course feedback',
      settings: { ...presetFor('standard').quiz, mode: 'survey' },
      questions: [
        { ...question, options: question.options.map((o) => ({ ...o, correct: false })) },
      ],
    };
    const summary = summarizeSurvey(lesson, [
      { results: [{ questionId: 'refunds', picked: ['lead'] }] },
      { results: [{ questionId: 'refunds', picked: [], answered: false }] },
    ]);
    expect(SurveySummarySchema.parse(summary)).toEqual(summary);
    expect(SurveySummarySchema.safeParse({ ...summary, submissions: -2 }).success).toBe(false);
  });
});
