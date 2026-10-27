import {
  lessonHref,
  playerLabels,
  type Course,
  type CourseOutline,
  type LearnerCourseState,
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

/**
 * The start page's button. Before the course: the course's "start" label, to the first lesson. Part
 * way: its "continue" label, to where the learner stopped (the resume point, else the first lesson
 * not done yet). Once finished: back to the first lesson, to look through it again. Null for a
 * course without lessons.
 */
export function startAction(
  course: Pick<Course, 'id' | 'lessons' | 'settings'>,
  state: LearnerCourseState,
  outline: CourseOutline,
): StartAction | null {
  const first = outline.rows[0];
  if (!first) return null;
  const labels = playerLabels(course);
  if (FINISHED.has(state.status)) return { label: 'Review the course', href: first.href };
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

/** When everything else is done but the course's minimum time isn't spent yet: how much is left. */
export function timeLeftLine(
  course: Pick<Course, 'settings'>,
  state: Pick<LearnerCourseState, 'blockedBy' | 'activeSeconds'>,
): string | null {
  if (state.blockedBy !== 'minimum_course_time') return null;
  const seconds = (course.settings.minimumCourseSeconds ?? 0) - state.activeSeconds;
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  const left = minutes === 1 ? '1 more minute' : `${minutes} more minutes`;
  return `Almost done: spend ${left} in the lessons to finish the course.`;
}

/** A course's size in a few words: "4 lessons · About 20 minutes". */
export function courseFacts(lessonCount: number, minutes?: number): string {
  const facts = [lessonCount === 1 ? '1 lesson' : `${lessonCount} lessons`];
  if (minutes) facts.push(minutes === 1 ? 'About 1 minute' : `About ${minutes} minutes`);
  return facts.join(' · ');
}
