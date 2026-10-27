import {
  progressIntake,
  withManualCompletion,
  type Course,
  type CourseStatus,
  type IsoDateTime,
  type LearnerCourseState,
  type LiveCourse,
  type ProgressEvent,
  type ProgressEventsResponse,
} from '@carehub/learning';
import { and, eq, inArray } from 'drizzle-orm';
import { canSeeCourse } from '../courses/access';
import type { Db, Tx } from '../db';
import { httpError } from '../errors';
import { courseVersions } from './courses';
import { learningProgressEvents as events, learningProgress as progress } from './schema';
import {
  completionOf,
  progressKey,
  runEvents,
  stateOf,
  summaryOf,
  type Learner,
  type ProgressRow,
} from './store';

// Progress (docs/learning/api.md): each learner's events per course, and the state the shared
// logic works out from them. Each run is measured against the course version it is pinned to
// (decision 0311). Every function here stays inside the person's workspace.

/** The signed-in person, in the workspace they are using. */
export type Actor = { userId: string; workspaceId: string };

/** The course's live version for a learner who can see it; 404 otherwise. */
async function visibleCourse(db: Db | Tx, actor: Actor, courseId: string): Promise<LiveCourse> {
  const live = await courseVersions().live(db, actor.workspaceId, courseId);
  if (!live || !(await canSeeCourse(actor.userId, courseId))) throw httpError(404);
  return live;
}

/** The course version the row's run is measured against (`live` when it is that one). */
async function runCourse(db: Db | Tx, row: ProgressRow, live: LiveCourse): Promise<Course> {
  if (row.version === live.version) return live.course;
  const { workspaceId, courseId, version } = row;
  const pinned = await courseVersions().version(db, workspaceId, courseId, version);
  if (!pinned) throw new Error(`Version ${version} of course ${courseId} is missing.`);
  return pinned.course;
}

async function findProgress(
  db: Db | Tx,
  learner: Learner,
  lock = false,
): Promise<ProgressRow | undefined> {
  const query = db.select().from(progress).where(progressKey(learner));
  const [row] = lock ? await query.for('update') : await query;
  return row;
}

/** The learner's row, added on `version` when missing, and locked until the transaction ends. */
async function lockProgress(tx: Db | Tx, learner: Learner, version: number): Promise<ProgressRow> {
  await tx
    .insert(progress)
    .values({ ...learner, version })
    .onConflictDoNothing();
  const row = await findProgress(tx, learner, true);
  if (!row) throw new Error('The progress row was not saved.');
  return row;
}

async function storeEvents(tx: Db | Tx, row: ProgressRow, list: readonly ProgressEvent[]) {
  if (list.length === 0) return;
  const { workspaceId, learnerId, courseId, run } = row;
  await tx
    .insert(events)
    .values(
      list.map((event) => ({ workspaceId, learnerId, courseId, eventId: event.id, run, event })),
    )
    .onConflictDoNothing();
}

const learnerOf = (actor: Actor, courseId: string): Learner => ({
  workspaceId: actor.workspaceId,
  learnerId: actor.userId,
  courseId,
});

/**
 * The course version the learner's current run is measured against (decision 0311), or null
 * before they have a run, when they get the live version. GET /courses/:id, the progress routes
 * and the quiz routes all use this version.
 */
export async function runVersion(
  db: Db | Tx,
  who: { workspaceId: string; userId: string; courseId: string },
): Promise<number | null> {
  const [row] = await db
    .select({ version: progress.version })
    .from(progress)
    .where(progressKey({ ...who, learnerId: who.userId }));
  return row?.version ?? null;
}

/** GET /courses/:id/progress: the learner's state in their run's version (none: not started). */
export async function getProgress(
  db: Db | Tx,
  actor: Actor,
  courseId: string,
): Promise<LearnerCourseState> {
  const live = await visibleCourse(db, actor, courseId);
  const row = await findProgress(db, learnerOf(actor, courseId));
  if (!row) return stateOf(live.course, undefined, []);
  return stateOf(await runCourse(db, row, live), row, await runEvents(db, row));
}

/**
 * POST /courses/:id/events: stores a batch from the learner's browser and answers with their new
 * state and the batch's refusals (progressIntake), in their run's version. A first batch pins the
 * run to the live version. An event sent again is stored once; events dated ahead of the server's
 * clock, or before the run began, are refused. 422 when the run would go past
 * MAX_EVENTS_PER_LEARNER_COURSE.
 */
export async function recordEvents(
  db: Db,
  actor: Actor,
  courseId: string,
  batch: readonly unknown[],
  now = new Date(),
): Promise<ProgressEventsResponse> {
  return db.transaction(async (tx) => {
    const live = await visibleCourse(tx, actor, courseId);
    const learner = learnerOf(actor, courseId);
    // Locked, so two batches from the same learner are taken one after the other.
    const row = await lockProgress(tx, learner, live.version);
    const course = await runCourse(tx, row, live);
    const runStartedAt = row.runStartedAt?.toISOString() ?? null;
    const stored = await runEvents(tx, row);
    const intake = progressIntake(course, stored, batch, now.toISOString(), runStartedAt);
    if (intake.kind === 'too_many') throw httpError(422, intake.message);
    await storeEvents(tx, row, intake.events);
    const state = withManualCompletion(intake.reply.state, completionOf(row));
    if (intake.events.length > 0) {
      await tx
        .update(progress)
        .set({ ...summaryOf(state), updatedAt: now })
        .where(progressKey(learner));
    }
    return { ...intake.reply, state };
  });
}

/** One learner's state in one course, as reports and assignments read it (`listCourseStates`). */
export type CourseStateRow = {
  userId: string;
  courseId: string;
  status: CourseStatus;
  /** Completed lessons out of all lessons, whole percent rounded down. */
  percentComplete: number;
  startedAt: IsoDateTime | null;
  completedAt: IsoDateTime | null;
  lastActivityAt: IsoDateTime | null;
  /** Mean of the best percents of the graded quizzes taken, or null before any. */
  score: number | null;
  activeSeconds: number;
  /** Quiz attempts submitted in the current run. */
  attempts: number;
  /** The lesson opened last, or null before any. */
  lastLessonId: string | null;
  /**
   * The latest finish (completed or passed) of any run before the current one, kept when a
   * reset, retake or re-certification starts a new run; null when there is none. `completedAt` is
   * the current run's.
   */
  previousFinishedAt: IsoDateTime | null;
};

const isoOf = (at: Date | null): IsoDateTime | null => at?.toISOString() ?? null;

/**
 * Each learner's state per course in the workspace, for reports and assignments: their current
 * run as last worked out, for the people and courses asked for (everyone or every course when a
 * list is left out, nobody for an empty list). People without a row haven't started the course.
 */
export async function listCourseStates(
  db: Db | Tx,
  query: { workspaceId: string; userIds?: readonly string[]; courseIds?: readonly string[] },
): Promise<CourseStateRow[]> {
  const { workspaceId, userIds, courseIds } = query;
  if (userIds?.length === 0 || courseIds?.length === 0) return [];
  const rows: ProgressRow[] = await db
    .select()
    .from(progress)
    .where(
      and(
        eq(progress.workspaceId, workspaceId),
        userIds ? inArray(progress.learnerId, [...userIds]) : undefined,
        courseIds ? inArray(progress.courseId, [...courseIds]) : undefined,
      ),
    );
  return rows.map((row) => ({
    userId: row.learnerId,
    courseId: row.courseId,
    status: row.status,
    percentComplete: row.percentComplete,
    startedAt: isoOf(row.startedAt),
    completedAt: isoOf(row.completedAt),
    lastActivityAt: isoOf(row.lastActivityAt),
    score: row.score,
    activeSeconds: row.activeSeconds,
    attempts: row.attempts,
    lastLessonId: row.lastLessonId,
    previousFinishedAt: isoOf(row.previousFinishedAt),
  }));
}
