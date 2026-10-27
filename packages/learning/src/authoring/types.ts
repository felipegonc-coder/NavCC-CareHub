import type { Block, BlockType, Id, Question, QuestionType } from '../format/index';

// Internal helpers for the authoring module (index.ts does not re-export this file).

/** The block with `type` T, e.g. `BlockOf<"tabs">`. */
export type BlockOf<T extends BlockType> = Extract<Block, { type: T }>;
/** The question with `type` T, e.g. `QuestionOf<"matching">`. */
export type QuestionOf<T extends QuestionType> = Extract<Question, { type: T }>;
/** Makes a new id. Defaults to format's `newId`; tests pass a counter so results are repeatable. */
export type IdGen = () => Id;

/**
 * The smallest counts publish checks accept (course-format.md). Editors start new blocks and questions at these
 * counts and keep them there: "Remove" stops at the minimum, so authors can't make a block unpublishable by accident.
 */
export const PUBLISH_MINIMUMS = {
  options: 2,
  pairs: 2,
  orderingItems: 2,
  blankAnswers: 1,
  listItems: 1,
  quotes: 2,
  accordionItems: 1,
  tabs: 2,
  timelineItems: 2,
  processSteps: 2,
  flashcards: 1,
  sortingCategories: 2,
  sortingItems: 2,
} as const;

/** Rounds to a whole number and clamps to min..max; undefined for anything that isn't a finite number. */
export function clampInt(value: number, min: number, max: number): number | undefined {
  return Number.isFinite(value) ? Math.min(Math.max(Math.round(value), min), max) : undefined;
}

/** `obj` with `key` set to `value`, or without `key` when `value` is undefined; `obj` itself when nothing changes. */
export function withOptional<T extends object, K extends keyof T>(
  obj: T,
  key: K,
  value: T[K] | undefined,
): T {
  if (value === undefined) {
    if (!(key in obj)) return obj;
    return Object.fromEntries(Object.entries(obj).filter(([name]) => name !== String(key))) as T;
  }
  return obj[key] === value ? obj : { ...obj, [key]: value };
}

/** "Copy of …", cut to `max` characters. */
export function copyTitle(title: string, max: number): string {
  return `Copy of ${title}`.slice(0, max);
}

/** Same JSON value (plain data only), for skipping edits that change nothing. */
export function sameJson(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}
