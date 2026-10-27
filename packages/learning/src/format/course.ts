import { z } from 'zod';
import { BlockSchema } from './blocks';
import {
  COURSE_FILE_FORMAT,
  COURSE_FORMAT_VERSION,
  IdSchema,
  ImageSchema,
  IsoDateTimeSchema,
  LEARNING_PATH_FORMAT_VERSION,
  LIMITS,
  RichTextSchema,
} from './primitives';
import { QuestionSchema } from './questions';
import { requiredText, text } from './zod-helpers';

export const CourseTypeSchema = z.enum([
  'standard',
  'scenario_lab',
  'required_read',
  'microlearning',
  'certification',
]);

/** The 5 course types, in the order of the format doc. */
export const COURSE_TYPES = CourseTypeSchema.options;

/** How the cover sits on the course start page. Missing means "banner". */
export const CoverLayoutSchema = z.enum(['banner', 'split', 'full']);

export const CourseStatusSchema = z.enum([
  'not_started',
  'in_progress',
  'completed',
  'passed',
  'failed',
]);

const label = text(LIMITS.label).optional();

export const CourseSettingsSchema = z.strictObject({
  lessonOrder: z.enum(['free', 'sequential']),
  completion: z.strictObject({
    requireAllLessons: z.boolean(),
    requireQuizPass: z.boolean(),
    requireAcknowledgement: z.boolean(),
  }),
  minimumCourseSeconds: z.number().int().min(1).max(LIMITS.minimumCourseSeconds).optional(),
  acknowledgement: z.strictObject({ statement: text(LIMITS.shortText) }).optional(),
  catalog: z.strictObject({ listed: z.boolean() }),
  certificate: z.strictObject({
    enabled: z.boolean(),
    validForMonths: z.number().int().min(1).max(LIMITS.certificateMonths).optional(),
  }),
  sidebar: z.enum(['open', 'closed', 'hidden']).optional(),
  labels: z
    .strictObject({
      start: label,
      continue: label,
      next: label,
      complete: label,
      submit: label,
      retry: label,
    })
    .optional(),
  reviewEveryMonths: z.number().int().min(1).max(LIMITS.reviewEveryMonths).optional(),
});

export const QuizSettingsSchema = z.strictObject({
  passMark: z.number().min(0).max(100),
  maxAttempts: z.number().int().min(1).max(LIMITS.maxAttempts).nullable(),
  shuffleQuestions: z.boolean(),
  shuffleOptions: z.boolean(),
  poolSize: z.number().int().min(1).max(LIMITS.questions).optional(),
  revealAnswers: z.enum(['never', 'after_each_attempt', 'after_passing', 'after_final_attempt']),
  mode: z.enum(['graded', 'survey']).optional(),
});

export const BankDrawSchema = z.strictObject({
  bankId: IdSchema,
  count: z.number().int().min(1).max(LIMITS.bankDrawCount),
  questions: z.array(QuestionSchema).max(LIMITS.bankSnapshotQuestions).optional(),
});

export const ContentLessonSchema = z.strictObject({
  id: IdSchema,
  kind: z.literal('content'),
  title: requiredText(LIMITS.title),
  icon: requiredText(32).optional(),
  headerImage: ImageSchema.optional(),
  minimumSeconds: z.number().int().min(1).max(LIMITS.minimumLessonSeconds).optional(),
  blocks: z.array(BlockSchema).max(LIMITS.blocks),
});

export const QuizLessonSchema = z.strictObject({
  id: IdSchema,
  kind: z.literal('quiz'),
  title: requiredText(LIMITS.title),
  intro: RichTextSchema.optional(),
  settings: QuizSettingsSchema,
  questions: z.array(QuestionSchema).max(LIMITS.questions),
  bankDraws: z.array(BankDrawSchema).max(LIMITS.bankDraws).optional(),
});

export const LessonSchema = z.discriminatedUnion('kind', [ContentLessonSchema, QuizLessonSchema]);

export const CourseSchema = z.strictObject({
  formatVersion: z.literal(COURSE_FORMAT_VERSION),
  id: IdSchema,
  title: requiredText(LIMITS.title),
  summary: text(LIMITS.shortText).optional(),
  description: RichTextSchema.optional(),
  cover: ImageSchema.optional(),
  coverLayout: CoverLayoutSchema.optional(),
  type: CourseTypeSchema,
  topics: z.array(requiredText(LIMITS.topic)).max(LIMITS.topics).optional(),
  estimatedMinutes: z.number().int().min(1).max(LIMITS.estimatedMinutes).optional(),
  settings: CourseSettingsSchema,
  lessons: z.array(LessonSchema).max(LIMITS.lessons),
});

export const LearningPathSchema = z.strictObject({
  formatVersion: z.literal(LEARNING_PATH_FORMAT_VERSION),
  id: IdSchema,
  title: requiredText(LIMITS.title),
  description: text(LIMITS.pathDescription).optional(),
  courseIds: z
    .array(IdSchema)
    .max(LIMITS.pathCourses)
    .superRefine((ids, ctx) => {
      const seen = new Set<string>();
      ids.forEach((id, index) => {
        if (seen.has(id))
          ctx.addIssue({
            code: 'custom',
            path: [index],
            message: `Course "${id}" is already in this path.`,
          });
        seen.add(id);
      });
    })
    .meta({ uniqueItems: true }),
  order: z.enum(['sequential', 'free']),
});

export const CourseFileSchema = z.strictObject({
  format: z.literal(COURSE_FILE_FORMAT),
  exportedAt: IsoDateTimeSchema.optional(),
  course: CourseSchema,
});

export type CourseType = z.infer<typeof CourseTypeSchema>;
export type CourseStatus = z.infer<typeof CourseStatusSchema>;
export type CoverLayout = z.infer<typeof CoverLayoutSchema>;
export type CourseSettings = z.infer<typeof CourseSettingsSchema>;
export type QuizSettings = z.infer<typeof QuizSettingsSchema>;
export type BankDraw = z.infer<typeof BankDrawSchema>;
export type ContentLesson = z.infer<typeof ContentLessonSchema>;
export type QuizLesson = z.infer<typeof QuizLessonSchema>;
export type Lesson = z.infer<typeof LessonSchema>;
export type Course = z.infer<typeof CourseSchema>;
export type LearningPath = z.infer<typeof LearningPathSchema>;
export type CourseFile = z.infer<typeof CourseFileSchema>;
