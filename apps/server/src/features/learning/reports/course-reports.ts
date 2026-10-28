import {
  courseReport,
  courseReportCsv,
  dropOff,
  learningToday,
  LEARNING_DAY_ZONE,
  LIMITS,
  overdueList,
  overdueListCsv,
  profileZone,
  questionAnalysis,
  reportsOverview,
  reportsOverviewCsv,
  type Course,
  type CourseReportLearner,
  type CourseReportQuiz,
  type CourseReportResponse,
  type EnrollmentRow,
  type IsoDate,
  type OverdueResponse,
  type ReportsOverviewResponse,
} from '@carehub/learning';
import type { Db, Tx } from '../../../db';
import type { Viewer } from '../auth';
import { postgresReportSources } from '../certificates/reports';
import { getLiveCourse } from '../courses/service';
import { httpError } from '../errors';
import { listQuizAnswers, type QuizAnswers } from '../progress/answers';
import { enrollmentRows, reportsOf, type RowsQuery } from './rows';
import type { CsvFile } from './send';

// The reports overview, the course report and the overdue list (docs/learning/api.md):
// GET /reports/overview, /reports/courses/:id and /reports/overdue. People with learning.analytics
// see everyone, managers their own people; everyone else gets 403. Courses are the ones with a
// live version, and their learners the people enrolled in them (./rows). What the reports read
// comes in through CourseReportSources, so this file also runs on plain data in tests. Overdue and
// "this week" go by today in the Learning day zone; CSV dates are days in the viewer's profile
// zone (decision 0317).

/** What the reports overview, the course report and the overdue list read. */
export type CourseReportSources = {
  rows(query: RowsQuery): Promise<EnrollmentRow[]>;
  /** A course's live version, or null when it has none. */
  liveCourse(workspaceId: string, courseId: string): Promise<Course | null>;
  /** Every learner's submitted quiz attempts in a course, in their current runs. */
  quizAnswers(workspaceId: string, courseId: string): Promise<QuizAnswers[]>;
  /** The people who report to `managerId`. */
  reportsOf(workspaceId: string, managerId: string): Promise<string[]>;
  /** A person's profile time zone, or null without one. */
  timeZone(userId: string): Promise<string | null>;
};

const NOT_LIVE = "This course isn't published, so it has no report yet.";

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
const byText = (a: string, b: string) => collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);

/**
 * Whose rows the viewer reads: everyone's with learning.analytics (null), else the people who
 * report to them. 403 for someone with neither.
 */
async function teamOf(sources: CourseReportSources, viewer: Viewer): Promise<string[] | null> {
  if (viewer.can('learning.analytics')) return null;
  const team = await sources.reportsOf(viewer.workspaceId, viewer.userId);
  if (team.length === 0) throw httpError(403);
  return team;
}

/** The rows the viewer reads on `today`: every live course, or only `courseId`. */
async function rowsFor(
  sources: CourseReportSources,
  viewer: Viewer,
  team: readonly string[] | null,
  today: IsoDate,
  courseId?: string,
): Promise<EnrollmentRow[]> {
  return sources.rows({
    workspaceId: viewer.workspaceId,
    today,
    ...(team !== null && { userIds: team }),
    ...(courseId !== undefined && { courseIds: [courseId] }),
  });
}

/**
 * GET /reports/overview: the headline numbers across every live course (`reportsOverview`, with
 * the week in the Learning day zone), then one line per course that has learners, by title
 * (`courseReport`).
 */
export async function reportsOverviewOf(
  sources: CourseReportSources,
  viewer: Viewer,
  now = new Date(),
): Promise<ReportsOverviewResponse> {
  const team = await teamOf(sources, viewer);
  const today = learningToday(now);
  const rows = await rowsFor(sources, viewer, team, today);
  const byCourse = new Map<string, { title: string; rows: EnrollmentRow[] }>();
  for (const row of rows) {
    const course = byCourse.get(row.courseId);
    if (course) course.rows.push(row);
    else byCourse.set(row.courseId, { title: row.courseTitle, rows: [row] });
  }
  const courses = [...byCourse]
    .map(([courseId, course]) => ({
      courseId,
      courseTitle: course.title,
      report: courseReport(course.rows, today),
    }))
    .sort((a, b) => byText(a.courseTitle, b.courseTitle) || byText(a.courseId, b.courseId));
  return {
    today,
    overview: reportsOverview(rows, today, { timeZone: LEARNING_DAY_ZONE }),
    courses,
  };
}

/** A live course and the rows the viewer reads in it; 404 when the course has no live version. */
async function courseRowsOf(
  sources: CourseReportSources,
  viewer: Viewer,
  courseId: string,
  today: IsoDate,
): Promise<{ team: string[] | null; course: Course; rows: EnrollmentRow[] }> {
  const team = await teamOf(sources, viewer);
  const course = await sources.liveCourse(viewer.workspaceId, courseId);
  if (!course) throw httpError(404, NOT_LIVE);
  return { team, course, rows: await rowsFor(sources, viewer, team, today, course.id) };
}

/**
 * The course's quiz lessons in course order. A graded quiz gets the question analysis of the
 * learners' graded attempts (`questionAnalysis`), each scored on the version of the learner's
 * run, so questions the live version no longer has are left out. A survey-mode quiz has no right
 * answers and gets none: its answer counts are GET /reports/courses/:id/surveys/:lessonId.
 */
function quizzesOf(course: Course, answers: readonly QuizAnswers[]): CourseReportQuiz[] {
  return course.lessons.flatMap((lesson) => {
    if (lesson.kind !== 'quiz') return [];
    const attempts = answers
      .filter((answer) => answer.lessonId === lesson.id && answer.mode === 'graded')
      .flatMap((answer) => answer.attempts);
    return [
      {
        lessonId: lesson.id,
        title: lesson.title,
        mode: lesson.settings.mode ?? 'graded',
        questions: questionAnalysis(lesson, attempts),
      },
    ];
  });
}

/**
 * GET /reports/courses/:id: the live course's headline numbers (`courseReport`), one line per
 * learner by name with their days overdue, its quizzes (`quizzesOf`) and where unfinished
 * learners stopped (`dropOff`). 404 when the course has no live version.
 */
export async function courseReportOf(
  sources: CourseReportSources,
  viewer: Viewer,
  courseId: string,
  now = new Date(),
): Promise<CourseReportResponse> {
  const today = learningToday(now);
  const { team, course, rows } = await courseRowsOf(sources, viewer, courseId, today);
  const late = new Map(overdueList(rows, today).map((entry) => [entry.learnerId, entry]));
  const learners: CourseReportLearner[] = [...rows]
    .sort((a, b) => byText(a.learnerName, b.learnerName) || byText(a.learnerId, b.learnerId))
    .map((row) => ({ ...row, daysOverdue: late.get(row.learnerId)?.daysOverdue ?? null }));
  const answers = await sources.quizAnswers(viewer.workspaceId, course.id);
  const shown = answers.filter((answer) => team === null || team.includes(answer.learnerId));
  return {
    today,
    course: { id: course.id, title: course.title.slice(0, LIMITS.title) },
    report: courseReport(rows, today),
    learners,
    quizzes: quizzesOf(course, shown),
    dropOff: dropOff(course, rows),
  };
}

/** GET /reports/overdue: who is late on which live course, most late first (`overdueList`). */
export async function overdueOf(
  sources: CourseReportSources,
  viewer: Viewer,
  now = new Date(),
): Promise<OverdueResponse> {
  const team = await teamOf(sources, viewer);
  const today = learningToday(now);
  return { today, entries: overdueList(await rowsFor(sources, viewer, team, today), today) };
}

/** GET /reports/overview?format=csv: one line per course (`reportsOverviewCsv`). */
export async function reportsOverviewCsvOf(
  sources: CourseReportSources,
  viewer: Viewer,
  now = new Date(),
): Promise<CsvFile> {
  const { today, courses } = await reportsOverviewOf(sources, viewer, now);
  return {
    filename: `learning-overview-${today}.csv`,
    text: reportsOverviewCsv(courses, { bom: true }),
  };
}

/**
 * GET /reports/courses/:id?format=csv: one line per learner (`courseReportCsv`), with Started and
 * Completed as days in the viewer's profile zone.
 */
export async function courseReportCsvOf(
  sources: CourseReportSources,
  viewer: Viewer,
  courseId: string,
  now = new Date(),
): Promise<CsvFile> {
  const today = learningToday(now);
  const { course, rows } = await courseRowsOf(sources, viewer, courseId, today);
  const timeZone = profileZone(await sources.timeZone(viewer.userId));
  return {
    filename: `course-report-${course.id}-${today}.csv`,
    text: courseReportCsv(rows, today, { timeZone, bom: true }),
  };
}

/** GET /reports/overdue?format=csv: one line per late learner and course (`overdueListCsv`). */
export async function overdueCsvOf(
  sources: CourseReportSources,
  viewer: Viewer,
  now = new Date(),
): Promise<CsvFile> {
  const { today, entries } = await overdueOf(sources, viewer, now);
  return {
    filename: `overdue-learning-${today}.csv`,
    text: overdueListCsv(entries, { bom: true }),
  };
}

/** The sources of these reports on the server's database. */
export function postgresCourseReportSources(db: Db | Tx): CourseReportSources {
  return {
    rows: (query) => enrollmentRows(db, query),
    liveCourse: async (workspaceId, courseId) =>
      (await getLiveCourse(db, workspaceId, courseId))?.course ?? null,
    quizAnswers: (workspaceId, courseId) => listQuizAnswers(db, workspaceId, courseId),
    reportsOf: (workspaceId, managerId) => reportsOf(db, workspaceId, managerId),
    timeZone: async (userId) => (await postgresReportSources(db).person(userId))?.timeZone ?? null,
  };
}
