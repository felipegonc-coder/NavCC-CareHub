import { describe, expect, it } from 'vitest';
import { richText, type Question } from '../format/index';
import {
  BANK_LIMITS,
  addBankQuestion,
  duplicateBankQuestion,
  moveBankQuestion,
  removeBankQuestion,
  setBankDetails,
  updateBankQuestion,
  type QuestionBank,
} from './index';

// Fictional content only.
const trueFalse = (id: string, answer = true): Question => ({
  id,
  type: 'true_false',
  prompt: richText(`Statement ${id}`),
  points: 1,
  answer,
});

const bank = (
  questions: Question[] = [trueFalse('q1'), trueFalse('q2'), trueFalse('q3')],
): QuestionBank => ({
  formatVersion: 1,
  id: 'bank-returns',
  title: 'Returns desk basics',
  description: 'Questions for the returns desk.',
  questions,
});

const ids = (value: QuestionBank) => value.questions.map((question) => question.id);

describe('setBankDetails', () => {
  it('sets the title and description as typed, cut to their limits', () => {
    const next = setBankDetails(bank(), {
      title: `  ${'T'.repeat(BANK_LIMITS.title + 5)}`,
      description: 'D'.repeat(BANK_LIMITS.description + 1),
    });
    expect(next.title).toHaveLength(BANK_LIMITS.title);
    expect(next.title.startsWith('  T')).toBe(true);
    expect(next.description).toHaveLength(BANK_LIMITS.description);
  });

  it('leaves out an emptied description and keeps what was not given', () => {
    const original = bank();
    const next = setBankDetails(original, { description: '' });
    expect('description' in next).toBe(false);
    expect(next.title).toBe('Returns desk basics');
    expect(original.description).toBe('Questions for the returns desk.');
  });
});

describe('addBankQuestion', () => {
  it('adds at the end without changing the bank passed in', () => {
    const original = bank();
    const next = addBankQuestion(original, trueFalse('q4'));
    expect(ids(next)).toEqual(['q1', 'q2', 'q3', 'q4']);
    expect(ids(original)).toEqual(['q1', 'q2', 'q3']);
  });

  it('refuses a taken id and a full bank', () => {
    const original = bank();
    expect(addBankQuestion(original, trueFalse('q2'))).toBe(original);
    const full = bank(
      Array.from({ length: BANK_LIMITS.questions }, (_, index) => trueFalse(`q${index + 1}`)),
    );
    expect(addBankQuestion(full, trueFalse('extra'))).toBe(full);
  });
});

describe('updateBankQuestion', () => {
  it('replaces the question and keeps its id', () => {
    const next = updateBankQuestion(bank(), 'q2', trueFalse('other', false));
    expect(ids(next)).toEqual(['q1', 'q2', 'q3']);
    expect(next.questions[1]).toEqual({ ...trueFalse('other', false), id: 'q2' });
  });

  it('returns the bank unchanged for an unknown id', () => {
    const original = bank();
    expect(updateBankQuestion(original, 'nope', trueFalse('nope'))).toBe(original);
  });
});

describe('duplicateBankQuestion', () => {
  it('puts a deep copy with a new id right after the original', () => {
    const original = bank();
    const next = duplicateBankQuestion(original, 'q1');
    expect(ids(next)).toEqual(['q1', 'q1-2', 'q2', 'q3']);
    expect(next.questions[1]).toEqual({ ...trueFalse('q1'), id: 'q1-2' });
    expect(next.questions[1]?.prompt).not.toBe(original.questions[0]?.prompt);
    expect(ids(duplicateBankQuestion(next, 'q1'))).toEqual(['q1', 'q1-3', 'q1-2', 'q2', 'q3']);
  });

  it('does nothing for an unknown id or a full bank', () => {
    const original = bank();
    expect(duplicateBankQuestion(original, 'nope')).toBe(original);
    const full = bank(
      Array.from({ length: BANK_LIMITS.questions }, (_, index) => trueFalse(`q${index + 1}`)),
    );
    expect(duplicateBankQuestion(full, 'q1')).toBe(full);
  });
});

describe('moveBankQuestion', () => {
  it('moves a question to a position, kept inside the list', () => {
    expect(ids(moveBankQuestion(bank(), 'q1', 2))).toEqual(['q2', 'q3', 'q1']);
    expect(ids(moveBankQuestion(bank(), 'q3', 0))).toEqual(['q3', 'q1', 'q2']);
    expect(ids(moveBankQuestion(bank(), 'q2', 99))).toEqual(['q1', 'q3', 'q2']);
    expect(ids(moveBankQuestion(bank(), 'q2', -4))).toEqual(['q2', 'q1', 'q3']);
  });

  it('returns the bank unchanged when nothing moves', () => {
    const original = bank();
    expect(moveBankQuestion(original, 'q2', 1)).toBe(original);
    expect(moveBankQuestion(original, 'nope', 0)).toBe(original);
  });
});

describe('removeBankQuestion', () => {
  it('removes the question, or returns the bank unchanged for an unknown id', () => {
    const original = bank();
    expect(ids(removeBankQuestion(original, 'q2'))).toEqual(['q1', 'q3']);
    expect(removeBankQuestion(original, 'nope')).toBe(original);
  });
});
