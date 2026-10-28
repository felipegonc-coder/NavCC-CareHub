import { randomInt, randomUUID } from 'node:crypto';
import {
  paperAnswerKey,
  progressIntake,
  quizAttemptStart,
  quizPaper,
  withManualCompletion,
  type Course,
  type CourseStatus,
  type IsoDateTime,
  type LearnerCourseState,
  type ProgressEvent,
  type ProgressEventsResponse,
  type QuizPaperQuestion,
  type RejectedEvent,
} from '@carehub/learning';
import { and, eq, inArray } from 'drizzle-orm';
import type { Db, Tx } from '../../../db';
import { issueCertificate } from '../certificates/service';
import { canSeeCourse } from '../courses/access';
import { httpError, LearningError } from '../errors';
import { courseVersions, type PublishedCourse } from './courses';
import {
  learningProgressChanges as changes,
  learningProgressEvents as events,
  learningProgress as progress,
  type ProgressChangeKind,
} from './schema';
import {
  completionOf,
  newRunOf,
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

/** The course's live version; 404 when it has none. */
async function liveCourse(
  db: Db | Tx,
  workspaceId: string,
  courseId: string,
): Promise<PublishedCourse> {
  const live = await courseVersions().live(db, workspaceId, courseId);
  if (!live) throw httpError(404);
  return live;
}

/** The course's live version for a learner who can see it; 404 otherwise. */
async function visibleCourse(
  db: Db | Tx,
  actor: Actor,
  courseId: string,
): Promise<PublishedCourse> {
  const live = await liveCourse(db, actor.workspaceId, courseId);
  if (!(await canSeeCourse(actor.userId, courseId))) throw httpError(404);
  return live;
}

/** The course version the row's run is measured against (`live` when it is that one). */
async function runCourse(db: Db | Tx, row: ProgressRow, live: PublishedCourse): Promise<Course> {
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

async function recordChange(
  tx: Db | Tx,
  row: ProgressRow,
  change: { kind: ProgressChangeKind; run: number; by: string | null; note?: string | undefined },
  at: Date,
): Promise<void> {
  const { workspaceId, learnerId, courseId } = row;
  await tx.insert(changes).values({
    workspaceId,
    learnerId,
    courseId,
    kind: change.kind,
    run: change.run,
    changedBy: change.by,
    note: change.note || null,
    changedAt: at,
  });
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

/**
 * The learner's own state with the right answers on each submitted attempt, on that attempt's
 * paper (`paperAnswerKey`), for the quizzes whose `revealAnswers` allows it now (decisions 0302
 * and 0316). Only the learner's own replies get them: never resets, completions marked by hand or
 * reports.
 */
function withAnswers(course: Course, state: LearnerCourseState): LearnerCourseState {
  return {
    ...state,
    quizzes: state.quizzes.map((quiz) => {
      const lesson = course.lessons.find((candidate) => candidate.id === quiz.lessonId);
      if (!quiz.revealAnswers || lesson?.kind !== 'quiz') return quiz;
      const attempts = quiz.attempts.map((attempt) => ({
        ...attempt,
        answers: paperAnswerKey(lesson, attempt.plan),
      }));
      return { ...quiz, attempts };
    }),
  };
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
  const course = await runCourse(db, row, live);
  return withAnswers(course, stateOf(course, row, await runEvents(db, row)));
}

/**
 * POST /courses/:id/events: stores a batch from the learner's browser and answers with their new
 * state and the batch's refusals (progressIntake), in their run's version. A first batch pins the
 * run to the live version. An event sent again is stored once; events dated ahead of the server's
 * clock, or before the run began, are refused. 422 when the run would go past
 * MAX_EVENTS_PER_LEARNER_COURSE. Submitted attempts carry their right answers as in getProgress.
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
    if (intake.kind === 'too_many') throw new LearningError(422, 'too_many_events', intake.message);
    await storeEvents(tx, row, intake.events);
    const state = withManualCompletion(intake.reply.state, completionOf(row));
    if (intake.events.length > 0) {
      await tx
        .update(progress)
        .set({ ...summaryOf(state), updatedAt: now })
        .where(progressKey(learner));
      await issueCertificate(tx, { ...learner, course, version: row.version, finish: state });
    }
    return { ...intake.reply, state: withAnswers(course, state) };
  });
}

/** POST /courses/:id/quizzes/:lessonId/attempts: the attempt and its question paper. */
export type QuizAttemptPaper = { attemptId: string; questions: QuizPaperQuestion[] };

/** Plain words for a quiz that can't start now, by reason (the error's code). */
const CANNOT_START: Partial<Record<RejectedEvent['reason'], string>> = {
  locked: 'Finish the lessons before this quiz first.',
  no_attempts_left: "You've used all your attempts at this quiz.",
  future: "Your device's clock is ahead. Set it to the right time, then try again.",
};

/**
 * POST /courses/:id/quizzes/:lessonId/attempts (decisions 0302 and 0314): starts an attempt on the
 * server in the run's version, planned with a server seed (quizAttemptStart), stores its
 * quiz_attempt_started and sends the paper without answers (quizPaper). An open attempt is sent
 * again, so a reload gets the same paper. 404 when the run's version has no such quiz; 409 when
 * it can't start now, with the reason as the code.
 */
export async function startQuizAttempt(
  db: Db,
  actor: Actor,
  courseId: string,
  lesson: { lessonId: string; at: IsoDateTime },
  now = new Date(),
): Promise<QuizAttemptPaper> {
  return db.transaction(async (tx) => {
    const live = await visibleCourse(tx, actor, courseId);
    const row = await lockProgress(tx, learnerOf(actor, courseId), live.version);
    const course = await runCourse(tx, row, live);
    const quiz = course.lessons.find((candidate) => candidate.id === lesson.lessonId);
    if (quiz?.kind !== 'quiz') throw httpError(404);
    const stored = await runEvents(tx, row);
    const start = quizAttemptStart(course, stored, {
      lessonId: quiz.id,
      attemptId: randomUUID(),
      eventId: randomUUID(),
      seed: randomInt(2 ** 31),
      at: lesson.at,
      now: now.toISOString(),
    });
    if (start.kind === 'refused') {
      const { reason } = start.rejection;
      const message = CANNOT_START[reason] ?? "This quiz can't start yet.";
      throw reason === 'hidden' ? httpError(404) : new LearningError(409, reason, message);
    }
    if (start.kind === 'resume') {
      return { attemptId: start.plan.attemptId, questions: quizPaper(quiz, start.plan) };
    }
    await storeEvents(tx, row, [start.event]);
    const state = stateOf(course, row, [...stored, start.event]);
    await tx
      .update(progress)
      .set({ ...summaryOf(state), updatedAt: now })
      .where(progressKey(row));
    return { attemptId: start.event.plan.attemptId, questions: quizPaper(quiz, start.event.plan) };
  });
}

/**
 * POST /people/:personId/courses/:courseId/reset (learning.assign, decision 0312): the person's
 * progress starts over in a new run on the live version, without a completion marked by hand.
 * Their earlier events are kept. Someone who never started has nothing to reset.
 */
export async function resetProgress(
  db: Db,
  actor: Actor,
  personId: string,
  courseId: string,
  note?: string,
  now = new Date(),
): Promise<LearnerCourseState> {
  return db.transaction(async (tx) => {
    const live = await liveCourse(tx, actor.workspaceId, courseId);
    const learner = { workspaceId: actor.workspaceId, learnerId: personId, courseId };
    const row = await findProgress(tx, learner, true);
    if (!row) return stateOf(live.course, undefined, []);
    const next = newRunOf(row, live.version, now);
    await tx.update(progress).set(next).where(progressKey(learner));
    await recordChange(tx, row, { kind: 'reset', run: next.run, by: actor.userId, note }, now);
    return stateOf(live.course, undefined, []);
  });
}

/**
 * POST /people/:personId/courses/:courseId/complete (learning.assign, decision 0312): marks the
 * person's current run complete (withManualCompletion), also for someone who never opened the
 * course, and issues the certificate the course gives. Marking it again keeps the first date.
 */
export async function completeProgress(
  db: Db,
  actor: Actor,
  personId: string,
  courseId: string,
  note?: string,
  now = new Date(),
): Promise<LearnerCourseState> {
  return db.transaction(async (tx) => {
    const live = await liveCourse(tx, actor.workspaceId, courseId);
    const learner = { workspaceId: actor.workspaceId, learnerId: personId, courseId };
    const row = await lockProgress(tx, learner, live.version);
    const markedCompleteAt = row.markedCompleteAt ?? now;
    const course = await runCourse(tx, row, live);
    const state = stateOf(course, { markedCompleteAt }, await runEvents(tx, row));
    if (!row.markedCompleteAt) {
      await tx
        .update(progress)
        .set({ ...summaryOf(state), markedCompleteAt, updatedAt: now })
        .where(progressKey(learner));
      await recordChange(tx, row, { kind: 'complete', run: row.run, by: actor.userId, note }, now);
      await issueCertificate(tx, { ...learner, course, version: row.version, finish: state });
    }
    return state;
  });
}

/** The statuses that end a run: re-certification starts the next one. */
const ENDED: ReadonlySet<CourseStatus> = new Set(['completed', 'passed', 'failed']);

/**
 * Re-certification (the certificates job, in its transaction): when the learner's current run has
 * ended (completed, passed or failed), starts their next run on the course's live version, saved
 * as a `retake` change by no one, with `note`. A run that hasn't ended is left alone, so nobody
 * loses what they did since a retake or reset, and so is someone with no progress or a course
 * with no live version. Returns the new run's number, or null when nothing changed.
 */
export async function startRecertificationRun(
  tx: Db | Tx,
  learner: Learner,
  note: string,
  now = new Date(),
): Promise<number | null> {
  const live = await courseVersions().live(tx, learner.workspaceId, learner.courseId);
  const row = live ? await findProgress(tx, learner, true) : undefined;
  if (!live || !row || !ENDED.has(row.status)) return null;
  const next = newRunOf(row, live.version, now);
  await tx.update(progress).set(next).where(progressKey(learner));
  await recordChange(tx, row, { kind: 'retake', run: next.run, by: null, note }, now);
  return next.run;
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
