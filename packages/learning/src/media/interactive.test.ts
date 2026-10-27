import { describe, expect, it } from 'vitest';
import type { FlashcardsBlock, ProcessBlock, RichText, SortingBlock } from '../format/index';
import {
  checkSorting,
  flashcardsProgress,
  keepCorrectPlacements,
  processScreens,
  processView,
  rovingIndex,
  sortingDeck,
} from './interactive';

/** One paragraph of rich text. */
const richText = (text: string): RichText => [{ runs: [{ text }] }];

const sorting: SortingBlock = {
  id: 'sort_waste',
  type: 'sorting',
  categories: [
    { id: 'sharps', title: 'Sharps bin' },
    { id: 'clinical', title: 'Clinical waste' },
  ],
  items: [
    { id: 'needle', text: 'Used needle', categoryId: 'sharps' },
    { id: 'gloves', text: 'Used gloves', categoryId: 'clinical' },
    { id: 'lancet', text: 'Lancet', categoryId: 'sharps' },
    { id: 'constructor', text: 'Dressing', categoryId: 'clinical' },
  ],
};

describe('sorting', () => {
  it('checks placed items and lists the ones still in the deck', () => {
    expect(
      checkSorting(sorting, { needle: 'sharps', gloves: 'sharps', unknown: 'sharps' }),
    ).toEqual({
      total: 4,
      correctIds: ['needle'],
      wrongIds: ['gloves'],
      unplacedIds: ['lancet', 'constructor'],
      allCorrect: false,
    });
    const right = {
      needle: 'sharps',
      gloves: 'clinical',
      lancet: 'sharps',
      constructor: 'clinical',
    };
    expect(checkSorting(sorting, right).allCorrect).toBe(true);
  });

  it('keeps right answers in place and sends wrong ones back to the deck', () => {
    const placements = { needle: 'sharps', gloves: 'sharps', lancet: 'sharps' };
    expect(keepCorrectPlacements(sorting, placements)).toEqual({
      needle: 'sharps',
      lancet: 'sharps',
    });
  });

  it('shuffles the deck the same way for the same seed, leaving out placed items', () => {
    const first = sortingDeck(sorting, 42).map((item) => item.id);
    expect(sortingDeck(sorting, 42).map((item) => item.id)).toEqual(first);
    expect([...first].sort()).toEqual(['constructor', 'gloves', 'lancet', 'needle']);
    const seeds = Array.from({ length: 10 }, (_, seed) =>
      sortingDeck(sorting, seed)
        .map((item) => item.id)
        .join(),
    );
    expect(new Set(seeds).size).toBeGreaterThan(1);
    expect(sortingDeck(sorting, 42, { needle: 'sharps' }).map((item) => item.id)).toEqual(
      first.filter((id) => id !== 'needle'),
    );
    expect(sorting.items.map((item) => item.id)).toEqual([
      'needle',
      'gloves',
      'lancet',
      'constructor',
    ]); // not changed
  });
});

describe('flashcards', () => {
  const cards: FlashcardsBlock = {
    id: 'cards',
    type: 'flashcards',
    cards: [
      { id: 'c1', front: 'SBAR', back: 'Situation, background, assessment, recommendation' },
      { id: 'c2', front: 'NEWS2', back: 'National early warning score' },
    ],
  };

  it('is done once every card has been turned over', () => {
    expect(flashcardsProgress(cards, [])).toEqual({ seen: 0, total: 2, done: false });
    expect(flashcardsProgress(cards, ['c1', 'c1', 'old_card'])).toEqual({
      seen: 1,
      total: 2,
      done: false,
    });
    expect(flashcardsProgress(cards, new Set(['c2', 'c1']))).toEqual({
      seen: 2,
      total: 2,
      done: true,
    });
  });
});

describe('process', () => {
  const step = (id: string, title: string) => ({ id, title, body: richText(`${title}.`) });
  const full: ProcessBlock = {
    id: 'handwash',
    type: 'process',
    intro: { title: 'Washing hands' },
    steps: [
      step('wet', 'Wet your hands'),
      step('soap', 'Apply soap'),
      step('rub', 'Rub for 20 seconds'),
    ],
    summary: { title: 'Done', body: richText('Dry with a paper towel.') },
  };

  it('lists the intro, each numbered step and the summary', () => {
    expect(processScreens(full)).toEqual([
      { kind: 'intro' },
      { kind: 'step', stepId: 'wet', number: 1 },
      { kind: 'step', stepId: 'soap', number: 2 },
      { kind: 'step', stepId: 'rub', number: 3 },
      { kind: 'summary' },
    ]);
    expect(
      processScreens({ ...full, intro: undefined, summary: undefined }).map((s) => s.kind),
    ).toEqual(['step', 'step', 'step']);
  });

  it('says which buttons work and completes on the last step', () => {
    expect(processView(full, 0)).toEqual({
      index: 0,
      screen: { kind: 'intro' },
      screenCount: 5,
      stepCount: 3,
      canGoBack: false,
      canGoNext: true,
      completed: false,
    });
    expect(processView(full, 2)).toMatchObject({
      canGoBack: true,
      canGoNext: true,
      completed: false,
    });
    expect(processView(full, 3)).toMatchObject({
      screen: { kind: 'step', stepId: 'rub', number: 3 },
      completed: true,
    });
    expect(processView(full, 4)).toMatchObject({
      screen: { kind: 'summary' },
      canGoNext: false,
      completed: true,
    });
  });

  it('clamps the screen index', () => {
    expect(processView(full, 99).index).toBe(4);
    expect(processView(full, -3).index).toBe(0);
    expect(processView(full, Number.NaN).index).toBe(0);
    expect(processView(full, 1.7).index).toBe(1);
    expect(
      processView({ ...full, intro: undefined, steps: [], summary: undefined }, 0),
    ).toMatchObject({
      screen: undefined,
      screenCount: 0,
      canGoNext: false,
    });
  });
});

describe('rovingIndex', () => {
  it('moves along a row with arrow keys, wrapping by default', () => {
    expect(rovingIndex('ArrowRight', 0, 3)).toBe(1);
    expect(rovingIndex('ArrowRight', 2, 3)).toBe(0);
    expect(rovingIndex('ArrowLeft', 0, 3)).toBe(2);
    expect(rovingIndex('ArrowLeft', 0, 3, { wrap: false })).toBe(0);
    expect(rovingIndex('ArrowRight', 2, 3, { wrap: false })).toBe(2);
    expect(rovingIndex('Home', 2, 3)).toBe(0);
    expect(rovingIndex('End', 0, 3)).toBe(2);
  });

  it('follows the orientation and lets other keys through', () => {
    expect(rovingIndex('ArrowDown', 0, 3)).toBeNull();
    expect(rovingIndex('ArrowDown', 0, 3, { orientation: 'vertical' })).toBe(1);
    expect(rovingIndex('ArrowRight', 0, 3, { orientation: 'vertical' })).toBeNull();
    expect(rovingIndex('ArrowUp', 1, 3, { orientation: 'both' })).toBe(0);
    expect(rovingIndex('ArrowRight', 1, 3, { orientation: 'both' })).toBe(2);
    expect(rovingIndex('Enter', 0, 3)).toBeNull();
    expect(rovingIndex('ArrowRight', 0, 0)).toBeNull();
  });
});
