import type { Course, Id, IsoDateTime } from '../format/index';
import { planAttempt, type AttemptPlan } from '../quiz/index';
import { reduceProgress } from './reduce';
import type { ProgressEvent } from './schema';
import type { LearnerCourseState, RejectedEvent } from './types';

type QuizStartEvent = Extract<ProgressEvent, { type: 'quiz_attempt_started' }>;
type QuizSubmitEvent = Extract<ProgressEvent, { type: 'quiz_attempt_submitted' }>;

/** What POST /courses/:id/quizzes/:lessonId/attempts does for one learner (quizAttemptStart). */
export type QuizAttemptStart =
  /** An attempt is open: send its paper again. */
  | { kind: 'resume'; plan: AttemptPlan; startedAt: IsoDateTime }
  /** Store `event`, then send the paper for `event.plan`. */
  | { kind: 'start'; event: QuizStartEvent }
  /** Nothing starts; `rejection` says why. */
  | { kind: 'refused'; rejection: RejectedEvent };

/** `at`, or 1 ms after the latest of `events` when that is later. */
function afterEvents(at: IsoDateTime, events: readonly { at: string }[]): IsoDateTime {
  let time = Date.parse(at);
  for (const event of events) {
    const stored = Date.parse(event.at);
    if (Number.isFinite(stored) && stored >= time) time = stored + 1;
  }
  return new Date(time).toISOString();
}

/**
 * Starts a quiz attempt on the server, so a browser never makes its own plan. An open attempt is
 * resumed, so a reload or a retried request gets the same paper. Otherwise the attempt is planned
 * with the server's `seed`, and its quiz_attempt_started event is timed at the browser's clock
 * (`at`), or 1 ms after the learner's latest stored event when that is later: it sorts after
 * everything already counted, even when another device's clock runs ahead. The event is checked by
 * replaying it after `stored`, so the rules are the reducer's (unknown_lesson, wrong_lesson_kind,
 * locked, no_attempts_left, ...).
 */
export function quizAttemptStart(
  course: Course,
  stored: readonly ProgressEvent[],
  input: { lessonId: Id; attemptId: Id; eventId: Id; seed: number; at: IsoDateTime },
): QuizAttemptStart {
  const state = reduceProgress(course, stored);
  const open = state.quizzes.find((quiz) => quiz.lessonId === input.lessonId)?.openAttempt;
  if (open) return { kind: 'resume', plan: open.plan, startedAt: open.startedAt };
  const at = afterEvents(input.at, stored);
  const lesson = course.lessons.find((candidate) => candidate.id === input.lessonId);
  if (lesson?.kind !== 'quiz') {
    const reason = lesson ? 'wrong_lesson_kind' : 'unknown_lesson';
    return {
      kind: 'refused',
      rejection: { eventId: input.eventId, type: 'quiz_attempt_started', at, reason },
    };
  }
  const event: QuizStartEvent = {
    id: input.eventId,
    at,
    type: 'quiz_attempt_started',
    lessonId: lesson.id,
    plan: planAttempt(lesson, input.seed, input.attemptId),
  };
  const replayed = reduceProgress(course, [...stored, event]);
  const rejection = replayed.rejected.find((entry) => entry.eventId === event.id);
  return rejection ? { kind: 'refused', rejection } : { kind: 'start', event };
}

/**
 * When to store a browser's quiz_attempt_submitted: its own `at`, or 1 ms after its open attempt
 * started when the browser's clock is behind that (quizAttemptStart may start an attempt later than
 * the browser's clock). `state` is the learner's state before the submission.
 */
export function quizSubmissionTime(
  state: LearnerCourseState,
  submission: Pick<QuizSubmitEvent, 'lessonId' | 'attemptId' | 'at'>,
): IsoDateTime {
  const quiz = state.quizzes.find((candidate) => candidate.lessonId === submission.lessonId);
  const open = quiz?.openAttempt;
  if (!open || open.plan.attemptId !== submission.attemptId) return submission.at;
  return afterEvents(submission.at, [{ at: open.startedAt }]);
}
