import {
  DEFAULT_ACKNOWLEDGEMENT,
  lessonHref,
  playerLabels,
  type CourseOutline,
  type IsoDateTime,
  type LearnerCourseState,
  type PlayerCourse,
} from '@carehub/learning';

// What the course start page says about the learner's place in a course, and where its button goes.

/** The start page's button: its words and the lesson it opens. */
export type StartAction = { label: string; href: string };

const FINISHED: ReadonlySet<LearnerCourseState['status']> = new Set([
  'completed',
  'passed',
  'failed',
]);

/** Whether the learner has begun: the server says so, or a lesson they opened is being sent. */
export function hasStarted(state: LearnerCourseState, outline: CourseOutline): boolean {
  return (
    state.status !== 'not_started' ||
    outline.rows.some((row) => row.status === 'in_progress' || row.status === 'completed')
  );
}

/** Finished, or every lesson done with only the sign-off or the course's minimum time left. */
const isDone = (state: LearnerCourseState, outline: CourseOutline) =>
  FINISHED.has(state.status) || outline.rows.every((row) => row.status === 'completed');

/**
 * The start page's button. Before the course: the course's "start" label, to the first lesson. Part
 * way: its "continue" label, to where the learner stopped (the resume point, else the first lesson
 * not done yet). Once finished, or once every lesson is done and only the sign-off or the course's
 * minimum time is left: back to the first lesson, to look through it again. Null for a course
 * without lessons.
 */
export function startAction(
  course: Pick<PlayerCourse, 'id' | 'lessons' | 'settings'>,
  state: LearnerCourseState,
  outline: CourseOutline,
): StartAction | null {
  const first = outline.rows[0];
  if (!first) return null;
  const labels = playerLabels(course);
  if (isDone(state, outline)) return { label: 'Review the course', href: first.href };
  if (!hasStarted(state, outline)) return { label: labels.start, href: first.href };
  const resume = state.resume;
  if (resume && course.lessons.some((lesson) => lesson.id === resume.lessonId)) {
    return { label: labels.continue, href: lessonHref(course.id, resume.lessonId, resume.blockId) };
  }
  const next = outline.rows.find(
    (row) => row.status === 'in_progress' || row.status === 'not_started',
  );
  return { label: labels.continue, href: (next ?? first).href };
}

/**
 * Router state for a link that opens a course where the learner stopped: My learning's courses in
 * progress. The start page sends them on to the lesson.
 */
export const RESUME_STATE = { resume: true } as const;

/** Whether the start page was opened with `RESUME_STATE`. */
export function wantsResume(routerState: unknown): boolean {
  return (
    typeof routerState === 'object' &&
    routerState !== null &&
    (routerState as { resume?: unknown }).resume === true
  );
}

/**
 * Where the learner stopped (the lesson, and the block when the server knows it) while they are
 * part way through the course; null before they begin and once it's done, when the start page
 * shows instead.
 */
export function resumeHref(
  course: Pick<PlayerCourse, 'id' | 'lessons' | 'settings'>,
  state: LearnerCourseState,
  outline: CourseOutline,
): string | null {
  if (isDone(state, outline) || !hasStarted(state, outline)) return null;
  return startAction(course, state, outline)?.href ?? null;
}

/** The learner's place in a few words, such as "In progress · 40% done" or "Passed · score 90%". */
export function statusLine(state: LearnerCourseState, percent: number, started: boolean): string {
  const score = state.score === null ? '' : ` · score ${Math.round(state.score)}%`;
  switch (state.status) {
    case 'completed':
      return 'Completed';
    case 'passed':
      return `Passed${score}`;
    case 'failed':
      return `Not passed${score}`;
    default:
      return started ? `In progress · ${percent}% done` : 'Not started';
  }
}

/** A course's "I have read and understood" sign-off, as the learner sees it. */
export type SignOff = {
  statement: string;
  /** Every content lesson is completed, so the learner can sign (quiz lessons don't count). */
  ready: boolean;
  signedAt: IsoDateTime | null;
};

/** The course's sign-off, or null when it doesn't ask for one. */
export function signOff(
  course: Pick<PlayerCourse, 'lessons' | 'settings'>,
  state: Pick<LearnerCourseState, 'lessons' | 'acknowledgedAt'>,
): SignOff | null {
  const { completion, acknowledgement } = course.settings;
  if (!completion.requireAcknowledgement) return null;
  const completed = new Set(
    state.lessons.filter((entry) => entry.status === 'completed').map((entry) => entry.lessonId),
  );
  return {
    statement: acknowledgement?.statement ?? DEFAULT_ACKNOWLEDGEMENT,
    ready: course.lessons.every((lesson) => lesson.kind !== 'content' || completed.has(lesson.id)),
    signedAt: state.acknowledgedAt,
  };
}

/**
 * When every lesson is done but the course isn't finished: what is left, either the course's
 * minimum time (how much of it) or the sign-off. Null otherwise.
 */
export function almostDoneLine(
  course: Pick<PlayerCourse, 'settings'>,
  state: Pick<LearnerCourseState, 'status' | 'blockedBy' | 'activeSeconds'>,
  outline: Pick<CourseOutline, 'completed' | 'total'>,
  sign: SignOff | null,
): string | null {
  if (state.blockedBy === 'minimum_course_time') {
    const seconds = (course.settings.minimumCourseSeconds ?? 0) - state.activeSeconds;
    const minutes = Math.max(1, Math.ceil(seconds / 60));
    const left = minutes === 1 ? '1 more minute' : `${minutes} more minutes`;
    return `Almost done: spend ${left} in the lessons to finish the course.`;
  }
  const allDone = outline.total > 0 && outline.completed === outline.total;
  if (sign && !sign.signedAt && allDone && !FINISHED.has(state.status))
    return 'Almost done: sign below to finish the course.';
  return null;
}

/** A course's size in a few words: "4 lessons · About 20 minutes". */
export function courseFacts(lessonCount: number, minutes?: number): string {
  const facts = [lessonCount === 1 ? '1 lesson' : `${lessonCount} lessons`];
  if (minutes) facts.push(minutes === 1 ? 'About 1 minute' : `About ${minutes} minutes`);
  return facts.join(' · ');
}
