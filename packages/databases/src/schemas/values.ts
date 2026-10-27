/** Schemas for values in requests: value maps, dates, files, checklist items and rich text. */
import { z } from 'zod';
import { isValidDateValue } from '../dates';
import { richTextLength } from '../richtext';
import { LIMITS, OPTION_COLORS, TEXT_MARKS } from '../types';
import type {
  ChecklistItem,
  DateReminder,
  DateValue,
  FileRef,
  Mention,
  RichText,
  RichTextSpan,
  TextColor,
} from '../types';
import {
  REQUEST_LIMITS,
  hasControlChars,
  idSchema,
  isUniqueBy,
  lineSchema,
  safeWebLinkSchema,
  timeZoneSchema,
} from './common';

/**
 * Values by property id, as sent to add or edit a row or a template: up to 200 of them. Each value
 * is checked against its property by the values code, which knows the database.
 */
export const valuesSchema = z
  .record(idSchema, z.unknown())
  .refine((v) => Object.keys(v).length <= LIMITS.properties, 'Up to 200 values.');

/** A date reminder: minutes before a date with a time, or days before a date without one. */
export const dateReminderSchema = z.union([
  z.strictObject({ minutesBefore: z.literal([0, 5, 10, 15, 30, 60, 120, 1440, 2880]) }),
  z.strictObject({ daysBefore: z.literal([0, 1, 2, 7]) }),
]) satisfies z.ZodType<DateReminder>;

/**
 * A date value: calendar dates, or exact moments when it has a time, with the end (if any) not
 * before the start. Only a date with a time can have a time zone, and a reminder must match:
 * minutes before for a time, days before for a whole day.
 */
export const dateValueSchema = z
  .strictObject({
    start: z.string(),
    end: z.string().nullable(),
    hasTime: z.boolean(),
    timeZone: timeZoneSchema.exactOptional(),
    reminder: dateReminderSchema.exactOptional(),
  })
  .refine((v) => isValidDateValue(v), 'Not a valid date.')
  .refine((v) => v.hasTime || v.timeZone === undefined, 'Only a date with a time has a time zone.')
  .refine(
    (v) => v.reminder === undefined || 'minutesBefore' in v.reminder === v.hasTime,
    "The reminder doesn't fit the date.",
  ) satisfies z.ZodType<DateValue>;

/**
 * A file in a Files property or a form cover: a name, a size in bytes and a type. A file added by
 * link has a safe web link, and then no size or type of its own.
 */
export const fileRefSchema = z
  .strictObject({
    id: idSchema,
    name: lineSchema(LIMITS.url, 1),
    size: z.int().min(0),
    mime: z
      .string()
      .max(REQUEST_LIMITS.mime)
      .refine((s) => !hasControlChars(s), 'Not a file type.'),
    url: safeWebLinkSchema.exactOptional(),
  })
  .refine(
    (f) => f.url === undefined || (f.size === 0 && f.mime === ''),
    'A linked file has no size or type.',
  ) satisfies z.ZodType<FileRef>;

/** One checklist item: up to 500 characters on one line, done or not. */
export const checklistItemSchema = z.strictObject({
  id: idSchema,
  text: lineSchema(LIMITS.checklistItemText),
  done: z.boolean(),
}) satisfies z.ZodType<ChecklistItem>;

const TEXT_COLORS = OPTION_COLORS.filter((c) => c !== 'default').flatMap((c) => [
  c,
  `${c}_background`,
]) as [TextColor, ...TextColor[]];

/** A text color ("blue") or background color ("blue_background"); there's no "default". */
export const textColorSchema = z.enum(TEXT_COLORS);

/** A mention inside rich text: a person, a page or a date. */
export const mentionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('user'), id: idSchema }),
  z.strictObject({ kind: z.literal('page'), id: idSchema }),
  z.strictObject({ kind: z.literal('date'), date: dateValueSchema }),
]) satisfies z.ZodType<Mention>;

/** One span of rich text. Each mark at most once; links must be safe web links. */
export const richTextSpanSchema = z.strictObject({
  text: z.string(),
  marks: z
    .array(z.enum(TEXT_MARKS))
    .max(TEXT_MARKS.length)
    .refine((m) => isUniqueBy(m, (x) => x), 'Each mark once.')
    .exactOptional(),
  color: textColorSchema.exactOptional(),
  link: safeWebLinkSchema.exactOptional(),
  mention: mentionSchema.exactOptional(),
}) satisfies z.ZodType<RichTextSpan>;

/** Rich text of up to `maxLength` characters in all (10,000 unless given). */
export function richTextSchema(maxLength: number = LIMITS.text) {
  return z
    .array(richTextSpanSchema)
    .max(Math.max(1, maxLength))
    .refine(
      (rt) => richTextLength(rt) <= maxLength,
      `Up to ${maxLength} characters.`,
    ) satisfies z.ZodType<RichText>;
}
