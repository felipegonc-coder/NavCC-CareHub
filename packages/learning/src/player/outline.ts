import type { Id } from '../format/index';
import type { PlayerCourse, PlayerLesson } from './course';
import { lessonHref } from './links';

/** A lesson's state in the outline. The progress module decides it; "locked" happens only when lessons are in order. */
export type OutlineLessonStatus = 'locked' | 'not_started' | 'in_progress' | 'completed';

/**
 * What the outline reads from the learner's progress: one entry per lesson. A lesson missing here (or no progress
 * at all, as in a fresh preview) is locked when lessons are in order and an earlier lesson isn't completed, and
 * not started otherwise.
 */
export type OutlineProgress = { lessons: readonly { lessonId: Id; status: OutlineLessonStatus }[] };

/** One row of the outline sidebar (or the phone menu). */
export type OutlineRow = {
  lessonId: Id;
  /** Position in the course, counting from 1. */
  number: number;
  title: string;
  icon?: string;
  kind: PlayerLesson['kind'];
  status: OutlineLessonStatus;
  /** The status in plain words, for screen readers and tooltips. */
  statusText: string;
  /** True for the lesson that is open. */
  current: boolean;
  /** Why the lesson can't be opened yet, in plain words. Set only when the lesson is locked. */
  lockedReason?: string;
  href: string;
};

export type CourseOutline = { rows: OutlineRow[]; completed: number; total: number };

const STATUS_TEXT: Readonly<Record<OutlineLessonStatus, string>> = {
  locked: 'Locked',
  not_started: 'Not started',
  in_progress: 'In progress',
  completed: 'Completed',
};

/**
 * The outline of a course for one learner: every lesson in order with its state, whether it is open now and, for
 * locked lessons, the reason in plain words (for example `Finish "Escalations" first.`).
 */
export function courseOutline(
  course: Pick<PlayerCourse, 'id' | 'lessons' | 'settings'>,
  progress?: OutlineProgress | null,
  currentLessonId?: Id,
): CourseOutline {
  const known = new Map(
    (progress?.lessons ?? []).map((entry) => [entry.lessonId, entry.status] as const),
  );
  const inOrder = course.settings.lessonOrder === 'sequential';
  let firstUnfinished: PlayerLesson | undefined;
  let completed = 0;
  const rows = course.lessons.map((lesson, index): OutlineRow => {
    const blocker = firstUnfinished;
    const status = known.get(lesson.id) ?? (inOrder && blocker ? 'locked' : 'not_started');
    if (status === 'completed') completed += 1;
    else firstUnfinished ??= lesson;
    const lockedReason =
      status !== 'locked'
        ? undefined
        : inOrder && blocker
          ? `Finish "${blocker.title}" first.`
          : "This lesson isn't open yet.";
    return {
      lessonId: lesson.id,
      number: index + 1,
      title: lesson.title,
      ...(lesson.kind === 'content' && lesson.icon ? { icon: lesson.icon } : {}),
      kind: lesson.kind,
      status,
      statusText: STATUS_TEXT[status],
      current: lesson.id === currentLessonId,
      ...(lockedReason ? { lockedReason } : {}),
      href: lessonHref(course.id, lesson.id),
    };
  });
  return { rows, completed, total: rows.length };
}

/** The lesson before `lessonId` in the course, for the Previous button; null for the first lesson or an unknown id. */
export function previousLessonId(course: Pick<PlayerCourse, 'lessons'>, lessonId: Id): Id | null {
  const index = course.lessons.findIndex((lesson) => lesson.id === lessonId);
  return index > 0 ? (course.lessons[index - 1]?.id ?? null) : null;
}
