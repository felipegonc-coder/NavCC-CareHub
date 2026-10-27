import { z } from 'zod';
import {
  ChoiceOptionSchema,
  DragMatchingQuestionSchema,
  FillBlankQuestionSchema,
  FillPartSchema,
  HotspotQuestionSchema,
  HotspotSpotSchema,
  IdSchema,
  LIMITS,
  MatchPairSchema,
  MatchingQuestionSchema,
  MultipleChoiceQuestionSchema,
  OrderingQuestionSchema,
  SingleChoiceQuestionSchema,
  TrueFalseQuestionSchema,
  type Id,
  type Question,
  type QuestionResponse,
  type QuizLesson,
} from '../format/index';
import { ownValue } from '../questions/helpers';
import { normalizeAnswer } from '../questions/normalize';
import { isResponseFor } from '../questions/response';
import { questionsById } from './attempt';
import type { AttemptPlan } from './plan';

// What every paper question keeps of its question; feedback stays on the server.
const kept = { id: true, type: true, prompt: true, image: true, points: true } as const;

const PaperTextSchema = (text: z.ZodType<string>) => z.strictObject({ id: IdSchema, text });
const paperOptions = {
  options: z.array(ChoiceOptionSchema.pick({ id: true, text: true })).max(LIMITS.options),
};
const paperPairs = {
  /** The left-hand list, under the pair ids, in the listed order. */
  prompts: z.array(PaperTextSchema(MatchPairSchema.shape.prompt)).max(LIMITS.pairs),
  /** The right-hand list, shuffled, under per-attempt ids ("match-1", … in the order shown). */
  matches: z.array(PaperTextSchema(MatchPairSchema.shape.match)).max(LIMITS.pairs),
};
const PaperFillPartSchema = z.discriminatedUnion('kind', [
  FillPartSchema.options[0],
  z.strictObject({ kind: z.literal('blank'), id: IdSchema }),
]);

/**
 * One question of a quiz attempt as the learner gets it (decision 0302): what is needed to answer
 * and nothing that gives the answer away. Choice options lose `correct` and feedback, true/false
 * loses its answer, blanks lose their accepted answers, hotspot spots lose `correct`, and no
 * question keeps its feedback. Matching right-hand lists and ordering items come shuffled under
 * per-attempt ids ("match-1", "item-1", … in the order shown), so ids can't give the answer away
 * either. Answers use the paper's ids; `paperResponses` maps them back before scoring.
 */
export const QuizPaperQuestionSchema = z.discriminatedUnion('type', [
  SingleChoiceQuestionSchema.pick(kept).extend(paperOptions),
  MultipleChoiceQuestionSchema.pick(kept).extend(paperOptions),
  TrueFalseQuestionSchema.pick(kept),
  MatchingQuestionSchema.pick(kept).extend(paperPairs),
  DragMatchingQuestionSchema.pick(kept).extend(paperPairs),
  FillBlankQuestionSchema.pick(kept).extend({
    parts: z.array(PaperFillPartSchema).max(LIMITS.fillParts),
  }),
  OrderingQuestionSchema.pick(kept).extend({ items: OrderingQuestionSchema.shape.items }),
  HotspotQuestionSchema.pick(kept).extend({
    spots: z.array(HotspotSpotSchema.omit({ correct: true })).max(LIMITS.hotspotSpots),
  }),
]);

export type QuizPaperQuestion = z.infer<typeof QuizPaperQuestionSchema>;
type PaperFillPart = z.infer<typeof PaperFillPartSchema>;

/**
 * The question paper of one planned attempt: the plan's questions in plan order (each once; ids the
 * quiz doesn't have are skipped), with choice options, matching lists and ordering items in the
 * plan's order.
 */
export function quizPaper(quiz: QuizLesson, plan: AttemptPlan): QuizPaperQuestion[] {
  const byId = questionsById(quiz);
  const paper: QuizPaperQuestion[] = [];
  for (const id of new Set(plan.questionIds)) {
    const question = byId.get(id);
    if (question) paper.push(paperQuestion(question, ownValue(plan.optionOrder, id)));
  }
  return paper;
}

/**
 * Maps answers given on the paper of `plan` back to the quiz's own ids, for `scoreAttempt`. Keeps
 * one response per planned question that has one. Matching answers turn per-attempt match ids into
 * pair ids (unknown prompts and match ids are dropped, which leaves that pair unanswered), and
 * ordering answers turn item ids back (unknown ids are dropped). Other answers, and answers of the
 * wrong type (which score as unanswered), are kept as they are.
 */
export function paperResponses(
  quiz: QuizLesson,
  plan: AttemptPlan,
  responses: Readonly<Record<Id, QuestionResponse>>,
): Record<Id, QuestionResponse> {
  const byId = questionsById(quiz);
  const mapped: [Id, QuestionResponse][] = [];
  for (const id of new Set(plan.questionIds)) {
    const question = byId.get(id);
    const response = ownValue(responses, id);
    if (question && response)
      mapped.push([id, fromPaper(question, ownValue(plan.optionOrder, id), response)]);
  }
  // Object.fromEntries defines own properties, so no id can reach the prototype.
  return Object.fromEntries(mapped);
}

/**
 * The right answers to the paper of `plan` (decision 0316), written as answers on that paper:
 * matching and ordering answers use its per-attempt "match-…" and "item-…" ids, while choice option
 * and hotspot spot ids stay real. One answer per planned question, in plan order (ids the quiz
 * doesn't have are skipped), and each scores as right once `paperResponses` maps it back. Single
 * choice gets its first right option, multiple choice all of them, fill-in blanks their first
 * accepted answer that can match, hotspots their first right spot. A question nothing can answer
 * right (no right option, spot or usable accepted answer) gets none. Surveys have none at all. Only
 * for a submitted attempt, while `quizStatus(...).revealAnswers` is true.
 */
export function paperAnswerKey(quiz: QuizLesson, plan: AttemptPlan): Record<Id, QuestionResponse> {
  if (quiz.settings.mode === 'survey') return {};
  const byId = questionsById(quiz);
  const key: [Id, QuestionResponse][] = [];
  for (const id of new Set(plan.questionIds)) {
    const question = byId.get(id);
    const answer = question && rightAnswer(question, ownValue(plan.optionOrder, id));
    if (answer) key.push([id, answer]);
  }
  return Object.fromEntries(key);
}

function paperQuestion(question: Question, order: readonly Id[] | undefined): QuizPaperQuestion {
  const { id, prompt, image, points } = question;
  const head = { id, prompt, ...(image === undefined ? {} : { image }), points };
  switch (question.type) {
    case 'single_choice':
    case 'multiple_choice':
      return {
        ...head,
        type: question.type,
        options: inOrder(question.options, order).map((option) => ({
          id: option.id,
          text: option.text,
        })),
      };
    case 'true_false':
      return { ...head, type: question.type };
    case 'matching':
    case 'drag_matching':
      return {
        ...head,
        type: question.type,
        prompts: question.pairs.map((pair) => ({ id: pair.id, text: pair.prompt })),
        matches: inOrder(question.pairs, order).map((pair, index) => ({
          id: paperId('match', index),
          text: pair.match,
        })),
      };
    case 'fill_blank':
      return {
        ...head,
        type: question.type,
        parts: question.parts.map((part): PaperFillPart =>
          part.kind === 'text' ? { kind: 'text', text: part.text } : { kind: 'blank', id: part.id },
        ),
      };
    case 'ordering':
      return {
        ...head,
        type: question.type,
        items: inOrder(question.items, order).map((item, index) => ({
          id: paperId('item', index),
          text: item.text,
        })),
      };
    case 'hotspot':
      return {
        ...head,
        type: question.type,
        image: question.image,
        spots: question.spots.map((spot) => ({
          id: spot.id,
          shape: spot.shape,
          x: spot.x,
          y: spot.y,
          width: spot.width,
          height: spot.height,
          label: spot.label,
        })),
      };
  }
}

function fromPaper(
  question: Question,
  order: readonly Id[] | undefined,
  response: QuestionResponse,
): QuestionResponse {
  switch (question.type) {
    case 'matching':
    case 'drag_matching': {
      if (!isResponseFor(question, response)) return response;
      const pairIds = paperIds('match', inOrder(question.pairs, order));
      const prompts = new Set(question.pairs.map((pair) => pair.id));
      const matches = Object.entries(response.matches).flatMap(([promptId, matchId]) => {
        const pairId = pairIds.get(matchId);
        return prompts.has(promptId) && pairId !== undefined ? [[promptId, pairId] as const] : [];
      });
      return { type: response.type, matches: Object.fromEntries(matches) };
    }
    case 'ordering': {
      if (!isResponseFor(question, response)) return response;
      const itemIds = paperIds('item', inOrder(question.items, order));
      return {
        type: response.type,
        order: response.order.flatMap((paperItemId) => itemIds.get(paperItemId) ?? []),
      };
    }
    default:
      return response;
  }
}

function rightAnswer(
  question: Question,
  order: readonly Id[] | undefined,
): QuestionResponse | undefined {
  switch (question.type) {
    case 'single_choice': {
      const option = question.options.find((candidate) => candidate.correct);
      return option && { type: question.type, optionId: option.id };
    }
    case 'multiple_choice':
      return {
        type: question.type,
        optionIds: question.options.filter((option) => option.correct).map((option) => option.id),
      };
    case 'true_false':
      return { type: question.type, value: question.answer };
    case 'matching':
    case 'drag_matching': {
      const shown = inOrder(question.pairs, order);
      const matches = question.pairs.map((pair): [Id, Id] => [
        pair.id,
        paperId('match', shown.indexOf(pair)),
      ]);
      return { type: question.type, matches: Object.fromEntries(matches) };
    }
    case 'fill_blank': {
      const blanks: [Id, string][] = [];
      for (const part of question.parts) {
        if (part.kind === 'text') continue;
        const caseSensitive = part.caseSensitive === true;
        const answer = part.answers.find((text) => normalizeAnswer(text, caseSensitive) !== '');
        if (answer === undefined) return undefined;
        blanks.push([part.id, answer]);
      }
      return { type: question.type, blanks: Object.fromEntries(blanks) };
    }
    case 'ordering': {
      const shown = inOrder(question.items, order);
      return {
        type: question.type,
        order: question.items.map((item) => paperId('item', shown.indexOf(item))),
      };
    }
    case 'hotspot': {
      const spot = question.spots.find((candidate) => candidate.correct);
      return spot && { type: question.type, pick: { kind: 'spot', spotId: spot.id } };
    }
  }
}

/** `items` in `order` (each item once; unknown ids are skipped), then any it leaves out. */
function inOrder<T extends { id: Id }>(items: readonly T[], order: readonly Id[] = []): T[] {
  const placed = new Set<T>();
  for (const id of order) {
    const item = items.find((candidate) => candidate.id === id && !placed.has(candidate));
    if (item) placed.add(item);
  }
  return [...placed, ...items.filter((item) => !placed.has(item))];
}

/** Per-attempt ids: the position in the order shown, so they say nothing about the answer. */
function paperId(kind: 'match' | 'item', index: number): Id {
  return `${kind}-${index + 1}`;
}

/** Per-attempt id → the quiz's own id, for a list in the order shown. */
function paperIds(kind: 'match' | 'item', shown: readonly { id: Id }[]): Map<Id, Id> {
  return new Map(shown.map((entry, index) => [paperId(kind, index), entry.id]));
}
