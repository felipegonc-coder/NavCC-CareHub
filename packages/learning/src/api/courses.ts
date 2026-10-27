import { z } from 'zod';
import { BlockSchema } from '../format/blocks';
import { CourseSchema, CourseTypeSchema } from '../format/course';
import { IdSchema, ImageSchema, IsoDateTimeSchema, LIMITS } from '../format/primitives';
import { PublishNotifySchema } from './publish';

// Requests and replies for the course endpoints in docs/learning/api.md: Studio's drafts, versions, examples
// and block templates, the catalog and the live course.

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

/** A blank course of that type, or a copy of an example (which must be of the same type). */
export const CreateCourseRequestSchema = z.object({
  type: CourseTypeSchema,
  title: z.string().max(LIMITS.title).optional(),
  exampleId: IdSchema.optional(),
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

/** A fictional sample course to start from in Studio. */
export const ExampleCourseSchema = z.object({
  id: IdSchema,
  title: z.string(),
  type: CourseTypeSchema,
  summary: z.string().optional(),
  lessonCount: z.number().int().min(0),
});
export type ExampleCourse = z.infer<typeof ExampleCourseSchema>;

export const CatalogQuerySchema = z.object({
  q: z.string().trim().max(LIMITS.title).optional(),
  topic: z.string().trim().max(LIMITS.topic).optional(),
});
export type CatalogQuery = z.infer<typeof CatalogQuerySchema>;

/** A live, listed course on the catalog. */
export const CatalogEntrySchema = z.object({
  id: IdSchema,
  title: z.string(),
  type: CourseTypeSchema,
  summary: z.string().optional(),
  cover: ImageSchema.optional(),
  topics: z.array(z.string()).optional(),
  estimatedMinutes: z.number().int().optional(),
  lessonCount: z.number().int().min(0),
  version: VersionNumberSchema,
});
export type CatalogEntry = z.infer<typeof CatalogEntrySchema>;

export const BLOCK_TEMPLATE_LIMITS = { name: 100, blocks: 50, perWorkspace: 200 } as const;

/** Blocks an author saved to add again in any course of the workspace. */
export const CreateBlockTemplateRequestSchema = z.object({
  name: z.string().trim().min(1).max(BLOCK_TEMPLATE_LIMITS.name),
  blocks: z.array(BlockSchema).min(1).max(BLOCK_TEMPLATE_LIMITS.blocks),
});
export type CreateBlockTemplateRequest = z.infer<typeof CreateBlockTemplateRequestSchema>;

export const BlockTemplateSchema = CreateBlockTemplateRequestSchema.extend({
  id: IdSchema,
  createdAt: IsoDateTimeSchema,
});
export type BlockTemplate = z.infer<typeof BlockTemplateSchema>;
