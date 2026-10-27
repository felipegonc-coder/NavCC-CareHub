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

/**
 * What a new live version does to one learner's run (decision 0311): `keep` stays on the version
 * it started on, `move` carries on in the new version with its events replayed, and `restart`
 * begins a new run on the new version (the server keeps the old events).
 */
export type CourseUpdateRun = 'keep' | 'move' | 'restart';

/** What a new live version of a course means for one learner. */
export type CourseUpdate = { run: CourseUpdateRun; notice: CourseUpdateNotice | null };

const FINISHED: ReadonlySet<LearnerCourseState['status']> = new Set([
  'completed',
  'passed',
  'failed',
]);

/**
 * What happens to one learner's run when a course gets a new live version (decision 0311).
 * `none`: nobody moves. `tell`: a run in progress moves to the new version and the learner gets a
 * "this course changed" alert; a finished run (completed, passed or failed) keeps its version and
 * result, with no notice. `retake`: everyone who started, finished or not, begins a new run and
 * gets a reminder to take the course again. A run with nothing counted yet (not started) just
 * moves, with no notice, whatever `notify` says. `note`, the author's message to learners, ends
 * the notice text when it isn't blank.
 */
export function courseUpdateFor(
  notify: CourseUpdateNotify,
  learner: Pick<LearnerCourseState, 'status'>,
  course: { id: Id; title: string; note?: string | undefined },
): CourseUpdate {
  if (learner.status === 'not_started') return { run: 'move', notice: null };
  if (notify === 'none' || (notify === 'tell' && FINISHED.has(learner.status))) {
    return { run: 'keep', notice: null };
  }
  const note = course.note?.trim() ? ` ${course.note.trim()}` : '';
  const buttons = [
    { label: 'Open course', href: `/learning/courses/${encodeURIComponent(course.id)}` },
  ];
  if (notify === 'tell') {
    const text = `“${course.title}” has changed. Your progress is kept.${note}`;
    return { run: 'move', notice: { kind: 'alert', title: 'Course updated', text, buttons } };
  }
  const text = `“${course.title}” has changed. Please take it again.${note}`;
  return {
    run: 'restart',
    notice: { kind: 'reminder', title: 'Please take this course again', text, buttons },
  };
}

/** Someone with learning.assign marked the course complete for the learner, at `at` (0312). */
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
