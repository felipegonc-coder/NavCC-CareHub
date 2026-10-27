import { describe, expect, it } from 'vitest';
import {
  createCourse,
  parseCourse,
  presetFor,
  richText,
  type BankDraw,
  type Course,
  type Lesson,
  type Question,
  type QuizLesson,
} from '../format/index';
import {
  bankIdsUsed,
  checkPublishableWithBanks,
  resolveBankDraws,
  stripBankSnapshots,
  type QuestionBank,
} from './index';

// Fictional content only.
const choice = (id: string, prompt = `Question ${id}`): Question => ({
  id,
  type: 'single_choice',
  prompt: richText(prompt),
  points: 1,
  options: [
    { id: 'yes', text: 'Yes', correct: true },
    { id: 'no', text: 'No', correct: false },
  ],
});
const trueFalse = (id: string): Question => ({
  id,
  type: 'true_false',
  prompt: richText(`Statement ${id}`),
  points: 1,
  answer: true,
});
const bank = (id: string, title: string, questions: Question[]): QuestionBank => ({
  formatVersion: 1,
  id,
  title,
  questions,
});

const basics = bank('bank-basics', 'Front desk basics', [
  choice('b1'),
  choice('b2'),
  choice('own-1'),
]);
const empty = bank('bank-empty', 'Empty bank', []);

function quiz(
  id: string,
  title: string,
  questions: Question[],
  bankDraws?: BankDraw[],
  mode?: 'survey',
): QuizLesson {
  const settings = { ...presetFor('standard').quiz, ...(mode ? { mode } : {}) };
  return { id, kind: 'quiz', title, settings, questions, ...(bankDraws ? { bankDraws } : {}) };
}
const course = (...lessons: Lesson[]): Course => ({
  ...createCourse({ type: 'standard', title: 'Front desk training', id: 'front-desk' }),
  lessons,
});
const welcome: Lesson = {
  id: 'welcome',
  kind: 'content',
  title: 'Welcome',
  blocks: [{ id: 'check', type: 'knowledge_check', question: choice('b2'), allowRetry: true }],
};
const snapshotIds = (resolved: Course, lessonIndex: number) => {
  const lesson = resolved.lessons[lessonIndex];
  return lesson?.kind === 'quiz'
    ? (lesson.bankDraws ?? []).map((draw) => draw.questions?.map((question) => question.id))
    : [];
};

describe('bankIdsUsed', () => {
  it('lists each drawn bank once, in course order', () => {
    const draft = course(
      quiz(
        'q1',
        'Check-in quiz',
        [],
        [
          { bankId: 'bank-basics', count: 1 },
          { bankId: 'bank-missing', count: 1 },
        ],
      ),
      welcome,
      quiz('q2', 'Refresher', [], [{ bankId: 'bank-basics', count: 2 }]),
    );
    expect(bankIdsUsed(draft)).toEqual(['bank-basics', 'bank-missing']);
    expect(bankIdsUsed(course(welcome))).toEqual([]);
  });
});

describe('resolveBankDraws', () => {
  const draft = course(
    welcome,
    quiz('q1', 'Check-in quiz', [choice('own-1')], [{ bankId: 'bank-basics', count: 2 }]),
    quiz('q2', 'Refresher', [], [{ bankId: 'bank-basics', count: 1 }]),
  );

  it("copies each bank's questions into its draw, keeping question ids unique across the course", () => {
    const before = JSON.parse(JSON.stringify(draft));
    const { course: resolved, issues } = resolveBankDraws(draft, [basics]);
    expect(issues).toEqual([]);
    expect(snapshotIds(resolved, 1)).toEqual([['b1', 'b2-2', 'own-1-2']]);
    expect(snapshotIds(resolved, 2)).toEqual([['b1-2', 'b2-3', 'own-1-3']]);
    const lesson = resolved.lessons[1];
    if (lesson?.kind !== 'quiz') throw new Error('expected a quiz');
    expect(lesson.bankDraws?.[0]).toEqual({
      bankId: 'bank-basics',
      count: 2,
      questions: [
        choice('b1'),
        { ...choice('b2'), id: 'b2-2' },
        { ...choice('own-1'), id: 'own-1-2' },
      ],
    });
    expect(resolved.lessons[0]).toBe(draft.lessons[0]);
    expect(draft).toEqual(before);
    expect(parseCourse(JSON.parse(JSON.stringify(resolved))).ok).toBe(true);
  });

  it('gives the same result every time', () => {
    expect(resolveBankDraws(draft, [basics])).toEqual(resolveBankDraws(draft, [basics]));
  });

  it('reports missing banks and banks with too few questions', () => {
    const draws = [
      { bankId: 'bank-basics', count: 5 },
      { bankId: 'bank-missing', count: 1 },
      { bankId: 'bank-empty', count: 1 },
    ];
    const { course: resolved, issues } = resolveBankDraws(
      course(quiz('q1', 'Check-in quiz', [], draws)),
      [basics, empty],
    );
    expect(issues).toEqual([
      {
        path: 'lessons[0].bankDraws[0].count',
        lessonId: 'q1',
        bankId: 'bank-basics',
        message:
          'Lesson 1 "Check-in quiz": draws 5 questions from the bank "Front desk basics", which has only 3.',
      },
      {
        path: 'lessons[0].bankDraws[1]',
        lessonId: 'q1',
        bankId: 'bank-missing',
        message:
          'Lesson 1 "Check-in quiz": draws from a question bank that no longer exists ("bank-missing"). Choose another bank or remove the draw.',
      },
      {
        path: 'lessons[0].bankDraws[2].count',
        lessonId: 'q1',
        bankId: 'bank-empty',
        message:
          'Lesson 1 "Check-in quiz": draws 1 question from the bank "Empty bank", which has no questions yet.',
      },
    ]);
    const lesson = resolved.lessons[0];
    expect(lesson?.kind === 'quiz' ? lesson.bankDraws?.[1] : null).toEqual({
      bankId: 'bank-missing',
      count: 1,
    });
  });

  it("replaces old snapshots with the bank's current questions", () => {
    const stale = course(
      quiz(
        'q1',
        'Check-in quiz',
        [],
        [{ bankId: 'bank-basics', count: 1, questions: [choice('old')] }],
      ),
    );
    expect(snapshotIds(resolveBankDraws(stale, [basics]).course, 0)).toEqual([
      ['b1', 'b2', 'own-1'],
    ]);
  });
});

describe('stripBankSnapshots', () => {
  it('keeps only the bank id and count of each draw', () => {
    const draft = course(
      welcome,
      quiz('q1', 'Check-in quiz', [], [{ bankId: 'bank-basics', count: 2 }]),
    );
    expect(stripBankSnapshots(resolveBankDraws(draft, [basics]).course)).toEqual(draft);
  });

  it('returns the same course when there are no snapshots', () => {
    const draft = course(welcome, quiz('q1', 'Check-in quiz', [choice('own-1')]));
    expect(stripBankSnapshots(draft)).toBe(draft);
  });
});

describe('checkPublishableWithBanks', () => {
  it('returns the course to publish and no problems when everything is fine', () => {
    const draft = course(
      welcome,
      quiz('q1', 'Check-in quiz', [choice('own-1')], [{ bankId: 'bank-basics', count: 2 }]),
    );
    const check = checkPublishableWithBanks(draft, [basics]);
    expect(check.problems).toEqual([]);
    expect(check.course).toEqual(resolveBankDraws(draft, [basics]).course);
  });

  it('puts bank problems in reading order, once each', () => {
    const draft = course(
      quiz(
        'q1',
        'Check-in quiz',
        [choice('own-1', '')],
        [
          { bankId: 'bank-missing', count: 1 },
          { bankId: 'bank-basics', count: 5 },
        ],
      ),
      quiz('q2', 'Refresher', []),
    );
    const { problems } = checkPublishableWithBanks(draft, [basics]);
    expect(problems.map((problem) => problem.path)).toEqual([
      'lessons[0].questions[0].prompt',
      'lessons[0].bankDraws[0]',
      'lessons[0].bankDraws[1].count',
      'lessons[1].questions',
    ]);
    expect(problems[2]?.message).toBe(
      'Lesson 1 "Check-in quiz": draws 5 questions from the bank "Front desk basics", which has only 3.',
    );
  });

  it('names banks by title in problems about drawn questions', () => {
    const drafts = bank('bank-drafts', 'Draft questions', [choice('d1', ' '), choice('d2')]);
    const draft = course(
      quiz(
        'q1',
        'Check-in quiz',
        [],
        [
          { bankId: 'bank-drafts', count: 1 },
          { bankId: 'bank-drafts', count: 1 },
        ],
      ),
    );
    const { problems } = checkPublishableWithBanks(draft, [drafts]);
    expect(problems.map((problem) => problem.path)).toEqual([
      'lessons[0].bankDraws[0].questions[0].prompt',
      'lessons[0].bankDraws[1].bankId',
      'lessons[0].bankDraws[1].questions[0].prompt',
    ]);
    expect(problems[0]?.message).toBe(
      'Lesson 1 "Check-in quiz": question 1 from bank "Draft questions" needs question text.',
    );
    expect(problems[1]?.message).toMatch(
      /^Lesson 1 "Check-in quiz" draws from bank "Draft questions" more than once/,
    );
  });

  it("flags drawn questions a survey can't use", () => {
    const mixed = bank('bank-mixed', 'Mixed bank', [choice('m1'), trueFalse('m2')]);
    const draft = course(
      quiz('q1', 'Feedback survey', [], [{ bankId: 'bank-mixed', count: 2 }], 'survey'),
    );
    const { problems } = checkPublishableWithBanks(draft, [mixed]);
    expect(problems.map((problem) => problem.path)).toEqual([
      'lessons[0].bankDraws[0].questions[1].type',
    ]);
    expect(problems[0]?.message).toMatch(
      /question 2 from bank "Mixed bank" is a true false question/,
    );
  });
});
