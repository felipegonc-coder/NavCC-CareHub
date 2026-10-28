import type { Course, Id, IsoDateTime, ProgressEvent, QuestionResult } from '@carehub/learning';
import { and, asc, eq, gt } from 'drizzle-orm';
import type { Db, Tx } from '../../../db';
import { courseVersions, type PublishedCourse } from './courses';
import { learningProgress as progress } from './schema';
import { runEvents, stateOf, type ProgressRow } from './store';

// The quiz answers reports read: each learner's submitted attempts in their current run, scored on
// the course version that run is measured against (decision 0311). Results only: the right
// answers go to the learner alone (decision 0316).

/** One submitted attempt: when it was sent and how each planned question went, in plan order. */
export type AnsweredAttempt = {
  attemptId: Id;
  submittedAt: IsoDateTime;
  results: QuestionResult[];
};

/**
 * One learner's submitted attempts at one quiz lesson, oldest first. Question and option ids are
 * those of `version`, the course version the learner's run is measured against.
 */
export type QuizAnswers = {
  learnerId: string;
  lessonId: Id;
  mode: 'graded' | 'survey';
  version: number;
  attempts: AnsweredAttempt[];
};

/**
 * The quizzes a learner submitted attempts at in their current run, in course order, worked out
 * from the run's events in `course` (the run's version). An attempt still open is left out.
 */
export function quizAnswersOf(
  course: Course,
  row: Pick<ProgressRow, 'learnerId' | 'version' | 'markedCompleteAt'>,
  stored: readonly ProgressEvent[],
): QuizAnswers[] {
  return stateOf(course, row, stored).quizzes.flatMap((quiz) =>
    quiz.attempts.length === 0
      ? []
      : [
          {
            learnerId: row.learnerId,
            lessonId: quiz.lessonId,
            mode: quiz.mode,
            version: row.version,
            attempts: quiz.attempts.map(({ attemptId, submittedAt, result }) => ({
              attemptId,
              submittedAt,
              results: result.results,
            })),
          },
        ],
  );
}

/**
 * Every learner's submitted quiz attempts in a course, by learner id, for question analysis and
 * survey results. Current runs only: a reset or retake starts a new run, and the attempts of
 * earlier runs no longer count. A run whose course version can't be found is left out.
 */
export async function listQuizAnswers(
  db: Db | Tx,
  workspaceId: string,
  courseId: string,
): Promise<QuizAnswers[]> {
  const rows: ProgressRow[] = await db
    .select()
    .from(progress)
    .where(
      and(
        eq(progress.workspaceId, workspaceId),
        eq(progress.courseId, courseId),
        gt(progress.attempts, 0),
      ),
    )
    .orderBy(asc(progress.learnerId));
  const versions = new Map<number, Promise<PublishedCourse | null>>();
  const answers: QuizAnswers[] = [];
  for (const row of rows) {
    let published = versions.get(row.version);
    if (!published) {
      published = courseVersions().version(db, workspaceId, courseId, row.version);
      versions.set(row.version, published);
    }
    const found = await published;
    if (found) answers.push(...quizAnswersOf(found.course, row, await runEvents(db, row)));
  }
  return answers;
}
