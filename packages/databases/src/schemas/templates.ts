/** Schemas for row templates: dynamic dates, repeat schedules, templates and the row page layout. */
import { z } from 'zod';
import { LIMITS } from '../types';
import type { DynamicDate, RepeatSchedule, RowPageLayout, RowTemplate } from '../types';
import {
  REQUEST_LIMITS,
  calendarDateSchema,
  iconSchema,
  idListSchema,
  idSchema,
  isUniqueBy,
  nameSchema,
  timeZoneSchema,
} from './common';
import { valuesSchema } from './values';

/** The most days a dynamic date can move from today (about ten years either way). */
export const MAX_OFFSET_DAYS = 3_650;

/** A date set when the row is made: today or now, plus or minus up to 3,650 days. */
export const dynamicDateSchema = z.strictObject({
  dynamic: z.enum(['today', 'now']),
  offsetDays: z.int().min(-MAX_OFFSET_DAYS).max(MAX_OFFSET_DAYS).exactOptional(),
}) satisfies z.ZodType<DynamicDate>;

const weekDay = z.literal([0, 1, 2, 3, 4, 5, 6]);

/**
 * When a template repeats: every N (1 to 365) days, weekdays, weeks, months or years, at a time on
 * the quarter hour ("09:00", "17:45") in a known time zone. A weekly schedule needs at least one day;
 * the end can't be before the start.
 */
export const repeatScheduleSchema = z
  .strictObject({
    every: z.enum(['day', 'weekday', 'week', 'month', 'year']),
    interval: z.int().min(1).max(REQUEST_LIMITS.repeatInterval).exactOptional(),
    weekDays: z
      .array(weekDay)
      .max(7)
      .refine((d) => isUniqueBy(d, (x) => x), 'Each day once.')
      .exactOptional(),
    monthDay: z.union([z.int().min(1).max(28), z.literal('last')]).exactOptional(),
    month: z.int().min(1).max(12).exactOptional(),
    time: z.string().regex(/^(?:[01]\d|2[0-3]):(?:00|15|30|45)$/),
    timeZone: timeZoneSchema,
    start: calendarDateSchema,
    end: calendarDateSchema.nullable(),
    paused: z.boolean(),
    ownerId: idSchema,
  })
  .refine((s) => s.every !== 'week' || (s.weekDays?.length ?? 0) > 0, 'Pick at least one day.')
  .refine(
    (s) => s.end === null || s.end >= s.start,
    "The end can't be before the start.",
  ) satisfies z.ZodType<RepeatSchedule>;

/** A row template: a name, an icon, preset values and an optional repeat schedule. */
export const rowTemplateSchema = z.strictObject({
  id: idSchema,
  name: nameSchema,
  icon: iconSchema.nullable(),
  values: valuesSchema,
  repeat: repeatScheduleSchema.nullable().exactOptional(),
}) satisfies z.ZodType<RowTemplate>;

/** A database's templates: up to 50, each id once, and up to 10 that repeat. */
export const rowTemplatesSchema = z
  .array(rowTemplateSchema)
  .max(LIMITS.templates)
  .refine((list) => isUniqueBy(list, (t) => t.id), 'Each template once.')
  .refine(
    (list) => list.filter((t) => t.repeat).length <= LIMITS.repeatingTemplates,
    'Up to 10 repeating templates.',
  );

/** How row pages look: up to 4 pinned properties (each once), properties, comments and backlinks. */
export const rowPageLayoutSchema = z.strictObject({
  pinned: idListSchema(LIMITS.rowPagePinned).refine(
    (ids) => isUniqueBy(ids, (x) => x),
    'Each property once.',
  ),
  properties: z.enum(['in_page', 'panel', 'hidden']),
  comments: z.enum(['full', 'compact', 'off']),
  backlinks: z.enum(['list', 'count', 'off']),
}) satisfies z.ZodType<RowPageLayout>;
