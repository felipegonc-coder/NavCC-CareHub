import { z } from 'zod';
import {
  CourseStatusSchema,
  IdSchema,
  IsoDateTimeSchema,
  LearningPathSchema,
  LIMITS,
} from '../format/index';
import { PATH_STATUSES } from './progress';

// Request and response schemas for the path endpoints (docs/learning/api.md).

const { title, description, courseIds, order } = LearningPathSchema.shape;

/** A learner's progress through a path, as `pathProgress` works it out. */
export const PathProgressSchema = z.strictObject({
  completed: z.number().int().min(0).max(LIMITS.pathCourses),
  total: z.number().int().min(0).max(LIMITS.pathCourses),
  percent: z.number().int().min(0).max(100),
  nextCourseId: IdSchema.nullable(),
  status: z.enum(PATH_STATUSES),
  lockedCourseIds: z.array(IdSchema).max(LIMITS.pathCourses),
});

/** One course on a learner's path page. */
export const PathCourseSchema = z.strictObject({
  id: IdSchema,
  title: z.string().min(1).max(LIMITS.title),
  summary: z.string().max(LIMITS.shortText).optional(),
  estimatedMinutes: z.number().int().min(1).max(LIMITS.estimatedMinutes).optional(),
  status: CourseStatusSchema,
  /** On a sequential path: an earlier course isn't finished yet. */
  locked: z.boolean(),
});
export type PathCourse = z.infer<typeof PathCourseSchema>;

/**
 * GET /paths/:id: the path, the courses in it the learner can open (in path order) and their
 * progress over those courses (`pathPage`).
 */
export const PathPageResponseSchema = z.strictObject({
  path: LearningPathSchema,
  courses: z.array(PathCourseSchema).max(LIMITS.pathCourses),
  progress: PathProgressSchema,
});
export type PathPage = z.infer<typeof PathPageResponseSchema>;

/** A path in the Studio's path list. */
export const PathSummarySchema = z.strictObject({
  id: IdSchema,
  title,
  courseCount: z.number().int().min(0).max(LIMITS.pathCourses),
  order,
  updatedAt: IsoDateTimeSchema,
});
export type PathSummary = z.infer<typeof PathSummarySchema>;

/** GET /studio/paths: the most recently changed first. */
export const PathListResponseSchema = z.array(PathSummarySchema);

/**
 * POST /studio/paths: a new path. The server picks its id. Without `courseIds` it starts empty, and
 * without `order` its courses are taken in order (sequential).
 */
export const CreatePathRequestSchema = z.strictObject({
  title,
  description,
  courseIds: courseIds.default([]),
  order: order.default('sequential'),
});
export type CreatePathRequest = z.input<typeof CreatePathRequestSchema>;

/**
 * PUT /studio/paths/:id: the whole path, with the id in the address. A path saves while it is
 * incomplete; `pathProblems` says what keeps it from being assigned.
 */
export const SavePathRequestSchema = LearningPathSchema;

/** GET, POST and PUT /studio/paths[/:id] answer with the saved path. */
export const PathResponseSchema = LearningPathSchema;

/** GET /reports/paths/:id query: `format=csv` answers with `pathReportCsv` instead. */
export const PathReportQuerySchema = z.strictObject({ format: z.literal('csv').optional() });
export type PathReportQuery = z.infer<typeof PathReportQuerySchema>;

const count = z.number().int().min(0);
const courseCount = count.max(LIMITS.pathCourses);

/** One person's line in a path report (`PathReportRow`) as the server sends it. */
export const PathReportRowSchema = z.strictObject({
  learnerId: IdSchema,
  learnerName: z.string().max(LIMITS.title),
  groupIds: z.array(IdSchema),
  status: z.enum(PATH_STATUSES),
  completed: courseCount,
  total: courseCount,
  percent: z.number().int().min(0).max(100),
  nextCourseId: IdSchema.nullable(),
  nextCourseTitle: z.string().max(LIMITS.title).nullable(),
  lastActivityAt: IsoDateTimeSchema.nullable(),
  completedAt: IsoDateTimeSchema.nullable(),
});

/**
 * GET /reports/paths/:id: the path, its courses in path order, the headline numbers and one row per
 * learner (`pathReport`), by name.
 */
export const PathReportResponseSchema = z.strictObject({
  path: z.strictObject({ id: IdSchema, title }),
  courses: z
    .array(z.strictObject({ id: IdSchema, title: z.string().max(LIMITS.title) }))
    .max(LIMITS.pathCourses),
  learners: count,
  notStarted: count,
  inProgress: count,
  completed: count,
  completionPercent: z.number().int().min(0).max(100),
  rows: z.array(PathReportRowSchema),
});
export type PathReportResponse = z.infer<typeof PathReportResponseSchema>;
