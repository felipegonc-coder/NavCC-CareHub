import { describe, expect, it } from 'vitest';
import { richText, type Question } from '../format/index';
import {
  BANK_LIMITS,
  addQuestionsToBank,
  createQuestionBank,
  parseQuestionBank,
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

const bank = (questions: Question[] = [trueFalse('q1'), trueFalse('q2', false)]): QuestionBank => ({
  formatVersion: 1,
  id: 'bank-returns',
  title: 'Returns desk basics',
  questions,
});

describe('parseQuestionBank', () => {
  it('accepts a valid bank and returns it unchanged', () => {
    const raw = JSON.parse(
      JSON.stringify({ ...bank(), description: 'Questions for the returns desk.' }),
    );
    expect(parseQuestionBank(raw)).toEqual({ ok: true, bank: raw });
  });

  it('reports a question id used twice, at that question', () => {
    const result = parseQuestionBank(bank([trueFalse('q1'), trueFalse('q1')]));
    expect(result).toEqual({
      ok: false,
      issues: [
        { path: 'questions[1].id', message: 'Question id "q1" is used twice in this bank.' },
      ],
    });
  });

  it('gives readable messages with format-style paths', () => {
    const result = parseQuestionBank({
      ...bank(),
      title: '   ',
      questions: [{ ...trueFalse('q1'), points: 0 }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toContainEqual({ path: 'title', message: 'Give the bank a title.' });
    expect(result.issues.map((issue) => issue.path)).toContain('questions[0].points');
  });

  it('reports a missing title as required', () => {
    const noTitle = { formatVersion: 1, id: 'bank-returns', questions: [] };
    expect(parseQuestionBank(noTitle)).toEqual({
      ok: false,
      issues: [{ path: 'title', message: 'Required.' }],
    });
  });

  it("explains banks from a newer version and things that aren't banks", () => {
    const newer = parseQuestionBank({ ...bank(), formatVersion: 2 });
    expect(newer.ok).toBe(false);
    if (!newer.ok) expect(newer.issues.map((issue) => issue.path)).toEqual(['formatVersion']);
    if (!newer.ok)
      expect(newer.issues[0]?.message).toMatch(/newer version of Care Hub \(format 2\)/);
    const other = parseQuestionBank({ ...bank(), formatVersion: '1' });
    if (!other.ok)
      expect(other.issues[0]?.message).toBe(
        "This isn't a Care Hub question bank (formatVersion 1).",
      );
    expect(other.ok).toBe(false);
  });

  it('never throws on junk input', () => {
    for (const raw of [null, undefined, 'bank', 42, [], { formatVersion: 1 }])
      expect(parseQuestionBank(raw).ok).toBe(false);
  });

  it('rejects unknown fields and more than 500 questions', () => {
    expect(parseQuestionBank({ ...bank(), owner: 'someone' }).ok).toBe(false);
    const many = Array.from({ length: BANK_LIMITS.questions + 1 }, (_, i) => trueFalse(`q${i}`));
    const result = parseQuestionBank(bank(many));
    expect(result).toEqual({
      ok: false,
      issues: [{ path: 'questions', message: 'A bank holds at most 500 questions.' }],
    });
  });
});

describe('createQuestionBank', () => {
  it('makes an empty bank that passes the schema', () => {
    const created = createQuestionBank({
      title: '  Billing questions ',
      description: ' For the billing team. ',
    });
    expect(created).toEqual({
      formatVersion: 1,
      id: created.id,
      title: 'Billing questions',
      description: 'For the billing team.',
      questions: [],
    });
    expect(created.id).toMatch(/^[A-Za-z0-9]{16}$/);
    expect(parseQuestionBank(created).ok).toBe(true);
  });

  it('uses a given id, names blank titles and cuts long ones', () => {
    expect(createQuestionBank({ title: ' ', id: 'bank-1', description: '  ' })).toEqual({
      formatVersion: 1,
      id: 'bank-1',
      title: 'Untitled bank',
      questions: [],
    });
    expect(createQuestionBank({ title: 'x'.repeat(300) }).title).toHaveLength(BANK_LIMITS.title);
  });
});

describe('addQuestionsToBank', () => {
  it('adds at the end and renames ids the bank already has', () => {
    const before = bank();
    const copy = JSON.parse(JSON.stringify(before));
    const { bank: after, added } = addQuestionsToBank(before, [
      trueFalse('q1'),
      trueFalse('q3'),
      trueFalse('q1'),
    ]);
    expect(added).toBe(3);
    expect(after.questions.map((question) => question.id)).toEqual([
      'q1',
      'q2',
      'q1-2',
      'q3',
      'q1-3',
    ]);
    expect(before).toEqual(copy);
    expect(parseQuestionBank(after).ok).toBe(true);
  });

  it('stops at 500 questions', () => {
    const full = bank(
      Array.from({ length: BANK_LIMITS.questions - 1 }, (_, i) => trueFalse(`q${i}`)),
    );
    const { bank: after, added } = addQuestionsToBank(full, [
      trueFalse('new-1'),
      trueFalse('new-2'),
    ]);
    expect(added).toBe(1);
    expect(after.questions).toHaveLength(BANK_LIMITS.questions);
    expect(after.questions.at(-1)?.id).toBe('new-1');
    expect(addQuestionsToBank(after, [trueFalse('new-3')]).added).toBe(0);
  });
});
