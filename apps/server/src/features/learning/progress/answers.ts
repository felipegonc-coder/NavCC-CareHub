import type {
  Course,
  Id,
  IsoDateTime,
  ProgressEvent,
  QuestionResult,
  QuizProgress,
} from '@carehub/learning';
import { and, asc, eq, gt } from 'drizzle-orm';
import type { Db, Tx } from '../../../db';
import { courseVersions, type PublishedCourse } from './courses';
import { learningProgressEvents as events, learningProgress as progress } from './schema';
import { stateOf, type ProgressRow } from './store';

// The quiz answers reports read: each learner's submitted attempts in their current run, scored on
// the course version that run is measured against (decision 0311). Results only: the right
// answers go to the learner alone (decision 0316).

/** How one planned question went, without the feedback the learner was shown. */
export type AnsweredQuestion = Pick<
  QuestionResult,
  'questionId' | 'answered' | 'correct' | 'earned' | 'max' | 'fraction' | 'picked'
>;

/** One submitted attempt: when it was sent and how each planned question went, in plan order. */
export type AnsweredAttempt = {
  attemptId: Id;
  submittedAt: IsoDateTime;
  results: AnsweredQuestion[];
};

/**
 * One learner's submitted attempts at one quiz lesson, oldest first. Question and option ids are
 * those of `version`, the course version the learner's run is measured against.
 */
export type QuizAnswers = {
  learnerId: string;
  lessonId: Id;
  mode: QuizProgress['mode'];
  version: number;
  attempts: AnsweredAttempt[];
};

function answeredQuestion(result: QuestionResult): AnsweredQuestion {
  const { questionId, answered, correct, earned, max, fraction, picked } = result;
  return { questionId, answered, correct, earned, max, fraction, picked };
}

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
              results: result.results.map(answeredQuestion),
            })),
          },
        ],
  );
}

/**
 * Every learner's submitted quiz attempts in a course, for question analysis and survey results.
 * Current runs only: a reset or retake starts a new run, and the attempts of earlier runs no
 * longer count. Two queries (the progress rows, then their runs' events), by learner id. A run
 * whose course version can't be found is left out.
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
  const stored: { learnerId: string; event: ProgressEvent }[] = await db
    .select({ learnerId: events.learnerId, event: events.event })
    .from(events)
    .innerJoin(
      progress,
      and(
        eq(progress.workspaceId, events.workspaceId),
        eq(progress.learnerId, events.learnerId),
        eq(progress.courseId, events.courseId),
        eq(progress.run, events.run),
      ),
    )
    .where(
      and(
        eq(events.workspaceId, workspaceId),
        eq(events.courseId, courseId),
        gt(progress.attempts, 0),
      ),
    );
  const byLearner = new Map<string, ProgressEvent[]>();
  for (const { learnerId, event } of stored) {
    const list = byLearner.get(learnerId);
    if (list) list.push(event);
    else byLearner.set(learnerId, [event]);
  }
  const versions = new Map<number, Promise<PublishedCourse | null>>();
  const answers: QuizAnswers[] = [];
  for (const row of rows) {
    let published = versions.get(row.version);
    if (!published) {
      published = courseVersions().version(db, workspaceId, courseId, row.version);
      versions.set(row.version, published);
    }
    const found = await published;
    const run = byLearner.get(row.learnerId) ?? [];
    if (found) answers.push(...quizAnswersOf(found.course, row, run));
  }
  return answers;
}
