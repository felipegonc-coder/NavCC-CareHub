import {
  summarizeSurvey,
  type Course,
  type ProgressEvent,
  type QuizLesson,
  type SurveySubmission,
  type SurveySummary,
} from '@carehub/learning';
import { and, eq } from 'drizzle-orm';
import type { Db, Tx } from '../../../db';
import { httpError } from '../errors';
import { courseVersions } from '../progress/courses';
import { learningProgressEvents as events, learningProgress as progress } from '../progress/schema';
import { stateOf, type ProgressRow } from '../progress/store';

// Survey results: how often each answer was picked in a survey lesson, from every learner's current run,
// without names. Runs come from the progress tables, each reduced against the course version it is pinned
// to (decision 0311), so the counts match what learners were shown.

/** One learner's current run in a course: the progress row and the run's events. */
export type CourseRun = { row: ProgressRow; events: readonly ProgressEvent[] };

/** The survey lesson `lessonId` in `course`, or a 404 in plain words. */
export function surveyLessonOf(course: Course, lessonId: string): QuizLesson {
  const lesson = course.lessons.find((candidate) => candidate.id === lessonId);
  if (!lesson || lesson.kind !== 'quiz') throw httpError(404, "This survey isn't in the course.");
  if (lesson.settings.mode !== 'survey') {
    throw httpError(404, 'This lesson is a graded quiz, so it has no survey results.');
  }
  return lesson;
}

/**
 * Counts the answers in each run's last submitted attempt at `lesson`. `courseOf(version)` gives the course
 * version a run is pinned to; a run whose version can't be read is left out, and so are attempts made while the
 * lesson was still a graded quiz.
 */
export async function summarizeRuns(
  lesson: QuizLesson,
  runs: readonly CourseRun[],
  courseOf: (version: number) => Promise<Course | null>,
): Promise<SurveySummary> {
  const submissions: SurveySubmission[] = [];
  for (const run of runs) {
    const course = await courseOf(run.row.version);
    if (!course) continue;
    const quiz = stateOf(course, run.row, run.events).quizzes.find(
      (candidate) => candidate.lessonId === lesson.id,
    );
    const last = quiz?.mode === 'survey' ? quiz.attempts.at(-1) : undefined;
    if (last) submissions.push(last.result);
  }
  return summarizeSurvey(lesson, submissions);
}

/** Every learner's current run in a course: two queries, then the events grouped by learner. */
async function courseRuns(
  db: Db | Tx,
  workspaceId: string,
  courseId: string,
): Promise<CourseRun[]> {
  const rows: ProgressRow[] = await db
    .select()
    .from(progress)
    .where(and(eq(progress.workspaceId, workspaceId), eq(progress.courseId, courseId)));
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
    .where(and(eq(events.workspaceId, workspaceId), eq(events.courseId, courseId)));
  const byLearner = new Map<string, ProgressEvent[]>();
  for (const { learnerId, event } of stored) {
    const list = byLearner.get(learnerId);
    if (list) list.push(event);
    else byLearner.set(learnerId, [event]);
  }
  return rows.map((row) => ({ row, events: byLearner.get(row.learnerId) ?? [] }));
}

/**
 * A survey lesson's results (`GET /reports/courses/:id/surveys/:lessonId`): answer counts per question in the
 * live version of the course, from every learner's current run, without names. 404 when the course isn't
 * published or the lesson isn't a survey in its live version.
 */
export async function surveyResults(
  db: Db | Tx,
  workspaceId: string,
  courseId: string,
  lessonId: string,
): Promise<SurveySummary> {
  const versions = courseVersions();
  const live = await versions.live(db, workspaceId, courseId);
  if (!live) throw httpError(404, "This course isn't published, so it has no survey results yet.");
  const lesson = surveyLessonOf(live.course, lessonId);
  const loaded = new Map<number, Promise<Course | null>>([
    [live.version, Promise.resolve(live.course)],
  ]);
  const courseOf = (version: number) => {
    const known = loaded.get(version);
    if (known) return known;
    const reading = versions
      .version(db, workspaceId, courseId, version)
      .then((found) => found?.course ?? null);
    loaded.set(version, reading);
    return reading;
  };
  return summarizeRuns(lesson, await courseRuns(db, workspaceId, courseId), courseOf);
}
