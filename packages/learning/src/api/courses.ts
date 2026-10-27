import { z } from 'zod';
import { CourseSchema, CourseTypeSchema } from '../format/course';
import { IdSchema, IsoDateTimeSchema, LIMITS } from '../format/primitives';
import { PublishNotifySchema } from './publish';

// Requests and replies for the course endpoints in docs/learning/api.md: Studio's drafts, versions and the
// live course.

const VersionNumberSchema = z.number().int().min(1);
const RevisionSchema = z.number().int().min(1);
const NoteSchema = z.string().trim().max(LIMITS.shortText);

/** Studio's view of a course: `draft` was never published, `live` matches its live version, `changed` has unpublished edits. */
export const CourseStateSchema = z.enum(['draft', 'live', 'changed']);
export type CourseState = z.infer<typeof CourseStateSchema>;

export const CourseSummarySchema = z.object({
  id: IdSchema,
  title: z.string(),
  type: CourseTypeSchema,
  state: CourseStateSchema,
  version: VersionNumberSchema.nullable(),
  updatedAt: IsoDateTimeSchema,
  archived: z.boolean(),
  listed: z.boolean(),
});
export type CourseSummary = z.infer<typeof CourseSummarySchema>;

export const CreateCourseRequestSchema = z.object({
  type: CourseTypeSchema,
  title: z.string().max(LIMITS.title).optional(),
});
export type CreateCourseRequest = z.infer<typeof CreateCourseRequestSchema>;

/** A draft with the revision to send back when saving it. */
export const StudioCourseSchema = z.object({
  course: CourseSchema,
  revision: RevisionSchema,
  liveVersion: VersionNumberSchema.nullable(),
});
export type StudioCourse = z.infer<typeof StudioCourseSchema>;

/** The course is checked on the server (`parseCourse`), so its problems come back as readable issues. */
export const SaveDraftRequestSchema = z.object({ course: z.unknown(), revision: RevisionSchema });
export const SaveDraftReplySchema = z.object({ revision: RevisionSchema });

export const PublishRequestSchema = z.object({
  notify: PublishNotifySchema,
  note: NoteSchema.optional(),
});
export type PublishRequest = z.infer<typeof PublishRequestSchema>;
export const VersionReplySchema = z.object({ version: VersionNumberSchema });

export const CourseVersionSchema = z.object({
  version: VersionNumberSchema,
  publishedAt: IsoDateTimeSchema,
  publishedBy: z.string(),
  notify: PublishNotifySchema,
  note: z.string().optional(),
  rolledBackFrom: VersionNumberSchema.optional(),
});
export type CourseVersion = z.infer<typeof CourseVersionSchema>;

export const RollbackRequestSchema = z.object({
  version: VersionNumberSchema,
  notify: PublishNotifySchema.default('none'),
  note: NoteSchema.optional(),
});
export type RollbackRequest = z.infer<typeof RollbackRequestSchema>;

/** What a learner opens: the live version only. */
export const LiveCourseSchema = z.object({ course: CourseSchema, version: VersionNumberSchema });
export type LiveCourse = z.infer<typeof LiveCourseSchema>;
