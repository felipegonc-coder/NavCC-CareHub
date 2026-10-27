import { z } from 'zod';
import {
  CourseStatusSchema,
  IdSchema,
  IsoDateTimeSchema,
  LIMITS,
  QuestionResponseSchema,
  RichTextSchema,
} from '../format/index';
import type { CheckedProgressEvents } from './reduce';
import type { LearnerCourseState, ProgressRejectReason } from './types';

// Request and response schemas for the progress endpoints (docs/learning/api.md). The response
// schemas mirror LearnerCourseState so the player can check what the server sends.

/** Most events one POST /courses/:id/events may carry. */
export const MAX_EVENTS_PER_REQUEST = 200;

/**
 * POST /courses/:id/events. Events stay `unknown` here: the server checks each one on its own
 * (`checkProgressEvents`) and refuses a bad one as invalid_event instead of failing the batch.
 * The same event id sent twice is stored once.
 */
export const ProgressEventsRequestSchema = z.strictObject({
  events: z.array(z.unknown()).min(1).max(MAX_EVENTS_PER_REQUEST),
});
export type ProgressEventsRequest = z.infer<typeof ProgressEventsRequestSchema>;

/** POST /people/:personId/courses/:courseId/reset and .../complete (learning.analytics). */
export const ProgressNoteRequestSchema = z.strictObject({
  /** Why, for the record (e.g. "Finished the classroom version"). */
  note: z.string().trim().max(LIMITS.shortText).optional(),
});
export type ProgressNoteRequest = z.infer<typeof ProgressNoteRequestSchema>;

const REJECT_REASONS = [
  'invalid_event',
  'unknown_lesson',
  'unknown_block',
  'wrong_lesson_kind',
  'wrong_block_type',
  'locked',
  'hidden',
  'not_ready',
  'minimum_time',
  'continue_blocks',
  'bad_response',
  'already_answered',
  'bad_choices',
  'no_attempts_left',
  'attempt_open',
  'invalid_plan',
  'unknown_attempt',
  'not_required',
  'bad_statement',
] as const satisfies readonly ProgressRejectReason[];

/** Read straight from what was sent, cut to 100 characters, so not always a valid id or time. */
const rawText = z.string().max(100).nullable();
const seconds = z.number().min(0);
const percent = z.number().min(0).max(100);

const RejectedEventSchema = z.strictObject({
  eventId: rawText,
  type: rawText,
  at: rawText,
  reason: z.enum(REJECT_REASONS),
  secondsLeft: seconds.optional(),
  blockIds: z.array(IdSchema).optional(),
  lessonIds: z.array(IdSchema).optional(),
});

const LessonProgressSchema = z.strictObject({
  lessonId: IdSchema,
  status: z.enum(['locked', 'not_started', 'in_progress', 'completed']),
  activeSeconds: seconds,
  completedBlockIds: z.array(IdSchema),
  minimumMet: z.boolean(),
  lastOpenedAt: IsoDateTimeSchema.nullable(),
  completedAt: IsoDateTimeSchema.nullable(),
});

const AttemptPlanSchema = z.strictObject({
  attemptId: IdSchema,
  seed: z.number().int(),
  questionIds: z.array(IdSchema),
  optionOrder: z.record(IdSchema, z.array(IdSchema)),
});

const QuestionResultSchema = z.strictObject({
  questionId: IdSchema,
  answered: z.boolean(),
  correct: z.boolean(),
  earned: z.number().min(0),
  max: z.number().min(0),
  fraction: z.number().min(0).max(1),
  feedback: RichTextSchema.nullable(),
  /** Option ids, "true"/"false", or "" for an unmatched pair (see scoreQuestion). */
  picked: z.array(z.string()),
});

const QuizAttemptRecordSchema = z.strictObject({
  attemptId: IdSchema,
  plan: AttemptPlanSchema,
  startedAt: IsoDateTimeSchema,
  submittedAt: IsoDateTimeSchema,
  responses: z.record(IdSchema, QuestionResponseSchema),
  result: z.strictObject({
    attemptId: IdSchema,
    results: z.array(QuestionResultSchema),
    earned: z.number().min(0),
    max: z.number().min(0),
    percent,
    passed: z.boolean(),
  }),
});

const QuizProgressSchema = z.strictObject({
  lessonId: IdSchema,
  mode: z.enum(['graded', 'survey']),
  attemptsUsed: z.number().int().min(0),
  attemptsRemaining: z.number().int().min(0).nullable(),
  bestPercent: percent.nullable(),
  passed: z.boolean(),
  canRetry: z.boolean(),
  revealAnswers: z.boolean(),
  failed: z.boolean(),
  attempts: z.array(QuizAttemptRecordSchema),
  openAttempt: z.strictObject({ plan: AttemptPlanSchema, startedAt: IsoDateTimeSchema }).nullable(),
});

const KnowledgeCheckProgressSchema = z.strictObject({
  lessonId: IdSchema,
  blockId: IdSchema,
  answers: z.number().int().min(1),
  firstCorrect: z.boolean(),
  response: QuestionResponseSchema,
  result: QuestionResultSchema,
  firstAnsweredAt: IsoDateTimeSchema,
  lastAnsweredAt: IsoDateTimeSchema,
});

const ScenarioProgressSchema = z.strictObject({
  lessonId: IdSchema,
  blockId: IdSchema,
  runs: z.number().int().min(1),
  /** Choice points can be negative, so scores can be too. */
  bestScore: z.number(),
  choiceIds: z.array(IdSchema),
  score: z.number(),
  maxScore: z.number(),
  passed: z.boolean().nullable(),
  outcome: z.enum(['great', 'okay', 'poor']).nullable(),
  lessonJump: IdSchema.nullable(),
  lastFinishedAt: IsoDateTimeSchema,
});

/** GET /courses/:id/progress: one learner's state on the live version (`reduceProgress`). */
export const LearnerCourseStateSchema = z.strictObject({
  courseId: IdSchema,
  status: CourseStatusSchema,
  blockedBy: z.literal('minimum_course_time').nullable(),
  startedAt: IsoDateTimeSchema.nullable(),
  completedAt: IsoDateTimeSchema.nullable(),
  lastActivityAt: IsoDateTimeSchema.nullable(),
  activeSeconds: seconds,
  percentComplete: z.number().int().min(0).max(100),
  lessons: z.array(LessonProgressSchema),
  quizzes: z.array(QuizProgressSchema),
  knowledgeChecks: z.array(KnowledgeCheckProgressSchema),
  scenarios: z.array(ScenarioProgressSchema),
  acknowledgedAt: IsoDateTimeSchema.nullable(),
  score: percent.nullable(),
  resume: z.strictObject({ lessonId: IdSchema, blockId: IdSchema.optional() }).nullable(),
  rejected: z.array(RejectedEventSchema),
});

/**
 * POST /courses/:id/events: the state after the batch and the events of this request that were
 * refused (`state.rejected` lists every refused event the learner ever sent).
 */
export const ProgressEventsResponseSchema = z.strictObject({
  state: LearnerCourseStateSchema,
  rejected: z.array(RejectedEventSchema),
});
export type ProgressEventsResponse = z.infer<typeof ProgressEventsResponseSchema>;

/**
 * Builds the POST /courses/:id/events reply. `checked` is the request's batch after
 * `checkProgressEvents`; `state` was reduced from every stored event, this batch's valid events
 * included. Refusals for events this request didn't send are left out.
 */
export function progressEventsReply(
  state: LearnerCourseState,
  checked: CheckedProgressEvents,
): ProgressEventsResponse {
  const sent = new Set(checked.valid.map((event) => event.id));
  const refused = state.rejected.filter(
    (rejection) => rejection.eventId !== null && sent.has(rejection.eventId),
  );
  return { state, rejected: [...checked.rejected, ...refused] };
}
