import { describe, expect, it } from 'vitest';
import type { Question, QuestionResponse, RichText } from '../format/index';
import { scoreQuestion, type QuestionResult } from './index';

// Fictional content only.
const rt = (text: string): RichText => [{ runs: [{ text }] }];
const blank: RichText = [{ runs: [{ text: '   ' }] }];
const prompt = rt('Fictional prompt');

const RIGHT = rt('Right: Pinecrest Wireless refunds go through billing.');
const WRONG = rt('Not quite: check the billing guide.');

const single: Question = {
  id: 'q-single',
  type: 'single_choice',
  prompt,
  points: 2,
  feedback: { correct: RIGHT, incorrect: WRONG },
  options: [
    {
      id: 'a',
      text: 'Transfer to sales',
      correct: false,
      feedback: rt("Sales can't issue refunds."),
    },
    { id: 'b', text: 'Open a billing case', correct: true },
    { id: 'c', text: 'Ask them to call back', correct: false },
    { id: 'd', text: 'Promise a credit', correct: false, feedback: blank },
    { id: 'e', text: 'Escalate to a lead', correct: false },
  ],
};

const singleOwnCorrectFeedback: Question = {
  id: 'q-single-2',
  type: 'single_choice',
  prompt,
  points: 1,
  feedback: { correct: RIGHT, incorrect: WRONG },
  options: [
    {
      id: 'yes',
      text: 'Verify the account',
      correct: true,
      feedback: rt('Yes: always verify first.'),
    },
    { id: 'no', text: 'Skip verification', correct: false },
  ],
};

const singleNoFeedback: Question = {
  id: 'q-single-3',
  type: 'single_choice',
  prompt,
  points: 1,
  options: [
    { id: 'x', text: 'X', correct: true },
    { id: 'y', text: 'Y', correct: false },
  ],
};

const multiple: Question = {
  id: 'q-multi',
  type: 'multiple_choice',
  prompt,
  points: 3,
  feedback: { correct: RIGHT, incorrect: WRONG },
  options: [
    {
      id: 'a',
      text: 'Name',
      correct: true,
      feedback: rt("Per-option feedback isn't used for multiple choice."),
    },
    { id: 'b', text: 'Account PIN', correct: true },
    { id: 'c', text: 'Favourite colour', correct: false },
    { id: 'd', text: 'Shoe size', correct: false },
  ],
};

const multipleNoneCorrect: Question = {
  id: 'q-multi-none',
  type: 'multiple_choice',
  prompt,
  points: 1,
  options: [
    { id: 'a', text: 'A', correct: false },
    { id: 'b', text: 'B', correct: false },
  ],
};

const trueFalse: Question = {
  id: 'q-tf',
  type: 'true_false',
  prompt,
  points: 1,
  answer: true,
  feedbackTrue: rt('True: holds expire after 30 days.'),
  feedback: { correct: RIGHT, incorrect: WRONG },
};

const trueFalseAnswerFalse: Question = {
  id: 'q-tf-2',
  type: 'true_false',
  prompt,
  points: 1,
  answer: false,
  feedbackFalse: rt('False is right.'),
  feedbackTrue: blank,
  feedback: { incorrect: WRONG },
};

const pairs = [
  { id: 'p1', prompt: 'Double charge', match: 'Billing' },
  { id: 'p2', prompt: 'No signal', match: 'Network support' },
  { id: 'p3', prompt: 'Lost phone', match: 'Device protection' },
];
const matching: Question = {
  id: 'q-match',
  type: 'matching',
  prompt,
  points: 4,
  pairs,
  feedback: { correct: RIGHT, incorrect: WRONG },
};
const dragMatching: Question = { id: 'q-drag', type: 'drag_matching', prompt, points: 4, pairs };

const fillBlank: Question = {
  id: 'q-fill',
  type: 'fill_blank',
  prompt,
  points: 2,
  feedback: { correct: RIGHT, incorrect: WRONG },
  parts: [
    { kind: 'text', text: 'Close the call with code ' },
    { kind: 'blank', id: 'b1', answers: ['WRAP-UP', 'wrap up'] },
    { kind: 'text', text: ' and note the ' },
    { kind: 'blank', id: 'b2', answers: ['Ticket'], caseSensitive: true },
  ],
};

const fillBlankEmptyAnswer: Question = {
  id: 'q-fill-2',
  type: 'fill_blank',
  prompt,
  points: 1,
  parts: [{ kind: 'blank', id: 'b1', answers: ['  ', ''] }],
};

const fillBlankProtoId: Question = {
  id: 'q-fill-3',
  type: 'fill_blank',
  prompt,
  points: 1,
  parts: [{ kind: 'blank', id: 'constructor', answers: ['hold'] }],
};

const ordering: Question = {
  id: 'q-order',
  type: 'ordering',
  prompt,
  points: 2,
  feedback: { correct: RIGHT, incorrect: WRONG },
  items: [
    { id: 'i1', text: 'Greet' },
    { id: 'i2', text: 'Verify' },
    { id: 'i3', text: 'Resolve' },
    { id: 'i4', text: 'Close' },
  ],
};

const hotspot: Question = {
  id: 'q-spot',
  type: 'hotspot',
  prompt,
  points: 1,
  feedback: { correct: RIGHT, incorrect: WRONG },
  image: { media: { kind: 'file', fileId: 'file-screen' }, alt: 'Fictional phone console' },
  spots: [
    {
      id: 'transfer',
      shape: 'rect',
      x: 10,
      y: 10,
      width: 20,
      height: 10,
      correct: true,
      label: 'Transfer button',
    },
    {
      id: 'hangup',
      shape: 'ellipse',
      x: 50,
      y: 50,
      width: 20,
      height: 10,
      correct: false,
      label: 'Hang-up button',
    },
    {
      id: 'hold',
      shape: 'ellipse',
      x: 70,
      y: 10,
      width: 10,
      height: 20,
      correct: true,
      label: 'Hold button',
    },
    {
      id: 'mute',
      shape: 'rect',
      x: 25,
      y: 15,
      width: 10,
      height: 10,
      correct: false,
      label: 'Mute button',
    },
  ],
};

type Case = {
  name: string;
  question: Question;
  response: QuestionResponse | undefined;
  expected: Partial<QuestionResult>;
};

const right = (
  question: Question,
  picked: string[],
  feedback: RichText | null = RIGHT,
): Partial<QuestionResult> => ({
  questionId: question.id,
  answered: true,
  correct: true,
  earned: question.points,
  max: question.points,
  fraction: 1,
  feedback,
  picked,
});

const wrong = (
  question: Question,
  fraction: number,
  picked: string[],
  feedback: RichText | null = WRONG,
): Partial<QuestionResult> => ({
  questionId: question.id,
  answered: true,
  correct: false,
  earned: 0,
  max: question.points,
  fraction,
  feedback,
  picked,
});

const sc = (optionId: string): QuestionResponse => ({ type: 'single_choice', optionId });
const mc = (...optionIds: string[]): QuestionResponse => ({ type: 'multiple_choice', optionIds });
const tf = (value: boolean): QuestionResponse => ({ type: 'true_false', value });
const match = (matches: Record<string, string>): QuestionResponse => ({
  type: 'matching',
  matches,
});
const drag = (matches: Record<string, string>): QuestionResponse => ({
  type: 'drag_matching',
  matches,
});
const fill = (blanks: Record<string, string>): QuestionResponse => ({ type: 'fill_blank', blanks });
const order = (...ids: string[]): QuestionResponse => ({ type: 'ordering', order: ids });
const point = (x: number, y: number): QuestionResponse => ({
  type: 'hotspot',
  pick: { kind: 'point', x, y },
});
const pickSpot = (spotId: string): QuestionResponse => ({
  type: 'hotspot',
  pick: { kind: 'spot', spotId },
});

const cases: Case[] = [
  // single choice
  {
    name: 'single: the correct option',
    question: single,
    response: sc('b'),
    expected: right(single, ['b']),
  },
  {
    name: "single: a wrong option's own feedback wins",
    question: single,
    response: sc('a'),
    expected: wrong(single, 0, ['a'], rt("Sales can't issue refunds.")),
  },
  {
    name: 'single: wrong option without feedback',
    question: single,
    response: sc('c'),
    expected: wrong(single, 0, ['c']),
  },
  {
    name: 'single: blank option feedback falls through',
    question: single,
    response: sc('d'),
    expected: wrong(single, 0, ['d']),
  },
  {
    name: 'single: unknown option id',
    question: single,
    response: sc('zz'),
    expected: wrong(single, 0, []),
  },
  {
    name: "single: a correct option's own feedback wins",
    question: singleOwnCorrectFeedback,
    response: sc('yes'),
    expected: right(singleOwnCorrectFeedback, ['yes'], rt('Yes: always verify first.')),
  },
  {
    name: 'single: no feedback anywhere',
    question: singleNoFeedback,
    response: sc('y'),
    expected: wrong(singleNoFeedback, 0, ['y'], null),
  },
  {
    name: 'single: correct, no feedback',
    question: singleNoFeedback,
    response: sc('x'),
    expected: right(singleNoFeedback, ['x'], null),
  },

  // multiple choice (a and b are correct)
  {
    name: 'multiple: exactly the correct set',
    question: multiple,
    response: mc('a', 'b'),
    expected: right(multiple, ['a', 'b']),
  },
  {
    name: "multiple: order doesn't matter",
    question: multiple,
    response: mc('b', 'a'),
    expected: right(multiple, ['a', 'b']),
  },
  {
    name: 'multiple: duplicates count once',
    question: multiple,
    response: mc('a', 'b', 'a'),
    expected: right(multiple, ['a', 'b']),
  },
  {
    name: 'multiple: one of two',
    question: multiple,
    response: mc('a'),
    expected: wrong(multiple, 0.5, ['a']),
  },
  {
    name: 'multiple: both plus a wrong one',
    question: multiple,
    response: mc('a', 'b', 'c'),
    expected: wrong(multiple, 0.5, ['a', 'b', 'c']),
  },
  {
    name: 'multiple: one right, one wrong',
    question: multiple,
    response: mc('c', 'a'),
    expected: wrong(multiple, 0, ['a', 'c']),
  },
  {
    name: 'multiple: only wrong ones (never below 0)',
    question: multiple,
    response: mc('c', 'd'),
    expected: wrong(multiple, 0, ['c', 'd']),
  },
  {
    name: 'multiple: everything',
    question: multiple,
    response: mc('a', 'b', 'c', 'd'),
    expected: wrong(multiple, 0, ['a', 'b', 'c', 'd']),
  },
  {
    name: 'multiple: nothing picked',
    question: multiple,
    response: mc(),
    expected: wrong(multiple, 0, []),
  },
  {
    name: 'multiple: unknown ids are wrong picks',
    question: multiple,
    response: mc('a', 'b', 'zz'),
    expected: wrong(multiple, 0.5, ['a', 'b']),
  },
  {
    name: 'multiple: no correct options, none picked',
    question: multipleNoneCorrect,
    response: mc(),
    expected: right(multipleNoneCorrect, [], null),
  },
  {
    name: 'multiple: no correct options, one picked',
    question: multipleNoneCorrect,
    response: mc('a'),
    expected: wrong(multipleNoneCorrect, 0, ['a'], null),
  },

  // true / false
  {
    name: 'true/false: true is right, feedbackTrue wins',
    question: trueFalse,
    response: tf(true),
    expected: right(trueFalse, ['true'], rt('True: holds expire after 30 days.')),
  },
  {
    name: 'true/false: false is wrong, no feedbackFalse',
    question: trueFalse,
    response: tf(false),
    expected: wrong(trueFalse, 0, ['false']),
  },
  {
    name: 'true/false: false is right, feedbackFalse wins',
    question: trueFalseAnswerFalse,
    response: tf(false),
    expected: right(trueFalseAnswerFalse, ['false'], rt('False is right.')),
  },
  {
    name: 'true/false: blank feedbackTrue falls through',
    question: trueFalseAnswerFalse,
    response: tf(true),
    expected: wrong(trueFalseAnswerFalse, 0, ['true']),
  },

  // matching
  {
    name: 'matching: every pair maps to itself',
    question: matching,
    response: match({ p1: 'p1', p2: 'p2', p3: 'p3' }),
    expected: right(matching, ['p1', 'p2', 'p3']),
  },
  {
    name: 'matching: two swapped',
    question: matching,
    response: match({ p1: 'p2', p2: 'p1', p3: 'p3' }),
    expected: wrong(matching, 1 / 3, ['p2', 'p1', 'p3']),
  },
  {
    name: 'matching: all wrong',
    question: matching,
    response: match({ p1: 'p2', p2: 'p3', p3: 'p1' }),
    expected: wrong(matching, 0, ['p2', 'p3', 'p1']),
  },
  {
    name: 'matching: one pair answered',
    question: matching,
    response: match({ p2: 'p2' }),
    expected: wrong(matching, 1 / 3, ['', 'p2', '']),
  },
  {
    name: 'matching: the same match twice',
    question: matching,
    response: match({ p1: 'p1', p2: 'p1', p3: 'p3' }),
    expected: wrong(matching, 2 / 3, ['p1', 'p1', 'p3']),
  },
  {
    name: 'matching: an unknown match id picks ""',
    question: matching,
    response: match({ p1: 'zz', p2: 'p2', p3: 'p3' }),
    expected: wrong(matching, 2 / 3, ['', 'p2', 'p3']),
  },
  {
    name: 'matching: extra keys are ignored',
    question: matching,
    response: match({ p1: 'p1', p2: 'p2', p3: 'p3', zz: 'p1' }),
    expected: right(matching, ['p1', 'p2', 'p3']),
  },
  {
    name: 'matching: nothing matched',
    question: matching,
    response: match({}),
    expected: wrong(matching, 0, ['', '', '']),
  },
  {
    name: 'drag matching: same scoring',
    question: dragMatching,
    response: drag({ p1: 'p1', p2: 'p2', p3: 'p3' }),
    expected: right(dragMatching, ['p1', 'p2', 'p3'], null),
  },
  {
    name: 'drag matching: partial',
    question: dragMatching,
    response: drag({ p1: 'p1', p2: 'p3', p3: 'p2' }),
    expected: wrong(dragMatching, 1 / 3, ['p1', 'p3', 'p2'], null),
  },
  {
    name: 'drag matching: one entry per pair, in pair order',
    question: dragMatching,
    response: drag({ p3: 'p1' }),
    expected: wrong(dragMatching, 0, ['', '', 'p1'], null),
  },

  // fill in the blank
  {
    name: 'fill: exact answers',
    question: fillBlank,
    response: fill({ b1: 'WRAP-UP', b2: 'Ticket' }),
    expected: right(fillBlank, []),
  },
  {
    name: 'fill: case-insensitive blank',
    question: fillBlank,
    response: fill({ b1: 'wrap-up', b2: 'Ticket' }),
    expected: right(fillBlank, []),
  },
  {
    name: 'fill: extra spaces and the second answer',
    question: fillBlank,
    response: fill({ b1: '  Wrap \t up ', b2: ' Ticket ' }),
    expected: right(fillBlank, []),
  },
  {
    name: 'fill: full-width letters',
    question: fillBlank,
    response: fill({ b1: 'ＷＲＡＰ－ＵＰ', b2: 'Ｔｉｃｋｅｔ' }),
    expected: right(fillBlank, []),
  },
  {
    name: 'fill: case-sensitive blank wrong case',
    question: fillBlank,
    response: fill({ b1: 'wrap up', b2: 'ticket' }),
    expected: wrong(fillBlank, 0.5, []),
  },
  {
    name: 'fill: one blank missing',
    question: fillBlank,
    response: fill({ b1: 'wrap up' }),
    expected: wrong(fillBlank, 0.5, []),
  },
  {
    name: 'fill: both wrong',
    question: fillBlank,
    response: fill({ b1: 'wrapup', b2: 'Case' }),
    expected: wrong(fillBlank, 0, []),
  },
  {
    name: 'fill: extra keys are ignored',
    question: fillBlank,
    response: fill({ b1: 'wrap up', b2: 'Ticket', b3: 'x' }),
    expected: right(fillBlank, []),
  },
  {
    name: 'fill: nothing filled',
    question: fillBlank,
    response: fill({}),
    expected: wrong(fillBlank, 0, []),
  },
  {
    name: 'fill: an empty answer never matches',
    question: fillBlankEmptyAnswer,
    response: fill({ b1: ' ' }),
    expected: wrong(fillBlankEmptyAnswer, 0, [], null),
  },
  {
    name: "fill: inherited keys aren't answers",
    question: fillBlankProtoId,
    response: fill({}),
    expected: wrong(fillBlankProtoId, 0, [], null),
  },
  {
    name: "fill: an own 'constructor' key is an answer",
    question: fillBlankProtoId,
    response: fill({ constructor: 'Hold' }),
    expected: right(fillBlankProtoId, [], null),
  },

  // ordering
  {
    name: 'ordering: the listed order',
    question: ordering,
    response: order('i1', 'i2', 'i3', 'i4'),
    expected: right(ordering, ['i1', 'i2', 'i3', 'i4']),
  },
  {
    name: 'ordering: first two swapped',
    question: ordering,
    response: order('i2', 'i1', 'i3', 'i4'),
    expected: wrong(ordering, 0.5, ['i2', 'i1', 'i3', 'i4']),
  },
  {
    name: 'ordering: reversed',
    question: ordering,
    response: order('i4', 'i3', 'i2', 'i1'),
    expected: wrong(ordering, 0, ['i4', 'i3', 'i2', 'i1']),
  },
  {
    name: 'ordering: rotated',
    question: ordering,
    response: order('i2', 'i3', 'i4', 'i1'),
    expected: wrong(ordering, 0, ['i2', 'i3', 'i4', 'i1']),
  },
  {
    name: 'ordering: one missing',
    question: ordering,
    response: order('i1', 'i2', 'i3'),
    expected: wrong(ordering, 0.75, ['i1', 'i2', 'i3']),
  },
  {
    name: 'ordering: one extra',
    question: ordering,
    response: order('i1', 'i2', 'i3', 'i4', 'i5'),
    expected: wrong(ordering, 1, ['i1', 'i2', 'i3', 'i4']),
  },
  {
    name: 'ordering: a duplicate',
    question: ordering,
    response: order('i1', 'i1', 'i3', 'i4'),
    expected: wrong(ordering, 0.75, ['i1', 'i3', 'i4']),
  },
  {
    name: 'ordering: empty',
    question: ordering,
    response: order(),
    expected: wrong(ordering, 0, []),
  },
  {
    name: "ordering: unknown ids aren't picked",
    question: ordering,
    response: order('i3', 'zz', 'i1'),
    expected: wrong(ordering, 0, ['i3', 'i1']),
  },

  // hotspot
  {
    name: 'hotspot: inside a correct rect',
    question: hotspot,
    response: point(15, 12),
    expected: right(hotspot, ['transfer']),
  },
  {
    name: "hotspot: on a correct rect's corner",
    question: hotspot,
    response: point(10, 10),
    expected: right(hotspot, ['transfer']),
  },
  {
    name: 'hotspot: inside a correct ellipse',
    question: hotspot,
    response: point(75, 20),
    expected: right(hotspot, ['hold']),
  },
  {
    name: "hotspot: on a correct ellipse's edge",
    question: hotspot,
    response: point(80, 20),
    expected: right(hotspot, ['hold']),
  },
  {
    name: "hotspot: an ellipse's bounding-box corner",
    question: hotspot,
    response: point(70.5, 10.5),
    expected: wrong(hotspot, 0, []),
  },
  {
    name: 'hotspot: inside a wrong spot',
    question: hotspot,
    response: point(60, 55),
    expected: wrong(hotspot, 0, ['hangup']),
  },
  {
    name: 'hotspot: overlap of a correct and a wrong spot',
    question: hotspot,
    response: point(27, 17),
    expected: right(hotspot, ['transfer']),
  },
  {
    name: 'hotspot: inside only the wrong overlapping spot',
    question: hotspot,
    response: point(33, 22),
    expected: wrong(hotspot, 0, ['mute']),
  },
  {
    name: 'hotspot: outside every spot',
    question: hotspot,
    response: point(95, 95),
    expected: wrong(hotspot, 0, []),
  },
  {
    name: 'hotspot: picked a correct spot',
    question: hotspot,
    response: pickSpot('hold'),
    expected: right(hotspot, ['hold']),
  },
  {
    name: 'hotspot: picked a wrong spot',
    question: hotspot,
    response: pickSpot('hangup'),
    expected: wrong(hotspot, 0, ['hangup']),
  },
  {
    name: 'hotspot: picked an unknown spot',
    question: hotspot,
    response: pickSpot('zz'),
    expected: wrong(hotspot, 0, []),
  },
];

const allQuestions = [
  single,
  multiple,
  trueFalse,
  matching,
  dragMatching,
  fillBlank,
  ordering,
  hotspot,
];

const responseOfType: Record<Question['type'], QuestionResponse> = {
  single_choice: sc('b'),
  multiple_choice: mc('a', 'b'),
  true_false: tf(true),
  matching: match({ p1: 'p1', p2: 'p2', p3: 'p3' }),
  drag_matching: drag({ p1: 'p1', p2: 'p2', p3: 'p3' }),
  fill_blank: fill({ b1: 'wrap up', b2: 'Ticket' }),
  ordering: order('i1', 'i2', 'i3', 'i4'),
  hotspot: point(15, 12),
};

const unanswered = (question: Question): QuestionResult => ({
  questionId: question.id,
  answered: false,
  correct: false,
  earned: 0,
  max: question.points,
  fraction: 0,
  feedback: null,
  picked: [],
});

describe('scoreQuestion', () => {
  for (const c of cases) {
    it(c.name, () => {
      const result = scoreQuestion(c.question, c.response);
      expect(result).toMatchObject(c.expected);
      expect(Object.keys(result).sort()).toEqual([
        'answered',
        'correct',
        'earned',
        'feedback',
        'fraction',
        'max',
        'picked',
        'questionId',
      ]);
    });
  }

  for (const question of allQuestions) {
    it(`${question.type}: a matching response of the right type is correct`, () => {
      expect(scoreQuestion(question, responseOfType[question.type])).toMatchObject({
        answered: true,
        correct: true,
      });
    });

    it(`${question.type}: a missing response is unanswered`, () => {
      expect(scoreQuestion(question, undefined)).toEqual(unanswered(question));
    });

    it(`${question.type}: every other response type is unanswered`, () => {
      for (const [type, response] of Object.entries(responseOfType)) {
        if (type !== question.type)
          expect(scoreQuestion(question, response)).toEqual(unanswered(question));
      }
    });
  }

  it('a malformed response is unanswered rather than throwing', () => {
    const broken = { type: 'fill_blank', blanks: { b1: 42 } } as unknown as QuestionResponse;
    expect(scoreQuestion(fillBlank, broken)).toEqual(unanswered(fillBlank));
  });

  it('points are all-or-nothing', () => {
    const nearly = scoreQuestion(matching, match({ p1: 'p1', p2: 'p2', p3: 'p1' }));
    expect(nearly.fraction).toBeCloseTo(2 / 3);
    expect(nearly.earned).toBe(0);
  });

  it("returns the question's own feedback objects", () => {
    expect(scoreQuestion(single, sc('b')).feedback).toBe(RIGHT);
  });
});
