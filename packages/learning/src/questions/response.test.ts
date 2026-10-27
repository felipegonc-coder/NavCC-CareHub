import { describe, expect, it } from 'vitest';
import type { Question, QuestionResponse, RichText } from '../format/index';
import { isResponseFor } from './index';

const rt = (text: string): RichText => [{ runs: [{ text }] }];
const base = { prompt: rt('Fictional prompt'), points: 1 };

const questions: Record<Question['type'], Question> = {
  single_choice: {
    ...base,
    id: 'q1',
    type: 'single_choice',
    options: [{ id: 'a', text: 'A', correct: true }],
  },
  multiple_choice: {
    ...base,
    id: 'q2',
    type: 'multiple_choice',
    options: [{ id: 'a', text: 'A', correct: true }],
  },
  true_false: { ...base, id: 'q3', type: 'true_false', answer: true },
  matching: { ...base, id: 'q4', type: 'matching', pairs: [{ id: 'p1', prompt: 'P', match: 'M' }] },
  drag_matching: {
    ...base,
    id: 'q5',
    type: 'drag_matching',
    pairs: [{ id: 'p1', prompt: 'P', match: 'M' }],
  },
  fill_blank: {
    ...base,
    id: 'q6',
    type: 'fill_blank',
    parts: [{ kind: 'blank', id: 'b1', answers: ['x'] }],
  },
  ordering: { ...base, id: 'q7', type: 'ordering', items: [{ id: 'i1', text: 'One' }] },
  hotspot: {
    ...base,
    id: 'q8',
    type: 'hotspot',
    image: { media: { kind: 'file', fileId: 'file-1' }, alt: 'Fictional screen' },
    spots: [
      { id: 's1', shape: 'rect', x: 0, y: 0, width: 10, height: 10, correct: true, label: 'Spot' },
    ],
  },
};

const good: Record<Question['type'], QuestionResponse> = {
  single_choice: { type: 'single_choice', optionId: 'a' },
  multiple_choice: { type: 'multiple_choice', optionIds: ['a'] },
  true_false: { type: 'true_false', value: false },
  matching: { type: 'matching', matches: { p1: 'p1' } },
  drag_matching: { type: 'drag_matching', matches: { p1: 'p1' } },
  fill_blank: { type: 'fill_blank', blanks: { b1: 'x' } },
  ordering: { type: 'ordering', order: ['i1'] },
  hotspot: { type: 'hotspot', pick: { kind: 'point', x: 1, y: 2 } },
};

const types = Object.keys(questions) as Question['type'][];

const malformed: { name: string; type: Question['type']; value: unknown }[] = [
  {
    name: 'single choice without an option id',
    type: 'single_choice',
    value: { type: 'single_choice' },
  },
  {
    name: 'single choice with a numeric id',
    type: 'single_choice',
    value: { type: 'single_choice', optionId: 1 },
  },
  {
    name: 'multiple choice ids not an array',
    type: 'multiple_choice',
    value: { type: 'multiple_choice', optionIds: 'a' },
  },
  {
    name: 'multiple choice with a non-string id',
    type: 'multiple_choice',
    value: { type: 'multiple_choice', optionIds: ['a', 2] },
  },
  {
    name: 'true/false with a string value',
    type: 'true_false',
    value: { type: 'true_false', value: 'true' },
  },
  {
    name: 'matching as an array',
    type: 'matching',
    value: { type: 'matching', matches: [['p1', 'p1']] },
  },
  {
    name: 'matching with a non-string value',
    type: 'matching',
    value: { type: 'matching', matches: { p1: 1 } },
  },
  {
    name: 'drag matching without matches',
    type: 'drag_matching',
    value: { type: 'drag_matching' },
  },
  {
    name: 'fill-in with a null blanks',
    type: 'fill_blank',
    value: { type: 'fill_blank', blanks: null },
  },
  {
    name: 'fill-in with a non-string answer',
    type: 'fill_blank',
    value: { type: 'fill_blank', blanks: { b1: 3 } },
  },
  {
    name: 'ordering with an object order',
    type: 'ordering',
    value: { type: 'ordering', order: { 0: 'i1' } },
  },
  {
    name: 'hotspot point with NaN',
    type: 'hotspot',
    value: { type: 'hotspot', pick: { kind: 'point', x: Number.NaN, y: 1 } },
  },
  {
    name: 'hotspot point with Infinity',
    type: 'hotspot',
    value: { type: 'hotspot', pick: { kind: 'point', x: 1, y: Infinity } },
  },
  {
    name: 'hotspot point without y',
    type: 'hotspot',
    value: { type: 'hotspot', pick: { kind: 'point', x: 1 } },
  },
  {
    name: 'hotspot spot without id',
    type: 'hotspot',
    value: { type: 'hotspot', pick: { kind: 'spot' } },
  },
  {
    name: 'hotspot with an unknown pick kind',
    type: 'hotspot',
    value: { type: 'hotspot', pick: { kind: 'area', x: 1, y: 1 } },
  },
];

describe('isResponseFor', () => {
  for (const type of types) {
    it(`accepts a well-formed ${type} response`, () => {
      expect(isResponseFor(questions[type], good[type])).toBe(true);
    });

    it(`rejects every other response type for ${type}`, () => {
      for (const other of types) {
        if (other !== type) expect(isResponseFor(questions[type], good[other])).toBe(false);
      }
    });
  }

  const notResponses: { label: string; value: unknown }[] = [
    { label: 'undefined', value: undefined },
    { label: 'null', value: null },
    { label: 'a number', value: 0 },
    { label: 'a string', value: 'single_choice' },
    { label: 'a boolean', value: true },
    { label: 'an empty array', value: [] },
    { label: 'an array', value: ['single_choice', 'a'] },
  ];
  for (const { label, value } of notResponses) {
    it(`rejects ${label}`, () => {
      expect(isResponseFor(questions.single_choice, value)).toBe(false);
    });
  }

  for (const c of malformed) {
    it(`rejects a malformed response: ${c.name}`, () => {
      expect(isResponseFor(questions[c.type], c.value)).toBe(false);
    });
  }

  it('accepts a hotspot spot pick', () => {
    expect(
      isResponseFor(questions.hotspot, { type: 'hotspot', pick: { kind: 'spot', spotId: 's1' } }),
    ).toBe(true);
  });

  it('narrows the response type', () => {
    const response: QuestionResponse = good.single_choice;
    const question = questions.single_choice;
    if (question.type === 'single_choice' && isResponseFor(question, response)) {
      expect(response.optionId).toBe('a');
    } else {
      throw new Error('expected a single-choice response');
    }
  });
});
