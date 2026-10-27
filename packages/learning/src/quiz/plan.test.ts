import { describe, expect, it } from 'vitest';
import type { BankDraw, Question, QuizLesson, QuizSettings, RichText } from '../format/index';
import { isPlanFor, planAttempt, type AttemptPlan } from './index';

// Fictional content only.
const rt = (text: string): RichText => [{ runs: [{ text }] }];
const prompt = rt('Fictional prompt');

const SEEDS = Array.from({ length: 200 }, (_, i) => i * 7919 + 13);

function single(id: string, optionIds: string[] = ['a', 'b', 'c', 'd']): Question {
  return {
    id,
    type: 'single_choice',
    prompt,
    points: 1,
    options: optionIds.map((o, i) => ({ id: o, text: `Option ${o}`, correct: i === 0 })),
  };
}

function multiple(id: string, optionIds: string[] = ['a', 'b', 'c']): Question {
  return {
    id,
    type: 'multiple_choice',
    prompt,
    points: 1,
    options: optionIds.map((o, i) => ({ id: o, text: `Option ${o}`, correct: i !== 1 })),
  };
}

const pairs = (pairIds: string[]) =>
  pairIds.map((id) => ({ id, prompt: `Term ${id}`, match: `Meaning ${id}` }));

function matching(id: string, pairIds: string[]): Question {
  return { id, type: 'matching', prompt, points: 1, pairs: pairs(pairIds) };
}

function dragMatching(id: string, pairIds: string[]): Question {
  return { id, type: 'drag_matching', prompt, points: 1, pairs: pairs(pairIds) };
}

function ordering(id: string, itemIds: string[]): Question {
  return {
    id,
    type: 'ordering',
    prompt,
    points: 1,
    items: itemIds.map((item) => ({ id: item, text: `Step ${item}` })),
  };
}

const trueFalse: Question = { id: 'q-tf', type: 'true_false', prompt, points: 1, answer: true };

const fillBlank: Question = {
  id: 'q-fill',
  type: 'fill_blank',
  prompt,
  points: 1,
  parts: [
    { kind: 'text', text: 'Pinecrest Wireless support opens at ' },
    { kind: 'blank', id: 'opens', answers: ['8 am'] },
  ],
};

const hotspot: Question = {
  id: 'q-spot',
  type: 'hotspot',
  prompt,
  points: 1,
  image: {
    media: { kind: 'url', url: 'https://example.com/fictional-bill.png' },
    alt: 'A fictional phone bill',
  },
  spots: [
    {
      id: 'total',
      shape: 'rect',
      x: 60,
      y: 70,
      width: 30,
      height: 10,
      correct: true,
      label: 'Total due',
    },
  ],
};

const everyType: Question[] = [
  single('q-single'),
  multiple('q-multi'),
  trueFalse,
  matching('q-match', ['m1', 'm2', 'm3']),
  dragMatching('q-drag', ['d1', 'd2']),
  fillBlank,
  ordering('q-order', ['o1', 'o2', 'o3', 'o4']),
  hotspot,
];

const bankBilling = ['b1', 'b2', 'b3', 'b4'].map((id) => single(id));

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

const ids = (questions: readonly Question[]): string[] => questions.map((q) => q.id);
const sorted = (values: readonly string[] | undefined): string[] => [...(values ?? [])].sort();

describe('planAttempt', () => {
  it('gives the same plan for the same quiz, seed and attempt id', () => {
    const lesson = quiz(everyType, { shuffleQuestions: true, shuffleOptions: true, poolSize: 5 }, [
      { bankId: 'bank-billing', count: 2, questions: bankBilling },
    ]);
    for (const seed of SEEDS.slice(0, 20)) {
      expect(planAttempt(lesson, seed, 'att-1')).toEqual(planAttempt(lesson, seed, 'att-1'));
    }
    const plan = planAttempt(lesson, 42, 'att-1');
    expect(plan.seed).toBe(42);
    expect(plan.attemptId).toBe('att-1');
  });

  it('gives different plans for different seeds', () => {
    const lesson = quiz(everyType, { shuffleQuestions: true, shuffleOptions: true });
    const plans = new Set(
      SEEDS.slice(0, 20).map((seed) => {
        const plan = planAttempt(lesson, seed, 'att');
        return JSON.stringify([plan.questionIds, plan.optionOrder]);
      }),
    );
    expect(plans.size).toBeGreaterThan(15);
  });

  it('shows every question in the listed order when nothing is pooled or shuffled', () => {
    const plan = planAttempt(quiz(everyType), 7, 'att');
    expect(plan.questionIds).toEqual(ids(everyType));
    expect(Object.keys(plan.optionOrder)).toEqual(['q-match', 'q-drag', 'q-order']);
  });

  it("draws poolSize of the lesson's questions, kept in their listed order", () => {
    const own = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6'].map((id) => single(id));
    const lesson = quiz(own, { poolSize: 3 });
    const subsets = new Set<string>();
    for (const seed of SEEDS) {
      const { questionIds } = planAttempt(lesson, seed, 'att');
      expect(questionIds).toHaveLength(3);
      expect(questionIds).toEqual(ids(own).filter((id) => questionIds.includes(id)));
      subsets.add(questionIds.join());
    }
    // All 20 three-question subsets turn up over 200 seeds.
    expect(subsets.size).toBeGreaterThanOrEqual(18);
  });

  it('shows every question when poolSize is at least the number of questions', () => {
    const own = ['q1', 'q2', 'q3'].map((id) => single(id));
    for (const poolSize of [3, 4, 200]) {
      expect(planAttempt(quiz(own, { poolSize }), 11, 'att').questionIds).toEqual([
        'q1',
        'q2',
        'q3',
      ]);
    }
  });

  it('shuffles the question order with shuffleQuestions', () => {
    const lesson = quiz(everyType, { shuffleQuestions: true });
    const orders = new Set<string>();
    for (const seed of SEEDS) {
      const { questionIds } = planAttempt(lesson, seed, 'att');
      expect(sorted(questionIds)).toEqual(sorted(ids(everyType)));
      orders.add(questionIds.join());
    }
    expect(orders.size).toBeGreaterThan(150);
  });

  it("adds count questions from each bank snapshot after the lesson's own questions", () => {
    const lesson = quiz([single('q1'), single('q2')], {}, [
      { bankId: 'bank-billing', count: 2, questions: bankBilling },
      { bankId: 'bank-draft', count: 3 }, // a draft without a snapshot adds none
      { bankId: 'bank-small', count: 5, questions: [single('c1'), single('c2')] }, // more than the snapshot holds
    ]);
    const drawn = new Set<string>();
    for (const seed of SEEDS) {
      const { questionIds } = planAttempt(lesson, seed, 'att');
      expect(questionIds).toHaveLength(6);
      expect(questionIds.slice(0, 2)).toEqual(['q1', 'q2']);
      const fromBilling = questionIds.slice(2, 4);
      expect(fromBilling).toEqual(ids(bankBilling).filter((id) => fromBilling.includes(id)));
      expect(questionIds.slice(4)).toEqual(['c1', 'c2']);
      for (const id of fromBilling) drawn.add(id);
    }
    expect(sorted([...drawn])).toEqual(ids(bankBilling));
  });

  it("applies poolSize to the lesson's own questions only", () => {
    const lesson = quiz([single('q1'), single('q2'), single('q3')], { poolSize: 1 }, [
      { bankId: 'bank-billing', count: 2, questions: bankBilling },
    ]);
    for (const seed of SEEDS.slice(0, 50)) {
      const { questionIds } = planAttempt(lesson, seed, 'att');
      expect(questionIds).toHaveLength(3);
      expect(['q1', 'q2', 'q3']).toContain(questionIds[0]);
      expect(questionIds.slice(1).every((id) => ids(bankBilling).includes(id))).toBe(true);
    }
  });

  it('never plans a question id twice', () => {
    const lesson = quiz([single('q1'), single('shared')], { shuffleQuestions: true }, [
      {
        bankId: 'bank-a',
        count: 3,
        questions: [single('shared'), single('b1'), single('b1'), single('b2')],
      },
      { bankId: 'bank-b', count: 2, questions: [single('b2'), single('c1')] },
    ]);
    for (const seed of SEEDS.slice(0, 50)) {
      const { questionIds } = planAttempt(lesson, seed, 'att');
      expect(sorted(questionIds)).toEqual(['b1', 'b2', 'c1', 'q1', 'shared']);
    }
    const unshuffled = quiz(lesson.questions, {}, lesson.bankDraws);
    expect(planAttempt(unshuffled, 1, 'att').questionIds).toEqual([
      'q1',
      'shared',
      'b1',
      'b2',
      'c1',
    ]);
  });

  it('records choice orders only with shuffleOptions, and matching and ordering orders always', () => {
    expect(Object.keys(planAttempt(quiz(everyType), 3, 'att').optionOrder)).toEqual([
      'q-match',
      'q-drag',
      'q-order',
    ]);
    const lesson = quiz(everyType, { shuffleOptions: true });
    const singleOrders = new Set<string>();
    for (const seed of SEEDS.slice(0, 50)) {
      const { optionOrder } = planAttempt(lesson, seed, 'att');
      expect(Object.keys(optionOrder)).toEqual([
        'q-single',
        'q-multi',
        'q-match',
        'q-drag',
        'q-order',
      ]);
      expect(sorted(optionOrder['q-single'])).toEqual(['a', 'b', 'c', 'd']);
      expect(sorted(optionOrder['q-multi'])).toEqual(['a', 'b', 'c']);
      expect(sorted(optionOrder['q-match'])).toEqual(['m1', 'm2', 'm3']);
      expect(sorted(optionOrder['q-drag'])).toEqual(['d1', 'd2']);
      expect(sorted(optionOrder['q-order'])).toEqual(['o1', 'o2', 'o3', 'o4']);
      singleOrders.add((optionOrder['q-single'] ?? []).join());
    }
    expect(singleOrders.size).toBeGreaterThan(10);
  });

  it('shuffles ordering items and matching lists uniformly, the listed order included', () => {
    // A shuffle that avoided the listed order would give away the answer of a 2-item question.
    const lesson = quiz([
      ordering('q-order', ['o1', 'o2', 'o3']),
      matching('q-match', ['m1', 'm2', 'm3']),
      dragMatching('q-drag', ['d1', 'd2']),
    ]);
    const counts = new Map<string, number>();
    const count = (key: string) => counts.set(key, (counts.get(key) ?? 0) + 1);
    const seeds = Array.from({ length: 1200 }, (_, i) => i * 7919 + 13);
    for (const seed of seeds) {
      const { optionOrder } = planAttempt(lesson, seed, 'att');
      count(`order ${(optionOrder['q-order'] ?? []).join()}`);
      count(`match ${(optionOrder['q-match'] ?? []).join()}`);
      count(`drag ${(optionOrder['q-drag'] ?? []).join()}`);
    }
    // 6 orders of 3 items (200 each on average), 2 orders of 2 pairs (600 each on average).
    expect([...counts.keys()].filter((key) => key.startsWith('order '))).toHaveLength(6);
    expect([...counts.keys()].filter((key) => key.startsWith('match '))).toHaveLength(6);
    for (const [key, n] of counts) {
      const expected = key.startsWith('drag ') ? 600 : 200;
      expect(Math.abs(n - expected)).toBeLessThan(expected * 0.25);
    }
    expect(counts.get('order o1,o2,o3')).toBeGreaterThan(0);
    expect(counts.get('drag d1,d2')).toBeGreaterThan(0);
  });

  it('keeps lists of 0 or 1 items as they are', () => {
    const lesson = quiz([
      ordering('one', ['only']),
      ordering('none', []),
      matching('pair', ['p1']),
    ]);
    for (const seed of SEEDS.slice(0, 20)) {
      const { optionOrder } = planAttempt(lesson, seed, 'att');
      expect(optionOrder).toEqual({ one: ['only'], none: [], pair: ['p1'] });
    }
  });

  it('has no option order for true/false, fill-in and hotspot questions', () => {
    const { optionOrder } = planAttempt(
      quiz([trueFalse, fillBlank, hotspot], { shuffleOptions: true }),
      5,
      'att',
    );
    expect(optionOrder).toEqual({});
  });

  it('stores option orders as own properties, even for an id like __proto__ (which the format rejects)', () => {
    const { optionOrder } = planAttempt(quiz([ordering('__proto__', ['o1', 'o2'])]), 1, 'att');
    expect(Object.getPrototypeOf(optionOrder)).toBe(Object.prototype);
    expect(Object.keys(optionOrder)).toEqual(['__proto__']);
    expect(sorted(Object.getOwnPropertyDescriptor(optionOrder, '__proto__')?.value)).toEqual([
      'o1',
      'o2',
    ]);
  });

  it("doesn't change the quiz", () => {
    const lesson = quiz(everyType, { shuffleQuestions: true, shuffleOptions: true, poolSize: 4 }, [
      { bankId: 'bank-billing', count: 2, questions: bankBilling },
    ]);
    const before = JSON.stringify(lesson);
    planAttempt(lesson, 5, 'att');
    expect(JSON.stringify(lesson)).toBe(before);
  });
});

describe('isPlanFor', () => {
  const lesson = quiz(everyType, { shuffleQuestions: true, shuffleOptions: true }, [
    { bankId: 'bank-billing', count: 2, questions: bankBilling },
  ]);
  const clone = (plan: AttemptPlan): AttemptPlan => JSON.parse(JSON.stringify(plan)) as AttemptPlan;
  const notDrawn = (plan: AttemptPlan): string =>
    ids(bankBilling).find((id) => !plan.questionIds.includes(id)) ?? '';
  const drawnIndex = (plan: AttemptPlan): number =>
    plan.questionIds.findIndex((id) => ids(bankBilling).includes(id));

  it('accepts the plan planAttempt gives, also after a JSON round trip', () => {
    for (const seed of SEEDS.slice(0, 20)) {
      const plan = planAttempt(lesson, seed, `att-${seed}`);
      expect(isPlanFor(lesson, plan)).toBe(true);
      expect(isPlanFor(lesson, clone(plan))).toBe(true);
    }
  });

  const tampering: [string, (plan: AttemptPlan) => void][] = [
    ['questions in another order', (plan) => plan.questionIds.reverse()],
    ['a question dropped', (plan) => plan.questionIds.pop()],
    ['a question added', (plan) => plan.questionIds.push(notDrawn(plan))],
    [
      'a bank question swapped for another',
      (plan) => plan.questionIds.splice(drawnIndex(plan), 1, notDrawn(plan)),
    ],
    ['a question listed twice', (plan) => plan.questionIds.push(plan.questionIds[0] ?? '')],
    ['ordering items in another order', (plan) => plan.optionOrder['q-order']?.reverse()],
    ['a matching list in another order', (plan) => plan.optionOrder['q-match']?.reverse()],
    ['options in another order', (plan) => plan.optionOrder['q-single']?.reverse()],
    ['an option id added', (plan) => plan.optionOrder['q-multi']?.push('zz')],
    ['an option order removed', (plan) => delete plan.optionOrder['q-match']],
    ['an option order for a question that has none', (plan) => (plan.optionOrder['q-tf'] = [])],
    ['another seed', (plan) => (plan.seed += 1)],
  ];
  for (const [name, tamper] of tampering) {
    it(`rejects a plan with ${name}`, () => {
      for (const seed of SEEDS.slice(0, 10)) {
        const plan = clone(planAttempt(lesson, seed, 'att'));
        tamper(plan);
        expect(isPlanFor(lesson, plan)).toBe(false);
      }
    });
  }

  it('rejects a plan made for another version of the quiz', () => {
    const plan = planAttempt(lesson, 3, 'att');
    const edited = quiz([...everyType, single('q-new')], lesson.settings, lesson.bankDraws);
    expect(isPlanFor(edited, plan)).toBe(false);
  });
});
