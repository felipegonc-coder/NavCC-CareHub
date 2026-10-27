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
   * Display order by question id: choice option ids (only when `shuffleOptions`), and the
   * matching/drag-matching right-hand list (as pair ids) and ordering item ids (always). Other
   * questions have no entry.
   */
  optionOrder: Record<Id, Id[]>;
};

/**
 * Plans a quiz attempt. Draws `poolSize` of the lesson's own questions (all when unset), then
 * `count` more from each bank draw's published snapshot (drafts without a snapshot add none; a
 * question id is never planned twice). Without `shuffleQuestions` the order is the lesson's
 * questions, then each draw, in their listed order. Records option orders: choice options when
 * `shuffleOptions`; matching and drag-matching right-hand lists and ordering items always, because
 * in their listed order they would give the answer away. Every order is a plain uniform shuffle
 * (the listed order included), so the order a learner sees says nothing about the answer.
 * True/false, fill-in and hotspot questions have no option order. Deterministic: the same quiz,
 * seed and attempt id always give the same plan.
 */
export function planAttempt(quiz: QuizLesson, seed: number, attemptId: Id): AttemptPlan {
  const { settings } = quiz;
  const random = mulberry32(seed);
  // `sample` clamps the count to 0..eligible.length (NaN draws none).
  const drawn = drawQuestions(quiz, (eligible, count) =>
    sample(eligible, count, random, { keepOrder: true }),
  );
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
 * How many questions each attempt of `quiz` shows, as `planAttempt` draws them: `poolSize` of the
 * lesson's own questions (all when unset) plus `count` from each bank draw's snapshot. The same for
 * every seed, since question ids are unique within a quiz lesson.
 */
export function plannedQuestionCount(quiz: QuizLesson): number {
  return drawQuestions(quiz, (eligible, count) => eligible.slice(0, Math.max(0, count))).length;
}

/**
 * The questions of one attempt, before any shuffle: `pick` chooses `count` of the eligible
 * questions of the lesson (`poolSize`, all when unset) and then of each bank draw's snapshot (its
 * `count`). Drafts without a snapshot add none, and a question id is never drawn twice.
 */
function drawQuestions(
  quiz: QuizLesson,
  pick: (eligible: Question[], count: number) => Question[],
): Question[] {
  const planned = new Set<Id>();
  const take = (pool: readonly Question[], requested: number | undefined): Question[] => {
    const eligible: Question[] = [];
    for (const question of pool) {
      if (!planned.has(question.id) && !eligible.some((q) => q.id === question.id))
        eligible.push(question);
    }
    const drawn = pick(eligible, requested ?? eligible.length);
    for (const question of drawn) planned.add(question.id);
    return drawn;
  };
  const drawn = take(quiz.questions, quiz.settings.poolSize);
  for (const draw of quiz.bankDraws ?? []) drawn.push(...take(draw.questions ?? [], draw.count));
  return drawn;
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
      return shuffle(
        question.pairs.map((p) => p.id),
        random,
      );
    case 'ordering':
      return shuffle(
        question.items.map((i) => i.id),
        random,
      );
    case 'true_false':
    case 'fill_blank':
    case 'hotspot':
      return undefined;
  }
}

function sameIds(a: readonly Id[], b: readonly Id[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}
