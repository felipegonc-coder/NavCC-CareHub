import { z } from 'zod';
import {
  CourseStatusSchema,
  ExternalIdSchema,
  IdSchema,
  ImageSchema,
  IsoDateSchema,
  IsoDateTimeSchema,
  LIMITS,
} from '../format/index';
import type { DueStatus } from './due';

// Request and response schemas for assignments and My learning (docs/learning/api.md).

/** The most people and groups one assignment names, and the longest "due in N days". */
export const ASSIGNMENT_LIMITS = { people: 500, groups: 100, dueInDays: 3650 } as const;

/** Every `dueStatus` answer. */
export const DUE_STATUSES = [
  'none',
  'upcoming',
  'due_soon',
  'overdue',
  'done_on_time',
  'done_late',
] as const satisfies readonly DueStatus[];

/** A person in the workspace: their Care Hub user id. */
export const PersonIdSchema = z.guid({ error: 'Choose people from the workspace.' });

/** What to assign: one course, or every published course on a learning path. */
export const AssignmentTargetSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('course'), id: IdSchema }),
  z.strictObject({ type: z.literal('path'), id: IdSchema }),
]);
export type AssignmentTarget = z.infer<typeof AssignmentTargetSchema>;

const DueInDaysSchema = z.number().int().min(1).max(ASSIGNMENT_LIMITS.dueInDays);

/**
 * POST /assignments: a course or path for people and/or groups (everyone in the group now, and
 * anyone who joins it later). Due on a calendar day, or a number of days after each person gets it,
 * or neither. Optional courses (`required: false`) get only the "assigned" reminder.
 */
export const CreateAssignmentsRequestSchema = z
  .strictObject({
    target: AssignmentTargetSchema,
    people: z.array(PersonIdSchema).max(ASSIGNMENT_LIMITS.people).default([]),
    groups: z.array(ExternalIdSchema).max(ASSIGNMENT_LIMITS.groups).default([]),
    dueDate: IsoDateSchema.optional(),
    dueInDays: DueInDaysSchema.optional(),
    required: z.boolean().default(true),
  })
  .refine((request) => request.people.length + request.groups.length > 0, {
    path: ['people'],
    error: 'Choose at least one person or group.',
  })
  .refine((request) => request.dueDate === undefined || request.dueInDays === undefined, {
    path: ['dueInDays'],
    error: 'Give a due date or a number of days, not both.',
  });
export type CreateAssignmentsRequest = z.input<typeof CreateAssignmentsRequestSchema>;

/**
 * One course assigned to people and groups. Assigning a path makes one for each of its published
 * courses, each with `pathId`. `courseTitle` is the live version's title (null if the course is
 * gone).
 */
export const AssignmentSchema = z.strictObject({
  id: z.guid(),
  courseId: IdSchema,
  courseTitle: z.string().max(LIMITS.title).nullable(),
  pathId: IdSchema.nullable(),
  people: z.array(PersonIdSchema),
  groups: z.array(ExternalIdSchema),
  dueDate: IsoDateSchema.nullable(),
  dueInDays: DueInDaysSchema.nullable(),
  required: z.boolean(),
  createdBy: PersonIdSchema,
  createdAt: IsoDateTimeSchema,
});
export type Assignment = z.infer<typeof AssignmentSchema>;

/**
 * GET /assignments (all, or one course's with `?courseId=`) and POST /assignments, oldest first.
 */
export const AssignmentListSchema = z.array(AssignmentSchema);

/** GET /assignments query. */
export const AssignmentListQuerySchema = z.object({ courseId: IdSchema.optional() });

/** A course card on My learning (GET /me). `href` opens the course start page. */
export const MyLearningEntrySchema = z.strictObject({
  courseId: IdSchema,
  title: z.string().max(LIMITS.title),
  summary: z.string().max(LIMITS.shortText).optional(),
  cover: ImageSchema.optional(),
  estimatedMinutes: z.number().int().min(1).max(LIMITS.estimatedMinutes).optional(),
  status: CourseStatusSchema,
  progressPercent: z.number().int().min(0).max(100),
  assigned: z.boolean(),
  required: z.boolean(),
  dueDate: IsoDateSchema.nullable(),
  dueStatus: z.enum(DUE_STATUSES),
  lastActivityAt: IsoDateTimeSchema.nullable(),
  completedAt: IsoDateTimeSchema.nullable(),
  href: z.string().startsWith('/learning/'),
});
export type MyLearningEntry = z.infer<typeof MyLearningEntrySchema>;

/**
 * GET /me: the signed-in person's courses (`myLearning`): in progress (most recent first), assigned
 * and not started (by due date), overdue (most late first) and finished (newest first).
 */
export const MyLearningResponseSchema = z.strictObject({
  continue: z.array(MyLearningEntrySchema),
  assigned: z.array(MyLearningEntrySchema),
  overdue: z.array(MyLearningEntrySchema),
  finished: z.array(MyLearningEntrySchema),
});
export type MyLearningResponse = z.infer<typeof MyLearningResponseSchema>;
