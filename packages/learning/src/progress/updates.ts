import type { Id, IsoDateTime } from '../format/index';
import type { LearnerCourseState } from './types';

/** The publish request's `notify` option: no notice, "this course changed", or "take it again". */
export type CourseUpdateNotify = 'none' | 'tell' | 'retake';

/** A course update notice; the server adds workspaceId, userId and sender. */
export type CourseUpdateNotice = {
  kind: 'reminder' | 'alert';
  title: string;
  text: string;
  buttons: { label: string; href: string }[];
};

/** What a new live version of a course means for one learner. */
export type CourseUpdate = {
  /** Their progress starts over on the new version (the server keeps the old events). */
  restart: boolean;
  notice: CourseUpdateNotice | null;
};

/**
 * What happens for one learner when a course gets a new live version. Only learners who have
 * started the course are affected. `tell` keeps their progress and sends a "this course changed"
 * alert. `retake` starts their progress over and sends a reminder to take the course again. `none`
 * does neither. `note`, the author's message to learners, ends the notice text when it isn't blank.
 */
export function courseUpdateFor(
  notify: CourseUpdateNotify,
  learner: Pick<LearnerCourseState, 'status'>,
  course: { id: Id; title: string; note?: string | undefined },
): CourseUpdate {
  if (notify === 'none' || learner.status === 'not_started') {
    return { restart: false, notice: null };
  }
  const note = course.note?.trim() ? ` ${course.note.trim()}` : '';
  const buttons = [
    { label: 'Open course', href: `/learning/courses/${encodeURIComponent(course.id)}` },
  ];
  if (notify === 'tell') {
    const text = `“${course.title}” has a new version. Your progress is kept.${note}`;
    return { restart: false, notice: { kind: 'alert', title: 'Course updated', text, buttons } };
  }
  const again = 'so your progress starts over. Please take it again.';
  const text = `“${course.title}” has a new version, ${again}${note}`;
  return {
    restart: true,
    notice: { kind: 'reminder', title: 'Please take this course again', text, buttons },
  };
}

/** Someone with learning.analytics marked the course complete for the learner, at `at`. */
export type ManualCompletion = { at: IsoDateTime };

/**
 * The learner's state with a manual completion (POST .../complete) on top, or `state` itself when
 * there is none or the learner had already completed or passed by then. Otherwise the course is
 * completed at `at`, even after a failed quiz, with 100% done and nothing to resume; a later finish
 * by the learner doesn't move that date, so it never earns a second certificate. Lessons, quizzes
 * and the score stay as the learner left them.
 */
export function withManualCompletion(
  state: LearnerCourseState,
  completion: ManualCompletion | null,
): LearnerCourseState {
  if (completion === null) return state;
  const finishedBefore =
    (state.status === 'completed' || state.status === 'passed') &&
    state.completedAt !== null &&
    Date.parse(state.completedAt) <= Date.parse(completion.at);
  if (finishedBefore) return state;
  return {
    ...state,
    status: 'completed',
    blockedBy: null,
    completedAt: completion.at,
    percentComplete: 100,
    resume: null,
  };
}
