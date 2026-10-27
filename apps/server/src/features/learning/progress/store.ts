import {
  reduceProgress,
  withManualCompletion,
  type Course,
  type LearnerCourseState,
  type ManualCompletion,
  type ProgressEvent,
} from '@carehub/learning';
import { and, eq } from 'drizzle-orm';
import type { Db, Tx } from '../../../db';
import { learningProgressEvents as events, learningProgress as progress } from './schema';

// Reading and saving progress rows, for the progress service.

/** A learner's progress row for one course. */
export type ProgressRow = typeof progress.$inferSelect;

/** One learner in one course. */
export type Learner = { workspaceId: string; learnerId: string; courseId: string };

/** The state columns of a progress row: what reports read without replaying events. */
export type ProgressSummary = Pick<
  ProgressRow,
  | 'status'
  | 'percentComplete'
  | 'score'
  | 'activeSeconds'
  | 'attempts'
  | 'startedAt'
  | 'completedAt'
  | 'lastActivityAt'
  | 'lastLessonId'
>;

/** Matches one learner's row for a course. */
export function progressKey({ workspaceId, learnerId, courseId }: Learner) {
  return and(
    eq(progress.workspaceId, workspaceId),
    eq(progress.learnerId, learnerId),
    eq(progress.courseId, courseId),
  );
}

/** The events of the learner's current run. */
export async function runEvents(db: Db | Tx, row: ProgressRow): Promise<ProgressEvent[]> {
  const rows = await db
    .select({ event: events.event })
    .from(events)
    .where(
      and(
        eq(events.workspaceId, row.workspaceId),
        eq(events.learnerId, row.learnerId),
        eq(events.courseId, row.courseId),
        eq(events.run, row.run),
      ),
    );
  return rows.map((stored: { event: ProgressEvent }) => stored.event);
}

/** The completion marked by hand on the current run, if any. */
export function completionOf(
  row: Pick<ProgressRow, 'markedCompleteAt'> | undefined,
): ManualCompletion | null {
  return row?.markedCompleteAt ? { at: row.markedCompleteAt.toISOString() } : null;
}

/** The state from the run's events in `course`, with a completion marked by hand on top. */
export function stateOf(
  course: Course,
  row: Pick<ProgressRow, 'markedCompleteAt'> | undefined,
  stored: readonly ProgressEvent[],
): LearnerCourseState {
  return withManualCompletion(reduceProgress(course, stored), completionOf(row));
}

const dateOf = (at: string | null) => (at === null ? null : new Date(at));

/** The lesson opened last (the later one in the course on a tie), or null before any. */
function lastLessonOf(state: LearnerCourseState): string | null {
  let last: { lessonId: string; at: number } | null = null;
  for (const lesson of state.lessons) {
    if (lesson.lastOpenedAt === null) continue;
    const at = Date.parse(lesson.lastOpenedAt);
    if (last === null || at >= last.at) last = { lessonId: lesson.lessonId, at };
  }
  return last?.lessonId ?? null;
}

/** The state columns for `state`. Attempts counts the run's submitted quiz attempts. */
export function summaryOf(state: LearnerCourseState): ProgressSummary {
  return {
    status: state.status,
    percentComplete: state.percentComplete,
    score: state.score,
    activeSeconds: Math.round(state.activeSeconds),
    attempts: state.quizzes.reduce((sum, quiz) => sum + quiz.attempts.length, 0),
    startedAt: dateOf(state.startedAt),
    completedAt: dateOf(state.completedAt),
    lastActivityAt: dateOf(state.lastActivityAt),
    lastLessonId: lastLessonOf(state),
  };
}
