import { z } from 'zod';
import { IdSchema, ImageSchema, LIMITS, RichTextSchema } from './primitives';
import { percent, text } from './zod-helpers';

// ---------- Questions (8 types) ----------

// Spread after `id` and `type`, so stored questions read id, type, prompt, ...
const questionBase = {
  prompt: RichTextSchema,
  image: ImageSchema.optional(),
  points: z.number().int().min(1).max(LIMITS.questionPoints).default(1),
  feedback: z
    .strictObject({ correct: RichTextSchema.optional(), incorrect: RichTextSchema.optional() })
    .optional(),
};

export const ChoiceOptionSchema = z.strictObject({
  id: IdSchema,
  text: text(LIMITS.shortText),
  correct: z.boolean(),
  feedback: RichTextSchema.optional(),
});

export const MatchPairSchema = z.strictObject({
  id: IdSchema,
  prompt: text(LIMITS.shortText),
  match: text(LIMITS.shortText),
});

export const FillPartSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('text'), text: text(LIMITS.longText) }),
  z.strictObject({
    kind: z.literal('blank'),
    id: IdSchema,
    answers: z.array(text(LIMITS.blankAnswer)).max(LIMITS.blankAnswers),
    caseSensitive: z.boolean().optional(),
  }),
]);

export const HotspotSpotSchema = z.strictObject({
  id: IdSchema,
  shape: z.enum(['rect', 'ellipse']),
  x: percent(),
  y: percent(),
  width: percent(),
  height: percent(),
  correct: z.boolean(),
  label: text(LIMITS.title),
});

export const SingleChoiceQuestionSchema = z.strictObject({
  id: IdSchema,
  type: z.literal('single_choice'),
  ...questionBase,
  options: z.array(ChoiceOptionSchema).max(LIMITS.options),
});
export const MultipleChoiceQuestionSchema = z.strictObject({
  id: IdSchema,
  type: z.literal('multiple_choice'),
  ...questionBase,
  options: z.array(ChoiceOptionSchema).max(LIMITS.options),
});
export const TrueFalseQuestionSchema = z.strictObject({
  id: IdSchema,
  type: z.literal('true_false'),
  ...questionBase,
  answer: z.boolean(),
  feedbackTrue: RichTextSchema.optional(),
  feedbackFalse: RichTextSchema.optional(),
});
export const MatchingQuestionSchema = z.strictObject({
  id: IdSchema,
  type: z.literal('matching'),
  ...questionBase,
  pairs: z.array(MatchPairSchema).max(LIMITS.pairs),
});
export const DragMatchingQuestionSchema = z.strictObject({
  id: IdSchema,
  type: z.literal('drag_matching'),
  ...questionBase,
  pairs: z.array(MatchPairSchema).max(LIMITS.pairs),
});
export const FillBlankQuestionSchema = z.strictObject({
  id: IdSchema,
  type: z.literal('fill_blank'),
  ...questionBase,
  parts: z.array(FillPartSchema).max(LIMITS.fillParts),
});
export const OrderingQuestionSchema = z.strictObject({
  id: IdSchema,
  type: z.literal('ordering'),
  ...questionBase,
  items: z
    .array(z.strictObject({ id: IdSchema, text: text(LIMITS.shortText) }))
    .max(LIMITS.orderingItems),
});
export const HotspotQuestionSchema = z.strictObject({
  id: IdSchema,
  type: z.literal('hotspot'),
  ...questionBase,
  image: ImageSchema,
  spots: z.array(HotspotSpotSchema).max(LIMITS.hotspotSpots),
});

export const QuestionSchema = z.discriminatedUnion('type', [
  SingleChoiceQuestionSchema,
  MultipleChoiceQuestionSchema,
  TrueFalseQuestionSchema,
  MatchingQuestionSchema,
  DragMatchingQuestionSchema,
  FillBlankQuestionSchema,
  OrderingQuestionSchema,
  HotspotQuestionSchema,
]);

/** The 8 question types, in the order of the format doc. */
export const QUESTION_TYPES = [
  'single_choice',
  'multiple_choice',
  'true_false',
  'matching',
  'drag_matching',
  'fill_blank',
  'ordering',
  'hotspot',
] as const satisfies readonly z.infer<typeof QuestionSchema>['type'][];

// ---------- Learner answers (stored in progress events and quiz attempts) ----------

function atMostKeys(max: number) {
  return (record: Record<string, unknown>) => Object.keys(record).length <= max;
}

export const QuestionResponseSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('single_choice'), optionId: IdSchema }),
  z.strictObject({
    type: z.literal('multiple_choice'),
    optionIds: z.array(IdSchema).max(LIMITS.options),
  }),
  z.strictObject({ type: z.literal('true_false'), value: z.boolean() }),
  z.strictObject({
    type: z.enum(['matching', 'drag_matching']),
    matches: z
      .record(IdSchema, IdSchema)
      .refine(atMostKeys(LIMITS.pairs), { error: `At most ${LIMITS.pairs} matches.` }),
  }),
  z.strictObject({
    type: z.literal('fill_blank'),
    blanks: z
      .record(IdSchema, text(LIMITS.blankResponse))
      .refine(atMostKeys(LIMITS.fillParts), { error: `At most ${LIMITS.fillParts} blanks.` }),
  }),
  z.strictObject({
    type: z.literal('ordering'),
    order: z.array(IdSchema).max(LIMITS.orderingItems),
  }),
  z.strictObject({
    type: z.literal('hotspot'),
    pick: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('point'), x: percent(), y: percent() }),
      z.strictObject({ kind: z.literal('spot'), spotId: IdSchema }),
    ]),
  }),
]);

export type ChoiceOption = z.infer<typeof ChoiceOptionSchema>;
export type MatchPair = z.infer<typeof MatchPairSchema>;
export type FillPart = z.infer<typeof FillPartSchema>;
export type HotspotSpot = z.infer<typeof HotspotSpotSchema>;
export type SingleChoiceQuestion = z.infer<typeof SingleChoiceQuestionSchema>;
export type MultipleChoiceQuestion = z.infer<typeof MultipleChoiceQuestionSchema>;
export type TrueFalseQuestion = z.infer<typeof TrueFalseQuestionSchema>;
export type MatchingQuestion = z.infer<typeof MatchingQuestionSchema>;
export type DragMatchingQuestion = z.infer<typeof DragMatchingQuestionSchema>;
export type FillBlankQuestion = z.infer<typeof FillBlankQuestionSchema>;
export type OrderingQuestion = z.infer<typeof OrderingQuestionSchema>;
export type HotspotQuestion = z.infer<typeof HotspotQuestionSchema>;
export type Question = z.infer<typeof QuestionSchema>;
export type QuestionType = Question['type'];
export type QuestionResponse = z.infer<typeof QuestionResponseSchema>;
