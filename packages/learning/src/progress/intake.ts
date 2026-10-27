import type { Course, IsoDateTime } from '../format/index';
import {
  MAX_EVENTS_PER_LEARNER_COURSE,
  progressEventsReply,
  type ProgressEventsResponse,
} from './api';
import { quizSubmissionTime } from './attempts';
import { checkProgressEvents, reduceProgress } from './reduce';
import type { ProgressEvent } from './schema';

/** The 422 message when storing a batch would go past MAX_EVENTS_PER_LEARNER_COURSE. */
export const TOO_MANY_EVENTS_MESSAGE =
  "Care Hub can't save more progress for this course. Ask a trainer to reset your progress.";

/** What POST /courses/:id/events does with one batch (see progressIntake). */
export type ProgressIntake =
  /** Store `events` (there may be none), then send `reply`. */
  | { kind: 'store'; events: ProgressEvent[]; reply: ProgressEventsResponse }
  /** Store nothing and answer 422 with `message`. */
  | { kind: 'too_many'; message: string };

/**
 * One browser batch for POST /courses/:id/events, given the stored events of the learner's
 * current run, the server's clock (`now`) and when that run began (`runStartedAt`, null for a
 * first run). The events to store leave out refused ones (checkProgressEvents) and ids already
 * stored or repeated in the batch, so a batch sent again stores nothing new. Each quiz_attempt_submitted is timed after its attempt's server-made start
 * (quizSubmissionTime). The reply's state is reduced from the stored events and the new ones, and
 * its refusals cover every event of the batch. too_many when the new events would take the course
 * past MAX_EVENTS_PER_LEARNER_COURSE.
 */
export function progressIntake(
  course: Course,
  stored: readonly ProgressEvent[],
  batch: readonly unknown[],
  now: IsoDateTime,
  runStartedAt: IsoDateTime | null = null,
): ProgressIntake {
  const checked = checkProgressEvents(batch, now, runStartedAt);
  const seen = new Set(stored.map((event) => event.id));
  const fresh: ProgressEvent[] = [];
  for (const event of checked.valid) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    fresh.push(event);
  }
  if (stored.length + fresh.length > MAX_EVENTS_PER_LEARNER_COURSE) {
    return { kind: 'too_many', message: TOO_MANY_EVENTS_MESSAGE };
  }
  const submits = fresh.some((event) => event.type === 'quiz_attempt_submitted');
  const before = submits ? reduceProgress(course, stored) : null;
  const events = fresh.map((event) =>
    before && event.type === 'quiz_attempt_submitted'
      ? { ...event, at: quizSubmissionTime(before, event) }
      : event,
  );
  const state = reduceProgress(course, [...stored, ...events]);
  return { kind: 'store', events, reply: progressEventsReply(state, checked) };
}
