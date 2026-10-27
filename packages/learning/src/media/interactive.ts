import type { FlashcardsBlock, Id, ProcessBlock, SortingBlock } from '../format/index';
import { mulberry32, shuffle } from '../util/index';

// ---------- Sorting activity ----------

/** Where the learner has put each sorting item: item id → category id. Items not listed are still in the deck. */
export type SortingPlacements = Readonly<Record<Id, Id>>;

/** The result of pressing Check: which placed items are right or wrong, and which are still in the deck. */
export type SortingCheck = {
  total: number;
  correctIds: Id[];
  wrongIds: Id[];
  unplacedIds: Id[];
  allCorrect: boolean;
};

const placedIn = (placements: SortingPlacements, itemId: Id): Id | undefined =>
  Object.hasOwn(placements, itemId) ? placements[itemId] : undefined;

/** Checks the learner's sorting. The block is done (block_completed) once `allCorrect` is true. */
export function checkSorting(block: SortingBlock, placements: SortingPlacements): SortingCheck {
  const check: SortingCheck = {
    total: block.items.length,
    correctIds: [],
    wrongIds: [],
    unplacedIds: [],
    allCorrect: false,
  };
  for (const item of block.items) {
    const category = placedIn(placements, item.id);
    if (category === undefined) check.unplacedIds.push(item.id);
    else (category === item.categoryId ? check.correctIds : check.wrongIds).push(item.id);
  }
  check.allCorrect = check.correctIds.length === check.total;
  return check;
}

/** After a check: right answers stay where they are, wrong ones go back to the deck. */
export function keepCorrectPlacements(
  block: SortingBlock,
  placements: SortingPlacements,
): Record<Id, Id> {
  const kept: Record<Id, Id> = {};
  for (const item of block.items)
    if (placedIn(placements, item.id) === item.categoryId) kept[item.id] = item.categoryId;
  return kept;
}

/** The deck, shuffled with `seed` (the same seed always gives the same order), without the items already placed. */
export function sortingDeck(
  block: SortingBlock,
  seed: number,
  placements: SortingPlacements = {},
): SortingBlock['items'] {
  return shuffle(block.items, mulberry32(seed)).filter(
    (item) => placedIn(placements, item.id) === undefined,
  );
}

// ---------- Flashcards ----------

/** How many cards the learner has turned over. The block is done (block_completed) once every card has been seen. */
export function flashcardsProgress(
  block: FlashcardsBlock,
  seenIds: Iterable<Id>,
): { seen: number; total: number; done: boolean } {
  const seen = new Set(seenIds);
  const count = block.cards.filter((card) => seen.has(card.id)).length;
  return { seen: count, total: block.cards.length, done: count === block.cards.length };
}

// ---------- Process (step by step) ----------

/** One screen of a process block: the intro, a step (numbered from 1) or the summary. */
export type ProcessScreen =
  { kind: 'intro' } | { kind: 'step'; stepId: Id; number: number } | { kind: 'summary' };

/** The screens in order: the intro if there is one, every step, then the summary if there is one. */
export function processScreens(block: ProcessBlock): ProcessScreen[] {
  const screens: ProcessScreen[] = block.intro ? [{ kind: 'intro' }] : [];
  block.steps.forEach((step, i) => screens.push({ kind: 'step', stepId: step.id, number: i + 1 }));
  if (block.summary) screens.push({ kind: 'summary' });
  return screens;
}

/** What a process block shows at screen `index`, which buttons work, and whether it is done. */
export type ProcessView = {
  index: number;
  screen: ProcessScreen | undefined;
  screenCount: number;
  stepCount: number;
  canGoBack: boolean;
  canGoNext: boolean;
  /** True from the last step on (block_completed). */
  completed: boolean;
};

/** The process block at screen `index` (clamped to the screens there are). */
export function processView(block: ProcessBlock, index: number): ProcessView {
  const screens = processScreens(block);
  const at = Math.min(Math.max(Math.trunc(index) || 0, 0), Math.max(screens.length - 1, 0));
  const lastStep = screens.findLastIndex((screen) => screen.kind === 'step');
  return {
    index: at,
    screen: screens[at],
    screenCount: screens.length,
    stepCount: block.steps.length,
    canGoBack: at > 0,
    canGoNext: at < screens.length - 1,
    completed: at >= lastStep,
  };
}

// ---------- Keyboard ----------

/**
 * The index an arrow, Home or End key moves to in a row of `count` items (tabs, carousel slides, labeled-graphic
 * spots, sorting categories), wrapping around by default. Null for other keys, so the caller lets them through.
 */
export function rovingIndex(
  key: string,
  index: number,
  count: number,
  options: { orientation?: 'horizontal' | 'vertical' | 'both'; wrap?: boolean } = {},
): number | null {
  if (count <= 0) return null;
  const { orientation = 'horizontal', wrap = true } = options;
  const next =
    (orientation !== 'vertical' && key === 'ArrowRight') ||
    (orientation !== 'horizontal' && key === 'ArrowDown');
  const previous =
    (orientation !== 'vertical' && key === 'ArrowLeft') ||
    (orientation !== 'horizontal' && key === 'ArrowUp');
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (!next && !previous) return null;
  const target = index + (next ? 1 : -1);
  if (wrap) return (target + count) % count;
  return Math.min(Math.max(target, 0), count - 1);
}
