import { z } from 'zod';
import { IdSchema, IsoDateTimeSchema, LIMITS, QuestionResponseSchema } from '../format/index';

/** Most questions one attempt can hold: the lesson's own questions plus every bank draw. */
const MAX_ATTEMPT_QUESTIONS = LIMITS.questions + LIMITS.bankDraws * LIMITS.bankDrawCount;
/** Generous bounds that only keep payloads small; isPlanFor checks the plan itself. */
const MAX_ORDERED_IDS = 50;
const MAX_SCENARIO_CHOICES = 1_000;

const atMostKeys = (max: number) => (record: Record<string, unknown>) =>
  Object.keys(record).length <= max;

const AttemptPlanEventSchema = z.strictObject({
  attemptId: IdSchema,
  seed: z.number().int(),
  questionIds: z.array(IdSchema).max(MAX_ATTEMPT_QUESTIONS),
  optionOrder: z
    .record(IdSchema, z.array(IdSchema).max(MAX_ORDERED_IDS))
    .refine(atMostKeys(MAX_ATTEMPT_QUESTIONS), { error: 'Too many questions in the plan.' }),
});

const base = { id: IdSchema, at: IsoDateTimeSchema };
const inLesson = { ...base, lessonId: IdSchema };
const inBlock = { ...inLesson, blockId: IdSchema };
const event = <T extends string, S extends z.ZodRawShape>(type: T, shape: S) =>
  z.strictObject({ type: z.literal(type), ...shape });

/**
 * One thing a learner did, sent by the player. `id` is made by the client and used to drop
 * duplicates; `at` is when it happened. The server re-checks everything (see reduceProgress).
 */
export const ProgressEventSchema = z.discriminatedUnion('type', [
  event('lesson_opened', inLesson),
  /** Active time since the last time_active event; each event counts for 1 to 60 seconds. */
  event('time_active', { ...inLesson, seconds: z.number().positive() }),
  /** A continue, process, flashcards or sorting block was finished. */
  event('block_completed', inBlock),
  event('knowledge_check_answered', { ...inBlock, response: QuestionResponseSchema }),
  /** Every choice made, from the start scene to an ending or a lesson jump. */
  event('scenario_finished', {
    ...inBlock,
    choiceIds: z.array(IdSchema).max(MAX_SCENARIO_CHOICES),
  }),
  event('lesson_completed', inLesson),
  event('quiz_attempt_started', { ...inLesson, plan: AttemptPlanEventSchema }),
  event('quiz_attempt_submitted', {
    ...inLesson,
    attemptId: IdSchema,
    responses: z
      .record(IdSchema, QuestionResponseSchema)
      .refine(atMostKeys(MAX_ATTEMPT_QUESTIONS), { error: 'Too many answers.' }),
  }),
  event('acknowledged', { ...base, statement: z.string().max(LIMITS.shortText) }),
]);

export type ProgressEvent = z.infer<typeof ProgressEventSchema>;
export type ProgressEventType = ProgressEvent['type'];

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** What a block view emits; the player adds `id` and `at`. */
export type NewProgressEvent = DistributiveOmit<ProgressEvent, 'id' | 'at'>;
