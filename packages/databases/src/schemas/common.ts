/**
 * Building blocks shared by the request schemas: ids, names, dates, links and icons, the request
 * bounds LIMITS doesn't list yet, and parseRequest, which checks a request body and answers with a
 * fixed error that never repeats what was sent.
 */
import { z } from 'zod';
import { isCalendarDate, isInstant, isValidTimeZone } from '../dates';
import { isSafeWebLink } from '../richtext';
import { OPTION_COLORS } from '../types';
import type { CalendarDate, Id, Instant } from '../types';

/**
 * Bounds for request fields that LIMITS doesn't list yet. Every schema uses these numbers; each one
 * is an open question to move into LIMITS.
 */
export const REQUEST_LIMITS = {
  /** Characters in an id. */
  id: 64,
  /** Characters in a view, template or variable name. */
  name: 100,
  /** Characters in a button label, confirm title or form submit label. */
  label: 100,
  /** Characters in a button message or confirm message. */
  message: 2_000,
  /** Characters in a property description. */
  propertyDescription: 280,
  /** Characters in an option description. */
  optionDescription: 280,
  /** Options in one Select, Multi-select or Status property. */
  options: 1_000,
  /** People, groups and roles in one property access list. */
  principals: 200,
  /** Variables in one "Define variables" action. */
  variables: 20,
  /** Characters in an icon. */
  icon: 100,
  /** Characters in a file's type. */
  mime: 255,
  /** Group keys in a grouping's order or hidden list. */
  groupKeys: 1_000,
  /** Ranges a number grouping can make. */
  numberBuckets: 1_000,
  /** People a form notifies about new responses. */
  notifyPeople: 500,
  /** Characters in an ID property's prefix. */
  idPrefix: 20,
  /** Largest "every N days, weeks, months or years" for a repeating template. */
  repeatInterval: 365,
} as const;

/**
 * True if the text has a control character. Tabs and line breaks count too, unless
 * `allowLineBreaks` is set (for messages and descriptions).
 */
export function hasControlChars(s: string, allowLineBreaks = false): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const lineBreak = c === 9 || c === 10 || c === 13;
    if ((c < 32 && !(allowLineBreaks && lineBreak)) || (c >= 127 && c <= 159)) return true;
  }
  return false;
}

const NO_CONTROL = 'No control characters.';

/** True if no two items share a key. */
export function isUniqueBy<T>(items: readonly T[], key: (item: T) => unknown): boolean {
  return new Set(items.map(key)).size === items.length;
}

/** The keys of a `Record<T, true>` as a list for z.enum. The record type makes the list complete. */
export function keysOf<T extends string>(all: Record<T, true>): [T, ...T[]] {
  return Object.keys(all) as [T, ...T[]];
}

/** An id: 1 to 64 characters with no control characters. */
export const idSchema = z
  .string()
  .min(1)
  .max(REQUEST_LIMITS.id)
  .refine((s) => !hasControlChars(s), NO_CONTROL) satisfies z.ZodType<Id>;

/** A list of up to `max` ids. */
export function idListSchema(max: number) {
  return z.array(idSchema).max(max);
}

/** One line of text: trimmed, then `min` to `max` characters with no control characters. */
export function lineSchema(max: number, min = 0) {
  return z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((s) => !hasControlChars(s), NO_CONTROL);
}

/** Longer text such as a message: trimmed, up to `max` characters; tabs and line breaks are fine. */
export function textSchema(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .refine((s) => !hasControlChars(s, true), NO_CONTROL);
}

/** A view, template or variable name: 1 to 100 characters on one line. */
export const nameSchema = lineSchema(REQUEST_LIMITS.name, 1);

/** A calendar date such as "2025-03-14". */
export const calendarDateSchema = z
  .string()
  .refine((s) => isCalendarDate(s), 'Not a calendar date.') satisfies z.ZodType<CalendarDate>;

/** An exact moment such as "2025-03-14T16:30:00.000Z". */
export const instantSchema = z
  .string()
  .refine((s) => isInstant(s), 'Not a date and time.') satisfies z.ZodType<Instant>;

const TIME_ZONE_SHAPE = /^[A-Za-z][\w+-]*(?:\/[\w+-]+){0,2}$/;

/** A time zone name this runtime knows, such as "America/Denver" or "UTC". */
export const timeZoneSchema = z
  .string()
  .refine(
    (s) => s.length <= 64 && TIME_ZONE_SHAPE.test(s) && isValidTimeZone(s),
    'Unknown time zone.',
  );

/** An http or https link with no user name, spaces or hidden characters (see isSafeWebLink). */
export const safeWebLinkSchema = z
  .string()
  .refine((s) => isSafeWebLink(s), 'Only http and https links.');

/**
 * A page, button or form icon: 1 to 100 characters, such as an emoji. Anything that looks like a
 * link (has a colon or a slash) must be a safe web link, so no script or data links get through.
 */
export const iconSchema = z
  .string()
  .min(1)
  .max(REQUEST_LIMITS.icon)
  .refine((s) => !hasControlChars(s) && (!/[:/]/.test(s) || isSafeWebLink(s)), 'Not an icon.');

/** One of the option colors ("default", "gray", ... "red"). */
export const optionColorSchema = z.enum(OPTION_COLORS);

/** The error every refused request gets. */
export interface RequestError {
  code: 'invalid_request';
  message: string;
}

/** What parseRequest returns: the checked value, or the fixed error and where the first problem is. */
export type RequestResult<T> =
  { ok: true; value: T } | { ok: false; error: RequestError; path: (string | number)[] };

/** The message every refused request gets. It never includes anything from the request. */
export const INVALID_REQUEST_MESSAGE = "That request isn't valid.";

const MAX_PATH_PARTS = 20;
const MAX_PATH_PART_LENGTH = 64;

function safePathPart(part: PropertyKey): string | number {
  if (typeof part === 'number') return part;
  if (typeof part !== 'string') return '?';
  return part.slice(0, MAX_PATH_PART_LENGTH).replace(/[^ -~]/g, '?');
}

function refused(path: readonly PropertyKey[]): RequestResult<never> {
  return {
    ok: false,
    error: { code: 'invalid_request', message: INVALID_REQUEST_MESSAGE },
    path: path.slice(0, MAX_PATH_PARTS).map(safePathPart),
  };
}

function attempt<T>(schema: z.ZodType<T>, input: unknown) {
  try {
    return schema.safeParse(input);
  } catch {
    return null;
  }
}

/**
 * Checks a request body against a schema. On success it returns the parsed value (names trimmed,
 * unknown keys refused). On failure it returns a new error with the fixed message, plus the path to
 * the first problem: at most 20 parts, keys cut to 64 characters, anything but plain printable
 * characters replaced by "?". Safe to log; it never repeats a value from the request.
 */
export function parseRequest<T>(schema: z.ZodType<T>, input: unknown): RequestResult<T> {
  const result = attempt(schema, input);
  if (!result) return refused([]);
  if (result.success) return { ok: true, value: result.data };
  return refused(result.error.issues[0]?.path ?? []);
}
