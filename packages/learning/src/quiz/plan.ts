import type { Id, Question, QuizLesson } from '../format/index';
import { ownValue } from '../questions/helpers';
import { mulberry32, sample, shuffle, type Random } from '../util/index';

/**
 * Which questions one quiz attempt shows, in what order, and the display order of their options.
 */
export type AttemptPlan = {
  attemptId: Id;
  seed: number;
  /** Question ids in the order they are shown. */
  questionIds: Id[];
  /**
   * Display order by question id: choice option ids and matching/drag-matching right-hand pair ids
   * (only when `shuffleOptions`), and ordering item ids (always). Other questions have no entry.
   */
  optionOrder: Record<Id, Id[]>;
};

/**
 * Reshuffles allowed before falling back to a rotation; each try has at most a 1-in-2 chance of
 * failing.
 */
const MAX_RESHUFFLES = 32;

/**
 * Plans a quiz attempt. Draws `poolSize` of the lesson's own questions (all when unset), then
 * `count` more from each bank draw's published snapshot (drafts without a snapshot add none; a
 * question id is never planned twice). Without `shuffleQuestions` the order is the lesson's
 * questions, then each draw, in their listed order. Records option orders: choice options and the
 * right-hand list of matching and drag-matching questions when `shuffleOptions`, ordering items
 * always. Ordering items (and shuffled matching lists, which would otherwise line up with their
 * prompts) are never in the listed order when there are 2 or more. True/false, fill-in and hotspot
 * questions have no option order. Deterministic: the same quiz, seed and attempt id always give the
 * same plan.
 */
export function planAttempt(quiz: QuizLesson, seed: number, attemptId: Id): AttemptPlan {
  const { settings } = quiz;
  const random = mulberry32(seed);
  const planned = new Set<Id>();
  const take = (pool: readonly Question[], requested: number | undefined): Question[] => {
    const eligible: Question[] = [];
    for (const question of pool) {
      if (!planned.has(question.id) && !eligible.some((q) => q.id === question.id))
        eligible.push(question);
    }
    // All when unset; `sample` clamps the count to 0..eligible.length (NaN draws none).
    const drawn = sample(eligible, requested ?? eligible.length, random, { keepOrder: true });
    for (const question of drawn) planned.add(question.id);
    return drawn;
  };
  const drawn = take(quiz.questions, settings.poolSize);
  for (const draw of quiz.bankDraws ?? []) drawn.push(...take(draw.questions ?? [], draw.count));
  const shown = settings.shuffleQuestions ? shuffle(drawn, random) : drawn;
  const optionOrder: [Id, Id[]][] = [];
  for (const question of shown) {
    const order = optionOrderFor(question, settings.shuffleOptions, random);
    if (order !== undefined) optionOrder.push([question.id, order]);
  }
  // Object.fromEntries defines own properties, so even an id like "__proto__" is stored safely.
  return {
    attemptId,
    seed,
    questionIds: shown.map((q) => q.id),
    optionOrder: Object.fromEntries(optionOrder),
  };
}

/**
 * True when `plan` is exactly what `planAttempt` gives for its own seed and attempt id, so a server
 * can reject a plan that was edited to pick easier questions or to unshuffle options.
 */
export function isPlanFor(quiz: QuizLesson, plan: AttemptPlan): boolean {
  const expected = planAttempt(quiz, plan.seed, plan.attemptId);
  const actualKeys = Object.keys(plan.optionOrder);
  return (
    sameIds(expected.questionIds, plan.questionIds) &&
    actualKeys.length === Object.keys(expected.optionOrder).length &&
    Object.entries(expected.optionOrder).every(
      ([id, order]) =>
        actualKeys.includes(id) && sameIds(order, ownValue(plan.optionOrder, id) ?? []),
    )
  );
}

function optionOrderFor(
  question: Question,
  shuffleOptions: boolean,
  random: Random,
): Id[] | undefined {
  switch (question.type) {
    case 'single_choice':
    case 'multiple_choice':
      return shuffleOptions
        ? shuffle(
            question.options.map((o) => o.id),
            random,
          )
        : undefined;
    case 'matching':
    case 'drag_matching':
      return shuffleOptions
        ? shuffleAwayFromListed(
            question.pairs.map((p) => p.id),
            random,
          )
        : undefined;
    case 'ordering':
      return shuffleAwayFromListed(
        question.items.map((i) => i.id),
        random,
      );
    case 'true_false':
    case 'fill_blank':
    case 'hotspot':
      return undefined;
  }
}

/**
 * A shuffle that never equals the listed order (for 2 or more distinct ids), uniform over the
 * others.
 */
function shuffleAwayFromListed(ids: readonly Id[], random: Random): Id[] {
  if (ids.length < 2) return [...ids];
  for (let attempt = 0; attempt < MAX_RESHUFFLES; attempt++) {
    const order = shuffle(ids, random);
    if (!sameIds(order, ids)) return order;
  }
  return [...ids.slice(1), ...ids.slice(0, 1)];
}

function sameIds(a: readonly Id[], b: readonly Id[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}
