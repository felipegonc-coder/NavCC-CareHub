import { describe, expect, it } from 'vitest';
import type {
  Image,
  Question,
  QuestionResponse,
  QuizLesson,
  QuizSettings,
  RichText,
} from '../format/index';
import {
  paperResponses,
  planAttempt,
  quizPaper,
  QuizPaperQuestionSchema,
  scoreAttempt,
  type AttemptPlan,
  type QuizPaperQuestion,
} from './index';

// Fictional content only.
const rt = (text: string): RichText => [{ runs: [{ text }] }];
const image: Image = {
  media: { kind: 'url', url: 'https://example.com/fictional-bill.png' },
  alt: 'A fictional phone bill',
};
const feedback = { correct: rt('Well done.'), incorrect: rt('Not quite.') };
const SEEDS = Array.from({ length: 60 }, (_, i) => i * 7919 + 13);

const single: Question = {
  id: 'q-single',
  type: 'single_choice',
  prompt: rt('Which Pinecrest Wireless plan has no contract?'),
  image,
  points: 2,
  feedback,
  options: [
    { id: 'flex', text: 'Flex', correct: true, feedback: rt('Flex has no contract.') },
    { id: 'saver', text: 'Saver', correct: false, feedback: rt('Saver runs 12 months.') },
    { id: 'family', text: 'Family', correct: false },
  ],
};
const multiple: Question = {
  id: 'q-multi',
  type: 'multiple_choice',
  prompt: rt('Which can a caller change on their own?'),
  points: 1,
  feedback,
  options: [
    { id: 'pin', text: 'Their PIN', correct: true },
    { id: 'owner', text: 'The account owner', correct: false },
    { id: 'email', text: 'Their email address', correct: true },
  ],
};
const trueFalse: Question = {
  id: 'q-tf',
  type: 'true_false',
  prompt: rt('Refunds take 5 working days.'),
  points: 1,
  answer: true,
  feedback,
  feedbackTrue: rt('Yes, 5 working days.'),
  feedbackFalse: rt('It is 5 working days.'),
};
const matching: Question = {
  id: 'q-match',
  type: 'matching',
  prompt: rt('Match each term to its meaning.'),
  points: 1,
  feedback,
  pairs: [
    { id: 'p-apr', prompt: 'APR', match: 'Yearly interest' },
    { id: 'p-dd', prompt: 'Direct debit', match: 'Automatic payment' },
    { id: 'p-credit', prompt: 'Credit', match: 'Money owed to the member' },
  ],
};
const drag: Question = {
  id: 'q-drag',
  type: 'drag_matching',
  prompt: rt('Drag each reply to its caller.'),
  points: 1,
  pairs: [
    { id: 'p-late', prompt: 'Late bill', match: 'Offer a payment plan' },
    { id: 'p-move', prompt: 'Moving house', match: 'Update the address' },
  ],
};
const fill: Question = {
  id: 'q-fill',
  type: 'fill_blank',
  prompt: rt('Fill in the opening time.'),
  points: 1,
  feedback,
  parts: [
    { kind: 'text', text: 'Support opens at ' },
    { kind: 'blank', id: 'opens', answers: ['8 am', '8:00'], caseSensitive: false },
    { kind: 'text', text: ' on weekdays.' },
  ],
};
// Item ids in the right order, as hand-written files often have them: the paper must not show them.
const ordering: Question = {
  id: 'q-order',
  type: 'ordering',
  prompt: rt('Put the call steps in order.'),
  points: 1,
  feedback,
  items: [
    { id: 'step-1', text: 'Greet the caller' },
    { id: 'step-2', text: 'Check their identity' },
    { id: 'step-3', text: 'Solve the problem' },
    { id: 'step-4', text: 'Close the call' },
  ],
};
const hotspot: Question = {
  id: 'q-spot',
  type: 'hotspot',
  prompt: rt('Click the total due.'),
  image,
  points: 1,
  feedback,
  spots: [
    {
      id: 'total',
      shape: 'rect',
      x: 60,
      y: 70,
      width: 30,
      height: 10,
      correct: true,
      label: 'Total',
    },
    {
      id: 'date',
      shape: 'ellipse',
      x: 10,
      y: 8,
      width: 20,
      height: 6,
      correct: false,
      label: 'Date',
    },
  ],
};
const everyType = [single, multiple, trueFalse, matching, drag, fill, ordering, hotspot];

function quiz(questions: Question[] = everyType, settings: Partial<QuizSettings> = {}): QuizLesson {
  return {
    id: 'quiz-billing',
    kind: 'quiz',
    title: 'Pinecrest Wireless billing check',
    settings: {
      passMark: 80,
      maxAttempts: 3,
      shuffleQuestions: true,
      shuffleOptions: true,
      revealAnswers: 'never',
      ...settings,
    },
    questions,
  };
}

const handPlan: AttemptPlan = {
  attemptId: 'att-1',
  seed: 1,
  questionIds: everyType.map((q) => q.id),
  optionOrder: {
    'q-single': ['saver', 'family', 'flex'],
    'q-match': ['p-credit', 'p-apr', 'p-dd'],
    'q-drag': ['p-move', 'p-late'],
    'q-order': ['step-3', 'step-1', 'step-4', 'step-2'],
  },
};

type PaperOf<T extends QuizPaperQuestion['type']> = Extract<QuizPaperQuestion, { type: T }>;
function find<T extends QuizPaperQuestion['type']>(
  paper: QuizPaperQuestion[],
  type: T,
): PaperOf<T> {
  const question = paper.find((q): q is PaperOf<T> => q.type === type);
  if (!question) throw new Error(`No ${type} question on the paper`);
  return question;
}

/** What a learner who knows every answer sends, using only the paper. */
function rightAnswers(paper: QuizPaperQuestion[]): Record<string, QuestionResponse> {
  const byText = (list: { id: string; text: string }[], text: string) =>
    list.find((entry) => entry.text === text)?.id ?? '';
  const pairsOf = (question: Question) =>
    question.type === 'matching' || question.type === 'drag_matching' ? question.pairs : [];
  const matchesFor = (
    paperQuestion: PaperOf<'matching'> | PaperOf<'drag_matching'>,
    question: Question,
  ) =>
    Object.fromEntries(
      pairsOf(question).map((pair) => [pair.id, byText(paperQuestion.matches, pair.match)]),
    );
  const order = find(paper, 'ordering');
  return {
    'q-single': { type: 'single_choice', optionId: 'flex' },
    'q-multi': { type: 'multiple_choice', optionIds: ['email', 'pin'] },
    'q-tf': { type: 'true_false', value: true },
    'q-match': { type: 'matching', matches: matchesFor(find(paper, 'matching'), matching) },
    'q-drag': { type: 'drag_matching', matches: matchesFor(find(paper, 'drag_matching'), drag) },
    'q-fill': { type: 'fill_blank', blanks: { opens: ' 8 AM ' } },
    'q-order': {
      type: 'ordering',
      order:
        ordering.type === 'ordering'
          ? ordering.items.map((item) => byText(order.items, item.text))
          : [],
    },
    'q-spot': { type: 'hotspot', pick: { kind: 'spot', spotId: 'total' } },
  };
}

describe('quizPaper', () => {
  it('writes each type without its answer', () => {
    const prompt = (q: Question) => q.prompt;
    expect(quizPaper(quiz(), handPlan)).toEqual([
      {
        id: 'q-single',
        type: 'single_choice',
        prompt: prompt(single),
        image,
        points: 2,
        options: [
          { id: 'saver', text: 'Saver' },
          { id: 'family', text: 'Family' },
          { id: 'flex', text: 'Flex' },
        ],
      },
      {
        id: 'q-multi',
        type: 'multiple_choice',
        prompt: prompt(multiple),
        points: 1,
        options: [
          { id: 'pin', text: 'Their PIN' },
          { id: 'owner', text: 'The account owner' },
          { id: 'email', text: 'Their email address' },
        ],
      },
      { id: 'q-tf', type: 'true_false', prompt: prompt(trueFalse), points: 1 },
      {
        id: 'q-match',
        type: 'matching',
        prompt: prompt(matching),
        points: 1,
        prompts: [
          { id: 'p-apr', text: 'APR' },
          { id: 'p-dd', text: 'Direct debit' },
          { id: 'p-credit', text: 'Credit' },
        ],
        matches: [
          { id: 'match-1', text: 'Money owed to the member' },
          { id: 'match-2', text: 'Yearly interest' },
          { id: 'match-3', text: 'Automatic payment' },
        ],
      },
      {
        id: 'q-drag',
        type: 'drag_matching',
        prompt: prompt(drag),
        points: 1,
        prompts: [
          { id: 'p-late', text: 'Late bill' },
          { id: 'p-move', text: 'Moving house' },
        ],
        matches: [
          { id: 'match-1', text: 'Update the address' },
          { id: 'match-2', text: 'Offer a payment plan' },
        ],
      },
      {
        id: 'q-fill',
        type: 'fill_blank',
        prompt: prompt(fill),
        points: 1,
        parts: [
          { kind: 'text', text: 'Support opens at ' },
          { kind: 'blank', id: 'opens' },
          { kind: 'text', text: ' on weekdays.' },
        ],
      },
      {
        id: 'q-order',
        type: 'ordering',
        prompt: prompt(ordering),
        points: 1,
        items: [
          { id: 'item-1', text: 'Solve the problem' },
          { id: 'item-2', text: 'Greet the caller' },
          { id: 'item-3', text: 'Close the call' },
          { id: 'item-4', text: 'Check their identity' },
        ],
      },
      {
        id: 'q-spot',
        type: 'hotspot',
        prompt: prompt(hotspot),
        image,
        points: 1,
        spots: [
          { id: 'total', shape: 'rect', x: 60, y: 70, width: 30, height: 10, label: 'Total' },
          { id: 'date', shape: 'ellipse', x: 10, y: 8, width: 20, height: 6, label: 'Date' },
        ],
      },
    ]);
  });

  it('leaves no answer, feedback or answer-revealing id anywhere on the paper', () => {
    for (const seed of SEEDS) {
      const paper = quizPaper(quiz(), planAttempt(quiz(), seed, 'att'));
      const json = JSON.stringify(paper);
      for (const secret of ['"correct"', 'feedback', '"answer"', '"answers"', 'caseSensitive'])
        expect(json).not.toContain(secret);
      for (const text of ['Well done.', 'Not quite.', 'Flex has no contract.', '8 am', '8:00'])
        expect(json).not.toContain(text);
      for (const id of ['p-apr', 'p-dd', 'p-credit', 'p-late', 'p-move'])
        expect(json.split(`"${id}"`)).toHaveLength(2); // once, as its prompt's id
      expect(json).not.toContain('step-');
    }
  });

  it('follows the plan: its question order, each question once, and its option orders', () => {
    for (const seed of SEEDS) {
      const plan = planAttempt(quiz(), seed, 'att');
      const paper = quizPaper(quiz(), plan);
      expect(paper.map((q) => q.id)).toEqual(plan.questionIds);
      expect(find(paper, 'single_choice').options.map((o) => o.id)).toEqual(
        plan.optionOrder['q-single'],
      );
      const matchTexts = (plan.optionOrder['q-match'] ?? []).map(
        (id) =>
          (matching.type === 'matching' ? matching.pairs : []).find((p) => p.id === id)?.match,
      );
      expect(find(paper, 'matching').matches.map((m) => m.text)).toEqual(matchTexts);
      const itemTexts = (plan.optionOrder['q-order'] ?? []).map(
        (id) => (ordering.type === 'ordering' ? ordering.items : []).find((i) => i.id === id)?.text,
      );
      expect(find(paper, 'ordering').items.map((i) => i.text)).toEqual(itemTexts);
    }
  });

  it('shows choice options in their listed order when the plan has no order for them', () => {
    const lesson = quiz(everyType, { shuffleOptions: false });
    const paper = quizPaper(lesson, planAttempt(lesson, 5, 'att'));
    expect(find(paper, 'single_choice').options.map((o) => o.id)).toEqual([
      'flex',
      'saver',
      'family',
    ]);
    expect(find(paper, 'multiple_choice').options.map((o) => o.id)).toEqual([
      'pin',
      'owner',
      'email',
    ]);
  });

  it('skips planned ids the quiz lacks, lists a repeated id once and mends a stale order', () => {
    const plan: AttemptPlan = {
      attemptId: 'att-1',
      seed: 1,
      questionIds: ['q-gone', 'q-single', 'q-single', 'q-order'],
      optionOrder: { 'q-single': ['ghost', 'family'], 'q-order': ['step-2', 'step-2'] },
    };
    const paper = quizPaper(quiz(), plan);
    expect(paper.map((q) => q.id)).toEqual(['q-single', 'q-order']);
    expect(find(paper, 'single_choice').options.map((o) => o.id)).toEqual([
      'family',
      'flex',
      'saver',
    ]);
    expect(find(paper, 'ordering').items.map((i) => i.text)).toEqual([
      'Check their identity',
      'Greet the caller',
      'Solve the problem',
      'Close the call',
    ]);
  });

  it('takes bank-draw questions from their published snapshot', () => {
    const banked: Question = { ...trueFalse, id: 'bank-tf' };
    const lesson = {
      ...quiz([single]),
      bankDraws: [{ bankId: 'bank-1', count: 1, questions: [banked] }],
    };
    const plan = planAttempt(lesson, 3, 'att');
    expect(
      quizPaper(lesson, plan)
        .map((q) => q.id)
        .sort(),
    ).toEqual(['bank-tf', 'q-single']);
  });

  it('gives papers that pass QuizPaperQuestionSchema unchanged', () => {
    for (const seed of SEEDS.slice(0, 20)) {
      for (const question of quizPaper(quiz(), planAttempt(quiz(), seed, 'att'))) {
        const parsed = QuizPaperQuestionSchema.safeParse(JSON.parse(JSON.stringify(question)));
        expect(parsed.success).toBe(true);
        expect(parsed.data).toEqual(question);
      }
    }
  });

  it("doesn't change the quiz or the plan", () => {
    const lesson = quiz();
    const plan = planAttempt(lesson, 9, 'att');
    const before = JSON.stringify([lesson, plan]);
    quizPaper(lesson, plan);
    paperResponses(lesson, plan, rightAnswers(quizPaper(lesson, plan)));
    expect(JSON.stringify([lesson, plan])).toBe(before);
  });
});

describe('QuizPaperQuestionSchema', () => {
  const paper = quizPaper(quiz(), handPlan);
  const at = (type: QuizPaperQuestion['type']) =>
    JSON.parse(JSON.stringify(find(paper, type))) as Record<string, unknown>;
  const refused: [string, Record<string, unknown>][] = [
    [
      'an option marked correct',
      { ...at('single_choice'), options: [{ id: 'a', text: 'A', correct: true }] },
    ],
    [
      'option feedback',
      { ...at('multiple_choice'), options: [{ id: 'a', text: 'A', feedback: rt('Yes') }] },
    ],
    ['question feedback', { ...at('single_choice'), feedback }],
    ['the true/false answer', { ...at('true_false'), answer: true }],
    ['true/false feedback', { ...at('true_false'), feedbackTrue: rt('Yes') }],
    ['the matching pairs', { ...at('matching'), pairs: [{ id: 'p', prompt: 'A', match: 'B' }] }],
    [
      'accepted blank answers',
      { ...at('fill_blank'), parts: [{ kind: 'blank', id: 'b', answers: ['x'] }] },
    ],
    [
      'a correct spot',
      {
        ...at('hotspot'),
        spots: [
          { id: 's', shape: 'rect', x: 1, y: 1, width: 1, height: 1, label: 'S', correct: true },
        ],
      },
    ],
    ['an unknown type', { ...at('true_false'), type: 'essay' }],
  ];
  for (const [name, value] of refused) {
    it(`refuses ${name}`, () => {
      expect(QuizPaperQuestionSchema.safeParse(value).success).toBe(false);
    });
  }

  it('fills in 1 point when points are missing, like the question schema', () => {
    const question = at('true_false');
    delete question['points'];
    expect(QuizPaperQuestionSchema.parse(question)).toMatchObject({ points: 1 });
  });
});

describe('paperResponses', () => {
  it("maps per-attempt match and item ids back to the quiz's own ids", () => {
    const responses: Record<string, QuestionResponse> = {
      'q-match': {
        type: 'matching',
        matches: { 'p-apr': 'match-2', 'p-dd': 'match-3', 'p-credit': 'match-1' },
      },
      'q-drag': { type: 'drag_matching', matches: { 'p-late': 'match-1' } },
      'q-order': { type: 'ordering', order: ['item-2', 'item-4', 'item-1', 'item-3'] },
    };
    expect(paperResponses(quiz(), handPlan, responses)).toEqual({
      'q-match': {
        type: 'matching',
        matches: { 'p-apr': 'p-apr', 'p-dd': 'p-dd', 'p-credit': 'p-credit' },
      },
      'q-drag': { type: 'drag_matching', matches: { 'p-late': 'p-move' } },
      'q-order': { type: 'ordering', order: ['step-1', 'step-2', 'step-3', 'step-4'] },
    });
  });

  it('scores full marks for right answers given on the paper, and not without the mapping', () => {
    for (const seed of SEEDS) {
      const lesson = quiz();
      const plan = planAttempt(lesson, seed, `att-${seed}`);
      const answers = rightAnswers(quizPaper(lesson, plan));
      const result = scoreAttempt(lesson, plan, paperResponses(lesson, plan, answers));
      expect(result).toMatchObject({ earned: 9, max: 9, percent: 100, passed: true });
      const unmapped = scoreAttempt(lesson, plan, answers).results;
      expect(
        unmapped
          .filter((r) => !r.correct)
          .map((r) => r.questionId)
          .sort(),
      ).toEqual(['q-drag', 'q-match', 'q-order']);
    }
  });

  it('drops unknown prompts and ids, which leaves those pairs and items unanswered', () => {
    const responses: Record<string, QuestionResponse> = {
      // p-dd is a pair id, not an id on the paper, so sending it gains nothing.
      'q-match': {
        type: 'matching',
        matches: { 'p-apr': 'match-9', ghost: 'match-1', 'p-dd': 'p-dd' },
      },
      'q-order': { type: 'ordering', order: ['item-9', 'item-1', 'item-1', 'step-1'] },
    };
    const mapped = paperResponses(quiz(), handPlan, responses);
    expect(mapped).toEqual({
      'q-match': { type: 'matching', matches: {} },
      'q-order': { type: 'ordering', order: ['step-3', 'step-3'] },
    });
    const results = scoreAttempt(quiz(), handPlan, mapped).results;
    expect(results.find((r) => r.questionId === 'q-match')).toMatchObject({
      correct: false,
      earned: 0,
    });
  });

  it('keeps other answers, and answers of the wrong type, as they are', () => {
    const responses: Record<string, QuestionResponse> = {
      'q-single': { type: 'single_choice', optionId: 'saver' },
      'q-multi': { type: 'multiple_choice', optionIds: ['pin'] },
      'q-tf': { type: 'true_false', value: false },
      'q-match': { type: 'drag_matching', matches: { 'p-apr': 'match-2' } },
      'q-fill': { type: 'fill_blank', blanks: { opens: '9 am' } },
      'q-order': { type: 'single_choice', optionId: 'item-1' },
      'q-spot': { type: 'hotspot', pick: { kind: 'point', x: 70, y: 75 } },
    };
    const mapped = paperResponses(quiz(), handPlan, responses);
    expect(mapped).toEqual(responses);
    const results = scoreAttempt(quiz(), handPlan, mapped).results;
    expect(results.filter((r) => !r.answered).map((r) => r.questionId)).toEqual([
      'q-match',
      'q-drag',
      'q-order',
    ]);
  });

  it('keeps one answer per planned question, in plan order, as own properties', () => {
    const responses = JSON.parse(
      '{"q-other":{"type":"true_false","value":true},"q-tf":{"type":"true_false","value":true},"__proto__":{"type":"true_false","value":true}}',
    ) as Record<string, QuestionResponse>;
    const plan: AttemptPlan = { ...handPlan, questionIds: ['q-tf', 'q-single', 'q-tf'] };
    const mapped = paperResponses(quiz(), plan, responses);
    expect(Object.keys(mapped)).toEqual(['q-tf']);
    expect(Object.getPrototypeOf(mapped)).toBe(Object.prototype);
  });

  it('runs a survey on the paper the same way', () => {
    const lesson = quiz([single, multiple], { mode: 'survey' });
    const plan = planAttempt(lesson, 4, 'att');
    const paper = quizPaper(lesson, plan);
    expect(JSON.stringify(paper)).not.toContain('"correct"');
    const answers: Record<string, QuestionResponse> = {
      'q-single': { type: 'single_choice', optionId: 'family' },
      'q-multi': { type: 'multiple_choice', optionIds: ['owner'] },
    };
    const result = scoreAttempt(lesson, plan, paperResponses(lesson, plan, answers));
    expect(result.results.map((r) => [r.questionId, r.picked])).toEqual(
      plan.questionIds.map((id) => [id, id === 'q-single' ? ['family'] : ['owner']]),
    );
    expect(result).toMatchObject({ earned: 0, max: 0, passed: false });
  });
});
