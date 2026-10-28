import { describe, expect, it } from 'vitest';
import { LIMITS, QuestionSchema } from '../format/index';
import type { Question } from '../format/index';
import { newQuestion } from './factories';
import {
  addFillPart,
  addQuestionItem,
  clampSpot,
  moveQuestionItem,
  removeFillPart,
  removeQuestionItem,
  setFillText,
  setQuestionFeedback,
  setQuestionImage,
  setQuestionPoints,
  setQuestionPrompt,
  setCorrectOption,
  setTrueFalseAnswer,
  toggleCorrectOption,
  spotFromPoints,
  updateBlank,
  updateQuestionItem,
} from './questions';

const counter = (prefix = 'n') => {
  let n = 0;
  return () => `${prefix}${++n}`;
};
const picture = {
  media: { kind: 'file' as const, fileId: 'file-screen' },
  alt: 'The billing screen',
};
const expectValid = (q: Question) => expect(QuestionSchema.safeParse(q).success).toBe(true);
const said = (text: string) => [{ runs: [{ text }] }];

describe('question lists', () => {
  it('adds options up to the limit with unique ids', () => {
    let q: Question = newQuestion('single_choice', counter());
    for (let i = 0; i < 10; i++) q = addQuestionItem(q, 'options', {}, counter('o'));
    expect(q.type === 'single_choice' && q.options.length).toBe(LIMITS.options);
    expect(new Set(q.type === 'single_choice' ? q.options.map((o) => o.id) : []).size).toBe(
      LIMITS.options,
    );
    expectValid(q);
  });

  it('keeps one right answer in single choice but not in multiple choice', () => {
    const single = newQuestion('single_choice', counter());
    const [a, b] = single.options.map((o) => o.id) as [string, string];
    let q = updateQuestionItem(single, 'options', a, { correct: true });
    q = updateQuestionItem(q, 'options', b, { correct: true, text: 'Offer a call back' });
    expect(q.type === 'single_choice' && q.options.map((o) => [o.correct, o.text])).toEqual([
      [false, ''],
      [true, 'Offer a call back'],
    ]);
    q = addQuestionItem(q, 'options', { correct: true, text: 'Apologise' }, counter('x'));
    expect(q.type === 'single_choice' && q.options.map((o) => o.correct)).toEqual([
      false,
      false,
      true,
    ]);
    const multiple = newQuestion('multiple_choice', counter());
    const [first, second] = multiple.options.map((o) => o.id) as [string, string];
    let m = updateQuestionItem(multiple, 'options', first, { correct: true });
    m = updateQuestionItem(m, 'options', second, { correct: true });
    expect(m.type === 'multiple_choice' && m.options.every((o) => o.correct)).toBe(true);
  });

  it('picks the right option with a tick', () => {
    const single = newQuestion('single_choice', counter());
    const [a, b] = single.options.map((o) => o.id) as [string, string];
    let q = toggleCorrectOption(setCorrectOption(single, a), b);
    expect(q.type === 'single_choice' && q.options.map((o) => o.correct)).toEqual([false, true]);
    q = toggleCorrectOption(q, b);
    expect(q.type === 'single_choice' && q.options.map((o) => o.correct)).toEqual([false, true]);
    const multiple = newQuestion('multiple_choice', counter());
    const [c, d] = multiple.options.map((o) => o.id) as [string, string];
    let m = toggleCorrectOption(toggleCorrectOption(multiple, c), d);
    expect(m.type === 'multiple_choice' && m.options.map((o) => o.correct)).toEqual([true, true]);
    m = toggleCorrectOption(m, c);
    expect(m.type === 'multiple_choice' && m.options.map((o) => o.correct)).toEqual([false, true]);
    expect(toggleCorrectOption(m, 'missing')).toBe(m);
    expect(setCorrectOption(newQuestion('true_false', counter()), 'x').type).toBe('true_false');
  });

  it('removes down to the publish minimum only', () => {
    const q = addQuestionItem(
      newQuestion('ordering', counter()),
      'items',
      { text: 'Close the ticket' },
      counter('i'),
    );
    const removed = removeQuestionItem(q, 'items', 'i1');
    expect(removed.type === 'ordering' && removed.items.map((i) => i.id)).toEqual(['n2', 'n3']);
    expect(removeQuestionItem(removed, 'items', 'n2')).toBe(removed);
    expect(removeQuestionItem(removed, 'pairs', 'n2')).toBe(removed);
  });

  it('moves items and edits pairs', () => {
    const q = newQuestion('matching', counter());
    const moved = moveQuestionItem(q, 'pairs', 'n2', 1);
    expect(moved.type === 'matching' && moved.pairs.map((p) => p.id)).toEqual(['n3', 'n2']);
    const edited = updateQuestionItem(q, 'pairs', 'n2', { prompt: 'Refund', match: 'Money back' });
    expect(edited.type === 'matching' && edited.pairs[0]).toEqual({
      id: 'n2',
      prompt: 'Refund',
      match: 'Money back',
    });
    expect(updateQuestionItem(edited, 'pairs', 'n2', { prompt: 'Refund' })).toBe(edited);
  });

  it('sets and removes option feedback', () => {
    const q = newQuestion('single_choice', counter());
    const withFeedback = updateQuestionItem(q, 'options', 'n2', {
      feedback: said('Close, but check the date.'),
    });
    expect(withFeedback.type === 'single_choice' && withFeedback.options[0]?.feedback).toEqual(
      said('Close, but check the date.'),
    );
    const cleared = updateQuestionItem(withFeedback, 'options', 'n2', { feedback: [] });
    expect(
      cleared.type === 'single_choice' && cleared.options[0] && 'feedback' in cleared.options[0],
    ).toBe(false);
  });

  it('adds hotspot spots inside the picture; the first is the right one', () => {
    let q: Question = newQuestion('hotspot', counter(), { image: picture });
    q = addQuestionItem(q, 'spots', { x: 95, y: -5, width: 20, height: 1 }, counter('s'));
    q = addQuestionItem(q, 'spots', {}, counter('t'));
    expect(
      q.type === 'hotspot' && q.spots.map((s) => [s.x, s.y, s.width, s.height, s.correct]),
    ).toEqual([
      [80, 0, 20, 2, true],
      [40, 40, 20, 20, false],
    ]);
    q = updateQuestionItem(q, 'spots', 's1', { shape: 'ellipse', width: 500 });
    expect(q.type === 'hotspot' && q.spots[0]).toMatchObject({
      shape: 'ellipse',
      x: 0,
      width: 100,
    });
    expectValid(q);
  });
});

describe('question details', () => {
  it('sets the prompt, points and picture', () => {
    const q = newQuestion('true_false', counter());
    expect(setQuestionPrompt(q, said('Always confirm the account first.'))).toMatchObject({
      prompt: said('Always confirm the account first.'),
    });
    expect(setQuestionPrompt(q, [])).toBe(q);
    expect(setQuestionPoints(q, 250).points).toBe(LIMITS.questionPoints);
    expect(setQuestionPoints(q, 0).points).toBe(1);
    expect(setQuestionPoints(q, Number.NaN)).toBe(q);
    const withPicture = setQuestionImage(q, picture);
    expect(withPicture).toMatchObject({ image: picture });
    expect('image' in setQuestionImage(withPicture, null)).toBe(false);
    const hotspot = newQuestion('hotspot', counter(), { image: picture });
    expect(setQuestionImage(hotspot, null)).toBe(hotspot);
  });

  it('sets and removes feedback, including true-or-false feedback', () => {
    let q: Question = newQuestion('true_false', counter());
    q = setQuestionFeedback(q, 'correct', said('Right.'));
    q = setQuestionFeedback(q, 'false', said('It is true: we always confirm.'));
    expect(q).toMatchObject({
      feedback: { correct: said('Right.') },
      feedbackFalse: said('It is true: we always confirm.'),
    });
    q = setQuestionFeedback(setQuestionFeedback(q, 'correct', []), 'false', []);
    expect('feedback' in q || 'feedbackFalse' in q).toBe(false);
    const choice = newQuestion('single_choice', counter());
    expect(setQuestionFeedback(choice, 'true', said('x'))).toBe(choice);
    expect(setTrueFalseAnswer(q, false)).toMatchObject({ answer: false });
    expect(setTrueFalseAnswer(q, true)).toBe(q);
  });
});

describe('fill in the blank', () => {
  it('adds, edits and removes parts, keeping the last blank', () => {
    let q: Question = newQuestion('fill_blank', counter());
    q = setFillText(q, 0, 'Our refund window is ');
    q = updateBlank(q, 'n2', {
      answers: ['30 days', 'thirty days', ...Array.from({ length: 20 }, () => 'x')],
      caseSensitive: true,
    });
    q = addFillPart(q, 'text');
    q = setFillText(q, 2, '.');
    expect(q.type === 'fill_blank' && q.parts).toEqual([
      { kind: 'text', text: 'Our refund window is ' },
      {
        kind: 'blank',
        id: 'n2',
        answers: ['30 days', 'thirty days', ...Array.from({ length: 8 }, () => 'x')],
        caseSensitive: true,
      },
      { kind: 'text', text: '.' },
    ]);
    expect(removeFillPart(q, 1)).toBe(q);
    q = addFillPart(q, 'blank', undefined, counter('b'));
    expect(q.type === 'fill_blank' && q.parts[3]).toEqual({
      kind: 'blank',
      id: 'b1',
      answers: [''],
    });
    expect(removeFillPart(q, 3).type === 'fill_blank').toBe(true);
    q = updateBlank(q, 'n2', { answers: [], caseSensitive: false });
    expect(q.type === 'fill_blank' && q.parts[1]).toEqual({
      kind: 'blank',
      id: 'n2',
      answers: [''],
    });
    expectValid(q);
  });
});

describe('hotspot drawing', () => {
  it('keeps spots inside the picture and at least 2 % in size', () => {
    expect(clampSpot({ x: 99, y: 99, width: 0, height: 50 })).toEqual({
      x: 98,
      y: 50,
      width: 2,
      height: 50,
    });
    expect(clampSpot({ x: Number.NaN, y: 10.123, width: 33.3333, height: 20 })).toEqual({
      x: 0,
      y: 10.12,
      width: 33.33,
      height: 20,
    });
    expect(spotFromPoints({ x: 60, y: 10 }, { x: 20, y: 30 })).toEqual({
      x: 20,
      y: 10,
      width: 40,
      height: 20,
    });
  });
});
