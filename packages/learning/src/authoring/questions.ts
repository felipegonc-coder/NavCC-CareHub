import { LIMITS, newId as randomId } from '../format/index';
import type {
  ChoiceOption,
  FillPart,
  HotspotSpot,
  Id,
  Image,
  MatchPair,
  Question,
  RichText,
} from '../format/index';
import { insertItem, moveItemById, removeItemById, updateItemById } from './arrays';
import { uniqueIds } from './ids';
import { isBlankRichText } from './richtext';
import type { IdGen, QuestionOf } from './types';
import { PUBLISH_MINIMUMS, clampInt, sameJson, withOptional } from './types';

// Helpers that edit one question. Each takes and returns a Question, so they plug into
// `updateQuestion(course, questionId, (q) => addQuestionItem(q, "options"))`. A helper that doesn't fit the
// question's type returns it unchanged, and so does an edit that changes nothing.

/** The lists inside questions: choice options, matching pairs, ordering items and hotspot spots. */
export type QuestionLists = {
  options: ChoiceOption;
  pairs: MatchPair;
  items: QuestionOf<'ordering'>['items'][number];
  spots: HotspotSpot;
};
export type QuestionListName = keyof QuestionLists;

/** How many items each list may hold while editing: publish minimums up to the format's limits. */
export const QUESTION_LIST_SIZES: Record<QuestionListName, { min: number; max: number }> = {
  options: { min: PUBLISH_MINIMUMS.options, max: LIMITS.options },
  pairs: { min: PUBLISH_MINIMUMS.pairs, max: LIMITS.pairs },
  items: { min: PUBLISH_MINIMUMS.orderingItems, max: LIMITS.orderingItems },
  spots: { min: 0, max: LIMITS.hotspotSpots },
};

function listOf<L extends QuestionListName>(q: Question, list: L): QuestionLists[L][] | null {
  return list in q ? (q as unknown as Record<L, QuestionLists[L][]>)[list] : null;
}

function withList<L extends QuestionListName>(
  q: Question,
  list: L,
  update: (items: QuestionLists[L][]) => QuestionLists[L][],
): Question {
  const current = listOf(q, list);
  const next = current && update(current);
  return !next || next === current ? q : ({ ...q, [list]: next } as Question);
}

const EMPTY: { [L in QuestionListName]: (q: Question) => Omit<QuestionLists[L], 'id'> } = {
  options: () => ({ text: '', correct: false }),
  pairs: () => ({ prompt: '', match: '' }),
  items: () => ({ text: '' }),
  spots: (q) => ({
    shape: 'rect',
    x: 40,
    y: 40,
    width: 20,
    height: 20,
    correct: !listOf(q, 'spots')?.some((s) => s.correct),
    label: '',
  }),
};

function onlyCorrect(q: Question, optionId: Id): Question {
  if (q.type !== 'single_choice') return q;
  const options = q.options.map((o) =>
    o.id !== optionId && o.correct ? { ...o, correct: false } : o,
  );
  return options.every((o, i) => o === q.options[i]) ? q : { ...q, options };
}

/** Patch for one option, pair, item or spot. `feedback: undefined` (or blank) removes an option's feedback. */
export type QuestionItemPatch<L extends QuestionListName> = {
  [K in Exclude<keyof QuestionLists[L], 'id'>]?: QuestionLists[L][K] | undefined;
};

function patched<T extends object>(item: T, patch: object, spot: boolean): T {
  let next = item;
  for (const [key, value] of Object.entries(patch) as [keyof T & string, unknown][]) {
    if (key === 'feedback' && isBlankRichText(value as RichText | undefined))
      next = withOptional(next, key, undefined);
    else if (value !== undefined) next = withOptional(next, key, value as T[keyof T & string]);
  }
  if (spot) next = clampSpot(next as T & HotspotSpot);
  return sameJson(next, item) ? item : next;
}

/** Adds an option, pair, item or spot at the end (up to the format's limit). A new spot is right when none is yet. */
export function addQuestionItem<L extends QuestionListName>(
  q: Question,
  list: L,
  init: QuestionItemPatch<L> = {},
  newId: IdGen = randomId,
): Question {
  let added: Id | undefined;
  const next = withList(q, list, (items) => {
    if (items.length >= QUESTION_LIST_SIZES[list].max) return items;
    added = uniqueIds(new Set(items.map((item) => item.id)), newId)();
    const item = patched(
      { ...EMPTY[list](q), id: added } as QuestionLists[L],
      init,
      list === 'spots',
    );
    return [...items, item];
  });
  return added !== undefined && list === 'options' && (init as { correct?: boolean }).correct
    ? onlyCorrect(next, added)
    : next;
}

/** Removes an option, pair, item or spot, keeping at least 2 options, pairs and items. */
export function removeQuestionItem(q: Question, list: QuestionListName, itemId: Id): Question {
  return withList(q, list, (items) =>
    items.length <= QUESTION_LIST_SIZES[list].min ? items : removeItemById(items, itemId),
  );
}

/** Moves an option, pair, item or spot to `toIndex`. For ordering questions the listed order is the right answer. */
export function moveQuestionItem(
  q: Question,
  list: QuestionListName,
  itemId: Id,
  toIndex: number,
): Question {
  return withList(q, list, (items) => moveItemById(items, itemId, toIndex));
}

/** Changes an option, pair, item or spot. Marking a single-choice option right unmarks the others; spots stay inside the picture. */
export function updateQuestionItem<L extends QuestionListName>(
  q: Question,
  list: L,
  itemId: Id,
  patch: QuestionItemPatch<L>,
): Question {
  const next = withList(q, list, (items) =>
    updateItemById(items, itemId, (item) => patched(item, patch, list === 'spots')),
  );
  return list === 'options' && (patch as { correct?: boolean }).correct
    ? onlyCorrect(next, itemId)
    : next;
}

/** Marks an option right. In single choice it becomes the only right option; in multiple choice others stay. */
export function setCorrectOption(q: Question, optionId: Id): Question {
  return updateQuestionItem(q, 'options', optionId, { correct: true });
}

/** Ticks or unticks a multiple-choice option. In single choice this picks the option, so one always stays right. */
export function toggleCorrectOption(q: Question, optionId: Id): Question {
  const option = listOf(q, 'options')?.find((o) => o.id === optionId);
  if (!option) return q;
  const correct = q.type === 'single_choice' || !option.correct;
  return updateQuestionItem(q, 'options', optionId, { correct });
}

/** Sets the question text. */
export function setQuestionPrompt(q: Question, prompt: RichText): Question {
  return sameJson(prompt, q.prompt) ? q : { ...q, prompt };
}

/** Sets the points (1..100). */
export function setQuestionPoints(q: Question, points: number): Question {
  const value = clampInt(points, 1, LIMITS.questionPoints);
  return value === undefined || value === q.points ? q : { ...q, points: value };
}

/** Sets or (with null) removes the question's picture. A hotspot question always keeps its picture. */
export function setQuestionImage(q: Question, image: Image | null): Question {
  if (q.type === 'hotspot') return image ? { ...q, image } : q;
  return withOptional(q, 'image', image ?? undefined);
}

/**
 * Sets feedback shown after a right or wrong answer, or (true-or-false only) after answering true or false.
 * Blank text removes it.
 */
export function setQuestionFeedback(
  q: Question,
  which: 'correct' | 'incorrect' | 'true' | 'false',
  text: RichText,
): Question {
  const value = isBlankRichText(text) ? undefined : text;
  if (which === 'true' || which === 'false') {
    return q.type === 'true_false'
      ? withOptional(q, which === 'true' ? 'feedbackTrue' : 'feedbackFalse', value)
      : q;
  }
  const feedback = withOptional({ ...q.feedback }, which, value);
  const next = withOptional(q, 'feedback', Object.keys(feedback).length > 0 ? feedback : undefined);
  return sameJson(next, q) ? q : next;
}

/** Sets whether a true-or-false statement is true. */
export function setTrueFalseAnswer(q: Question, answer: boolean): Question {
  return q.type === 'true_false' && q.answer !== answer ? { ...q, answer } : q;
}

// ---------- Fill in the blank: text parts and blanks; each blank accepts 1 to 10 answers ----------

type Blank = Extract<FillPart, { kind: 'blank' }>;

function withParts(q: Question, update: (parts: FillPart[]) => FillPart[]): Question {
  if (q.type !== 'fill_blank') return q;
  const parts = update(q.parts);
  return parts === q.parts ? q : { ...q, parts };
}

/** Inserts an empty text part or a blank (with one empty answer) at `index` (default: the end), up to 50 parts. */
export function addFillPart(
  q: Question,
  kind: FillPart['kind'],
  index?: number,
  newId: IdGen = randomId,
): Question {
  return withParts(q, (parts) => {
    if (parts.length >= LIMITS.fillParts) return parts;
    const blankIds = parts.flatMap((p) => (p.kind === 'blank' ? [p.id] : []));
    const part: FillPart =
      kind === 'text'
        ? { kind, text: '' }
        : { kind, id: uniqueIds(new Set(blankIds), newId)(), answers: [''] };
    return insertItem(parts, index ?? parts.length, part);
  });
}

/** Removes the part at `index`; the last blank stays. */
export function removeFillPart(q: Question, index: number): Question {
  return withParts(q, (parts) => {
    const part = parts[index];
    if (!part || (part.kind === 'blank' && parts.filter((p) => p.kind === 'blank').length <= 1))
      return parts;
    return parts.filter((_, i) => i !== index);
  });
}

/** Sets the text of the text part at `index` (up to 2,000 characters). */
export function setFillText(q: Question, index: number, text: string): Question {
  const value = text.slice(0, LIMITS.longText);
  return withParts(q, (parts) => {
    const part = parts[index];
    return part?.kind !== 'text' || part.text === value
      ? parts
      : parts.map((p, i) => (i === index ? { kind: 'text', text: value } : p));
  });
}

/** Changes a blank: its accepted answers (1 to 10, each up to 200 characters) and whether case must match. */
export function updateBlank(
  q: Question,
  blankId: Id,
  patch: { answers?: string[]; caseSensitive?: boolean },
): Question {
  return withParts(q, (parts) =>
    updateItemsOfKind(parts, blankId, (blank) => {
      let next: Blank = blank;
      if (patch.answers) {
        const answers = patch.answers
          .slice(0, LIMITS.blankAnswers)
          .map((a) => a.slice(0, LIMITS.blankAnswer));
        next = { ...next, answers: answers.length > 0 ? answers : [''] };
      }
      if (patch.caseSensitive !== undefined)
        next = withOptional(next, 'caseSensitive', patch.caseSensitive ? true : undefined);
      return sameJson(next, blank) ? blank : next;
    }),
  );
}

function updateItemsOfKind(
  parts: FillPart[],
  blankId: Id,
  update: (blank: Blank) => Blank,
): FillPart[] {
  let changed = false;
  const next = parts.map((part) => {
    if (part.kind !== 'blank' || part.id !== blankId) return part;
    const updated = update(part);
    changed ||= updated !== part;
    return updated;
  });
  return changed ? next : parts;
}

// ---------- Hotspot: spots on the picture, in % of its width and height ----------

const MIN_SPOT = 2;
const round = (value: number): number => Math.round(value * 100) / 100;
const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(Number.isFinite(value) ? value : min, min), max);

/** Keeps a spot inside the picture: at least 2 % wide and high, rounded to 0.01 %. */
export function clampSpot<T extends { x: number; y: number; width: number; height: number }>(
  spot: T,
): T {
  const width = round(clamp(spot.width, MIN_SPOT, 100));
  const height = round(clamp(spot.height, MIN_SPOT, 100));
  return {
    ...spot,
    width,
    height,
    x: round(clamp(spot.x, 0, 100 - width)),
    y: round(clamp(spot.y, 0, 100 - height)),
  };
}

/** The rectangle dragged out between two points (in % of the picture), for drawing a spot. */
export function spotFromPoints(
  a: { x: number; y: number },
  b: { x: number; y: number },
): { x: number; y: number; width: number; height: number } {
  return clampSpot({
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  });
}
