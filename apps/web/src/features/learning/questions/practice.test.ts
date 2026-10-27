import { richText, type Question } from '@carehub/learning';
import { describe, expect, it } from 'vitest';
import { practice } from './practice';

const prompt = richText('Practice question');

const choice: Question = {
  id: 'q-choice',
  type: 'single_choice',
  prompt,
  points: 1,
  feedback: { correct: richText('Well done.') },
  options: [
    { id: 'o-wait', text: 'Wait for a gap', correct: false, feedback: richText('Too slow.') },
    { id: 'o-ask', text: 'Ask how you can help', correct: true },
  ],
};

const matching: Question = {
  id: 'q-match',
  type: 'matching',
  prompt,
  points: 1,
  pairs: [
    { id: 'p-red', prompt: 'Red light', match: 'Stop' },
    { id: 'p-green', prompt: 'Green light', match: 'Go' },
    { id: 'p-amber', prompt: 'Amber light', match: 'Get ready' },
  ],
};

const ordering: Question = {
  id: 'q-order',
  type: 'ordering',
  prompt,
  points: 1,
  items: ['Greet', 'Listen', 'Answer', 'Check', 'Close'].map((text) => ({
    id: `i-${text.toLowerCase()}`,
    text,
  })),
};

describe('practice', () => {
  it('puts the question on a paper without its answers', () => {
    const { paper } = practice(choice, 1);
    expect(paper).toEqual({
      id: 'q-choice',
      type: 'single_choice',
      prompt,
      points: 1,
      options: [
        { id: 'o-wait', text: 'Wait for a gap' },
        { id: 'o-ask', text: 'Ask how you can help' },
      ],
    });
  });

  it('checks a choice with its feedback', () => {
    const { check } = practice(choice, 1);
    expect(check({ type: 'single_choice', optionId: 'o-ask' })).toMatchObject({
      correct: true,
      feedback: richText('Well done.'),
    });
    expect(check({ type: 'single_choice', optionId: 'o-wait' })).toMatchObject({
      correct: false,
      feedback: richText('Too slow.'),
    });
    expect(check(undefined)).toMatchObject({ answered: false, correct: false });
  });

  it('checks matches given in the per-try ids of the shuffled list', () => {
    const { paper, check } = practice(matching, 7);
    if (paper.type !== 'matching') throw new Error('expected a matching paper');
    const idOf = (text: string) => paper.matches.find((match) => match.text === text)?.id ?? '';
    const right = { 'p-red': idOf('Stop'), 'p-green': idOf('Go'), 'p-amber': idOf('Get ready') };
    expect(check({ type: 'matching', matches: right }).correct).toBe(true);
    const swapped = { ...right, 'p-red': idOf('Go'), 'p-green': idOf('Stop') };
    expect(check({ type: 'matching', matches: swapped }).correct).toBe(false);
  });

  it('checks an order given in the per-try item ids', () => {
    const { paper, check } = practice(ordering, 3);
    if (paper.type !== 'ordering') throw new Error('expected an ordering paper');
    const listed = ['Greet', 'Listen', 'Answer', 'Check', 'Close'].map(
      (text) => paper.items.find((item) => item.text === text)?.id ?? '',
    );
    expect(check({ type: 'ordering', order: listed }).correct).toBe(true);
    expect(check({ type: 'ordering', order: [...listed].reverse() }).correct).toBe(false);
  });

  it('shuffles the items differently for different seeds', () => {
    const orders = new Set(
      [1, 2, 3, 4, 5, 6].map((seed) => {
        const { paper } = practice(ordering, seed);
        return paper.type === 'ordering' ? paper.items.map((item) => item.text).join() : '';
      }),
    );
    expect(orders.size).toBeGreaterThan(1);
  });
});
