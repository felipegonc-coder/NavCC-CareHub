import { z } from 'zod';
import {
  CourseStatusSchema,
  IdSchema,
  IsoDateSchema,
  IsoDateTimeSchema,
  LIMITS,
  QUESTION_TYPES,
  QuizSettingsSchema,
} from '../format/index';

// Response schemas for the reports overview, the course report and the overdue list
// (docs/learning/api.md). Numbers come from `reportsOverview`, `courseReport`, `questionAnalysis`,
// `dropOff` and `overdueList`; `today` is the workspace's calendar day they were computed for.

/**
 * GET /reports/overview, /reports/courses/:id and /reports/overdue query: `format=csv` answers with
 * text/csv instead of JSON.
 */
export const ReportQuerySchema = z.strictObject({ format: z.literal('csv').optional() });
export type ReportQuery = z.infer<typeof ReportQuerySchema>;

const count = z.number().int().min(0);
const wholePercent = z.number().int().min(0).max(100);
const title = z.string().max(LIMITS.title);
const daysLate = z.number().int().min(1);

/** One learner in one course (`EnrollmentRow`) as the server sends it. */
export const EnrollmentRowSchema = z.strictObject({
  learnerId: IdSchema,
  learnerName: title,
  groupIds: z.array(IdSchema).readonly(),
  courseId: IdSchema,
  courseTitle: title,
  status: CourseStatusSchema,
  score: z.number().min(0).max(100).nullable(),
  activeSeconds: z.number().min(0),
  attempts: count,
  startedAt: IsoDateTimeSchema.optional(),
  completedAt: IsoDateTimeSchema.optional(),
  lastActivityAt: IsoDateTimeSchema.optional(),
  dueDate: IsoDateSchema.optional(),
  lastLessonId: IdSchema.optional(),
  required: z.boolean(),
});

/** A course's headline numbers (`courseReport`). */
export const CourseReportSchema = z.strictObject({
  total: count,
  notStarted: count,
  inProgress: count,
  completed: count,
  passed: count,
  failed: count,
  overdue: count,
  completionPercent: wholePercent,
  averageScore: wholePercent.nullable(),
  averageActiveSeconds: count.nullable(),
});

/** The overview's headline numbers across every live course (`reportsOverview`). */
export const ReportsOverviewSchema = z.strictObject({
  learners: count,
  activeLearners: count,
  completions: count,
  completionsThisWeek: count,
  passRate: wholePercent.nullable(),
  overdue: count,
});

/** GET /reports/overview: the headline numbers, then each live course's report, by title. */
export const ReportsOverviewResponseSchema = z.strictObject({
  today: IsoDateSchema,
  overview: ReportsOverviewSchema,
  courses: z.array(
    z.strictObject({ courseId: IdSchema, courseTitle: title, report: CourseReportSchema }),
  ),
});
export type ReportsOverviewResponse = z.infer<typeof ReportsOverviewResponseSchema>;

/** A learner's line in a course report: their row and days overdue (`daysOverdue`), else null. */
export const CourseReportLearnerSchema = EnrollmentRowSchema.extend({
  daysOverdue: daysLate.nullable(),
});
export type CourseReportLearner = z.infer<typeof CourseReportLearnerSchema>;

/** A wrong answer and how often it was picked (`WrongPick`); matching ids are "<pair>><pair>". */
export const WrongPickSchema = z.strictObject({
  id: z.string().min(1),
  text: z.string(),
  count: z.number().int().min(1),
});

/** How one question went (`QuestionAnalysisEntry`); `prompt` is plain text. */
export const QuestionAnalysisEntrySchema = z.strictObject({
  questionId: IdSchema,
  type: z.enum(QUESTION_TYPES),
  prompt: z.string(),
  answered: count,
  correct: count,
  percentCorrect: wholePercent.nullable(),
  wrongPicks: z.array(WrongPickSchema),
});

/**
 * One quiz lesson in a course report, in course order. Graded quizzes carry the question analysis
 * of the learners' scored attempts; survey-mode quizzes have no right answers, so `questions` is
 * empty (their answer counts are GET /reports/courses/:id/surveys/:lessonId).
 */
export const CourseReportQuizSchema = z.strictObject({
  lessonId: IdSchema,
  title,
  mode: QuizSettingsSchema.shape.mode.unwrap(),
  questions: z.array(QuestionAnalysisEntrySchema),
});
export type CourseReportQuiz = z.infer<typeof CourseReportQuizSchema>;

/** Where unfinished learners stopped, per lesson in course order (`DropOffLesson`). */
export const DropOffLessonSchema = z.strictObject({
  lessonId: IdSchema,
  title,
  stopped: count,
  percent: wholePercent,
});

/**
 * GET /reports/courses/:id: the live course, its headline numbers, one line per learner (by name),
 * its quizzes and where learners stopped.
 */
export const CourseReportResponseSchema = z.strictObject({
  today: IsoDateSchema,
  course: z.strictObject({ id: IdSchema, title }),
  report: CourseReportSchema,
  learners: z.array(CourseReportLearnerSchema),
  quizzes: z.array(CourseReportQuizSchema),
  dropOff: z.array(DropOffLessonSchema),
});
export type CourseReportResponse = z.infer<typeof CourseReportResponseSchema>;

/** A row past its due date and not finished (`OverdueEntry`). */
export const OverdueEntrySchema = EnrollmentRowSchema.extend({
  dueDate: IsoDateSchema,
  daysOverdue: daysLate,
});

/** GET /reports/overdue: who is late on which live course, most late first (`overdueList`). */
export const OverdueResponseSchema = z.strictObject({
  today: IsoDateSchema,
  entries: z.array(OverdueEntrySchema),
});
export type OverdueResponse = z.infer<typeof OverdueResponseSchema>;
