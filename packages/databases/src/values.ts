/**
 * Checking, reading and showing property values (spec 3.4 and 3.6; additions 10 and 11).
 * validateValue checks a stored value from a request; parseTyped reads what someone typed or pasted
 * into a cell; formatValue and formatComputed give the text a cell shows and CSV export writes.
 */
import {
  formatDateValue,
  isCalendarDate,
  isInstant,
  isValidDateValue,
  isValidTimeZone,
} from './dates';
import {
  fitsNumberLimits,
  formatDecimal,
  normalizeDecimal,
  numberToDecimal,
  shiftDecimal,
} from './decimal';
import { findOptionByName, newOption, validateOptionName } from './options';
import { parseDateText, parseNumberText, parseTimeText, type DateTextOptions } from './parse-text';
import { newId } from './ids';
import {
  fromPlainText,
  isRichTextEmpty,
  isSafeWebLink,
  normalizeRichText,
  plainText,
  richTextLength,
  sanitizeRichText,
} from './richtext';
import type { ReadValue } from './row';
import {
  LIMITS,
  type ChecklistItem,
  type ComputedValue,
  type ConfigOf,
  type DateFormat,
  type DateReminder,
  type DateValue,
  type EvalContext,
  type FileRef,
  type Id,
  type NumberDisplay,
  type Property,
  type RichText,
  type SelectOption,
  type TimeFormat,
  type Viewer,
} from './types';

/** Messages, word for word from the spec. The last two are for requests the screens never send. */
export const VALUE_MESSAGES = {
  number: 'Enter a number.',
  date: 'Enter a date.',
  dateOrder: "The end date can't be before the start date.",
  url: 'Enter a web address.',
  email: 'Enter an email address like name@example.com.',
  phone: 'Enter a phone number.',
  option: "That option doesn't exist.",
  onePerson: 'This property allows one person only.',
  oneRow: 'This relation allows one row only.',
  values: 'Up to 100 values.',
  files: 'Up to 20 files.',
  links: 'Up to 500 linked rows.',
  items: 'Up to 100 items.',
  itemText: 'Items can be up to 500 characters.',
  text: 'Text can be up to 10,000 characters.',
  title: 'Names can be up to 2,000 characters.',
  invalid: "That value doesn't fit this property.",
  readOnly: "This property can't be edited.",
} as const;
const M = VALUE_MESSAGES;

/** A checked value in stored form (null means empty) and any options it created, or a message. */
export type ValueResult =
  { ok: true; value: unknown; newOptions?: SelectOption[] } | { ok: false; error: string };

const ok = (value: unknown): ValueResult => ({ ok: true, value });
const fail = (error: string): ValueResult => ({ ok: false, error });

// ------------------------------------------------------------------ cleaning text

/** Drops control characters except tab and line break (Postgres can't store some); CRLF → LF. */
function clean(s: string): string {
  let out = '';
  for (const ch of s.replace(/\r\n?/g, '\n')) {
    const code = ch.charCodeAt(0);
    if ((code < 32 && ch !== '\n' && ch !== '\t') || code === 127) continue;
    out += ch;
  }
  return out;
}

/** One trimmed line: line breaks and tabs become spaces. */
const oneLine = (s: string): string =>
  clean(s)
    .replace(/\s*[\n\t]\s*/g, ' ')
    .trim();

/** Trims spaces at both ends (mentions stay whole) and tidies the spans. */
function trimRichText(rt: RichText): RichText {
  const spans = rt.map((s) => ({ ...s, text: clean(s.text) }));
  for (const s of spans) {
    if (s.mention) break;
    s.text = s.text.trimStart();
    if (s.text) break;
  }
  for (let i = spans.length - 1; i >= 0; i--) {
    const s = spans[i];
    if (!s || s.mention) break;
    s.text = s.text.trimEnd();
    if (s.text) break;
  }
  return normalizeRichText(spans);
}

// ------------------------------------------------------------------ validateValue

/**
 * Checks a value for a property that stores one (Name takes a plain string) and returns it in
 * stored form: trimmed, numbers as canonical decimals, "https://" added to links, duplicates
 * dropped, rich text sanitized. null, undefined, "" and [] are empty (null). Automatic properties
 * can't be set. The server runs it on every write.
 */
export function validateValue(prop: Property, input: unknown): ValueResult {
  if (input === null || input === undefined) return ok(null);
  const c = prop.config;
  switch (c.type) {
    case 'title':
      if (typeof input !== 'string') return fail(M.invalid);
      return oneLine(input).length > LIMITS.title ? fail(M.title) : ok(oneLine(input) || null);
    case 'text':
      return validateText(input);
    case 'number':
      return validateNumber(input);
    case 'select':
    case 'status':
      if (input === '') return ok(null);
      return c.options.some((o) => o.id === input) ? ok(input) : fail(M.option);
    case 'multi_select':
      return validateOptionIds(input, c.options);
    case 'date':
      return validateDate(input);
    case 'checkbox':
      return typeof input === 'boolean' ? ok(input) : fail(M.invalid);
    case 'url':
      return validateUrl(input);
    case 'email':
      return validateString(input, M.email, normalizeEmail);
    case 'phone':
      return validateString(input, M.phone, normalizePhone);
    case 'person':
      return validateIds(input, c.single ? M.onePerson : null, LIMITS.multiSelectValues, M.values);
    case 'relation':
      return validateIds(input, c.single ? M.oneRow : null, LIMITS.relationLinks, M.links);
    case 'files':
      return validateItems(input, readFile, LIMITS.files, M.files);
    case 'checklist':
      return validateItems(input, readItem, LIMITS.checklistItems, M.items);
    default:
      return fail(M.readOnly);
  }
}

function validateText(input: unknown): ValueResult {
  const rt = sanitizeRichText(typeof input === 'string' ? fromPlainText(input) : input, Infinity);
  if (!rt) return fail(M.invalid);
  const out = trimRichText(rt);
  if (richTextLength(out) > LIMITS.text) return fail(M.text);
  return ok(isRichTextEmpty(out) ? null : out);
}

function validateNumber(input: unknown): ValueResult {
  let d: string | null;
  if (typeof input === 'number') d = numberToDecimal(input);
  else if (typeof input !== 'string') return fail(M.number);
  else if (!input.trim()) return ok(null);
  else d = normalizeDecimal(input);
  return d !== null && fitsNumberLimits(d) ? ok(d) : fail(M.number);
}

function validateOptionIds(input: unknown, options: readonly SelectOption[]): ValueResult {
  const ids = idList(input, new Set(options.map((o) => o.id)));
  if (!ids) return fail(M.option);
  if (ids.length > LIMITS.multiSelectValues) return fail(M.values);
  return ok(ids.length ? ids : null);
}

function validateDate(input: unknown): ValueResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return fail(M.date);
  const fields = input as Record<string, unknown>;
  const { start, end = null, hasTime, timeZone = null, reminder = null } = fields;
  if (typeof hasTime !== 'boolean') return fail(M.date);
  const read = (s: unknown): string | null => {
    if (hasTime) return isInstant(s) ? new Date(Date.parse(s)).toISOString() : null;
    return isCalendarDate(s) ? s : null;
  };
  const a = read(start);
  const b = end === null ? null : read(end);
  if (a === null || (end !== null && b === null)) return fail(M.date);
  if (b !== null && b < a) return fail(M.dateOrder);
  const value: DateValue = { start: a, end: b === a ? null : b, hasTime };
  if (timeZone !== null) {
    // Only for dates with a time. Checked by shape: the list of zones differs between systems.
    if (!hasTime || !isZoneName(timeZone)) return fail(M.invalid);
    value.timeZone = timeZone;
  }
  if (reminder !== null) {
    const r = readReminder(reminder, hasTime);
    if (!r) return fail(M.invalid);
    value.reminder = r;
  }
  return ok(value);
}

/** The shape of an IANA time zone name: "America/Chicago", "Etc/GMT+5", "UTC". */
const ZONE_NAME = /^[A-Za-z][\w+-]*(?:\/[\w+-]+){0,2}$/;
const isZoneName = (z: unknown): z is string =>
  typeof z === 'string' && z.length <= 64 && ZONE_NAME.test(z);

type MinutesBefore = Extract<DateReminder, { minutesBefore: number }>['minutesBefore'];
type DaysBefore = Extract<DateReminder, { daysBefore: number }>['daysBefore'];
const MINUTES_BEFORE: readonly MinutesBefore[] = [0, 5, 10, 15, 30, 60, 120, 1440, 2880];
const DAYS_BEFORE: readonly DaysBefore[] = [0, 1, 2, 7];

/** Dates with a time remind some minutes before the start; dates without one, some days before. */
function readReminder(r: unknown, hasTime: boolean): DateReminder | null {
  if (typeof r !== 'object' || r === null || Array.isArray(r)) return null;
  const { minutesBefore, daysBefore } = r as Record<string, unknown>;
  if (hasTime) {
    const m = MINUTES_BEFORE.find((x) => x === minutesBefore);
    return m !== undefined && daysBefore === undefined ? { minutesBefore: m } : null;
  }
  const d = DAYS_BEFORE.find((x) => x === daysBefore);
  return d !== undefined && minutesBefore === undefined ? { daysBefore: d } : null;
}

function validateString(
  input: unknown,
  error: string,
  normalize: (s: string) => string | null,
): ValueResult {
  if (typeof input !== 'string') return fail(error);
  const s = oneLine(input);
  if (!s) return ok(null);
  const out = normalize(s);
  return out === null ? fail(error) : ok(out);
}

const SCHEME = /^[a-z][a-z\d+.-]*:/i;

/**
 * A link as typed, trimmed: "bluepine.example" gets "https://", then it must pass isSafeWebLink
 * (http and https only, no user name before the host, no spaces or control characters, up to
 * 2,000 characters). Nothing else is cleaned up, so "java\tscript:" or "//evil.example" is refused.
 */
function normalizeUrl(typed: string): string | null {
  const s = typed.trim();
  const scheme = SCHEME.exec(s);
  // "localhost:3000" is a host and a port, not a scheme.
  const hasScheme = scheme !== null && !/^\d/.test(s.slice(scheme[0].length));
  const url = hasScheme ? s : `https://${s}`;
  return s !== '' && isSafeWebLink(url) ? url : null;
}

function validateUrl(input: unknown): ValueResult {
  if (typeof input !== 'string') return fail(M.url);
  if (!input.trim()) return ok(null);
  const url = normalizeUrl(input);
  return url === null ? fail(M.url) : ok(url);
}

const EMAIL_LOCAL = /^[\p{L}\p{N}!#$%&'*+=?^_`{|}~.-]+$/u;
const EMAIL_DOMAIN = /^[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+$/u;

/** name@domain.tld, up to 254 characters. */
function normalizeEmail(s: string): string | null {
  const at = s.lastIndexOf('@');
  const local = s.slice(0, Math.max(at, 0));
  const fits =
    at > 0 &&
    s.length <= LIMITS.email &&
    EMAIL_LOCAL.test(local) &&
    !local.startsWith('.') &&
    !local.endsWith('.') &&
    !local.includes('..') &&
    EMAIL_DOMAIN.test(s.slice(at + 1));
  return fits ? s : null;
}

const PHONE = /^[\d +().x-]+$/i;

/** Digits, spaces and + - ( ) . x (an extension), with at least one digit, up to 50 characters. */
function normalizePhone(s: string): string | null {
  return s.length <= LIMITS.phone && PHONE.test(s) && /\d/.test(s) ? s : null;
}

/** Ids in order without repeats, or null if any isn't a non-empty string. */
function idList(input: unknown, known?: ReadonlySet<Id>): Id[] | null {
  if (!Array.isArray(input)) return null;
  const ids = [...new Set<unknown>(input)];
  return ids.every(
    (id): id is Id => typeof id === 'string' && id !== '' && (!known || known.has(id)),
  )
    ? ids
    : null;
}

function validateIds(
  input: unknown,
  oneOnly: string | null,
  max: number,
  tooMany: string,
): ValueResult {
  const ids = idList(input);
  if (!ids) return fail(M.invalid);
  if (oneOnly && ids.length > 1) return fail(oneOnly);
  if (ids.length > max) return fail(tooMany);
  return ok(ids.length ? ids : null);
}

/** Files and checklist items: each item read by `read` (an object, or a message), repeats dropped. */
function validateItems<T extends { id: Id }>(
  input: unknown,
  read: (f: Partial<Record<string, unknown>>) => T | string,
  max: number,
  tooMany: string,
): ValueResult {
  if (!Array.isArray(input)) return fail(M.invalid);
  const out = new Map<Id, T>();
  for (const raw of input) {
    const isObject = typeof raw === 'object' && raw !== null && !Array.isArray(raw);
    const item = read(isObject ? (raw as Record<string, unknown>) : {});
    if (typeof item === 'string') return fail(item);
    if (!out.has(item.id)) out.set(item.id, item);
    if (out.size > max) return fail(tooMany);
  }
  return ok(out.size ? [...out.values()] : null);
}

const isId = (v: unknown): v is Id => typeof v === 'string' && v !== '';

function readFile(f: Partial<Record<string, unknown>>): FileRef | string {
  const { id, name, size, mime, url = null } = f;
  if (!isId(id)) return M.invalid;
  if (url !== null) {
    // A web link instead of an upload: no size or type of its own; the link is its name if unnamed.
    const link = typeof url === 'string' ? normalizeUrl(url) : null;
    if (link === null) return M.url;
    if (name !== undefined && typeof name !== 'string') return M.invalid;
    return {
      id,
      name: (name === undefined ? '' : oneLine(name)) || link,
      size: 0,
      mime: '',
      url: link,
    };
  }
  const sizeOk = typeof size === 'number' && Number.isSafeInteger(size) && size >= 0;
  return typeof name === 'string' && typeof mime === 'string' && sizeOk
    ? { id, name: oneLine(name), size, mime: mime.trim() }
    : M.invalid;
}

function readItem({ id, text, done }: Partial<Record<string, unknown>>): ChecklistItem | string {
  if (!isId(id) || typeof text !== 'string' || typeof done !== 'boolean') return M.invalid;
  const t = oneLine(text);
  return t.length > LIMITS.checklistItemText ? M.itemText : { id, text: t, done };
}

// ------------------------------------------------------------------ parseTyped

/** Words that tick a checkbox, ignoring case (as in CSV import); anything else leaves it unticked. */
export const CHECKED_WORDS: ReadonlySet<string> = new Set([
  'yes',
  'true',
  '1',
  'x',
  '✓',
  'checked',
]);

export function isCheckedWord(text: string): boolean {
  return CHECKED_WORDS.has(text.trim().toLowerCase());
}

/** "Plumbing, HVAC" → ["Plumbing", "HVAC"], blank parts dropped. */
export function splitOnCommas(text: string, separator = ','): string[] {
  return text
    .split(separator)
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

/** Finds people by exact name or email, and related rows by exact title, for typed or pasted text. */
export interface TypedLookup {
  findUser?: (text: string) => Id | undefined;
  findRow?: (title: string) => Id | undefined;
}

/**
 * Reads what someone typed or pasted into a cell; blank text clears it.
 * Number: "1,234.50", "$12", "(12)", "45%" (a Percent property reads "45" and "45%" as 0.45).
 * Date: the shown formats, "today", times and "start → end" (day first for Day/Month/Year).
 * Checkbox: yes, true, 1, x, ✓ or checked ticks it; anything else unticks it.
 * Select and Multi-select: option names ignoring case; missing ones are created with the next
 * colors (newOptions); Multi-select splits on commas. Status: existing option names only.
 * Person and Relation: exact names, emails or titles through `lookup`, split on commas.
 * Checklist: "[x] item; [ ] item". Files and automatic properties can't be typed.
 */
export function parseTyped(
  prop: Property,
  text: string,
  viewer: Viewer,
  lookup: TypedLookup = {},
): ValueResult {
  const s = text.trim();
  if (!s) return ok(null);
  const c = prop.config;
  switch (c.type) {
    case 'title':
    case 'url':
    case 'email':
    case 'phone':
      return validateValue(prop, s);
    case 'text':
      return validateValue(prop, fromPlainText(s));
    case 'number': {
      let d = parseNumberText(s);
      if (d !== null && c.format === 'percent' && !s.includes('%')) d = shiftDecimal(d, -2);
      return d !== null && fitsNumberLimits(d) ? ok(d) : fail(M.number);
    }
    case 'date':
      return parseDate(s, { viewer, dayFirst: c.format === 'dmy' });
    case 'checkbox':
      return ok(isCheckedWord(s));
    case 'select':
      return pickOptions(prop, c, [s]);
    case 'multi_select':
      return pickOptions(prop, c, splitOnCommas(s));
    case 'status': {
      const option = findOptionByName(c.options, s);
      return option ? ok(option.id) : fail(M.option);
    }
    case 'person':
      return pickByName(prop, s, lookup.findUser);
    case 'relation':
      return pickByName(prop, s, lookup.findRow);
    case 'checklist':
      return validateValue(prop, parseChecklistText(s));
    case 'files':
      return fail(M.invalid);
    default:
      return fail(M.readOnly);
  }
}

function parseDate(text: string, opts: DateTextOptions): ValueResult {
  const value = parseDateText(text, opts);
  if (value) return ok(value);
  // Both ends readable on their own: the only problem is their order.
  const parts = text.split(/\s*(?:→|->)\s*/);
  const [a = '', b = ''] = parts;
  const reversed =
    parts.length === 2 &&
    parseDateText(a, opts) !== null &&
    (parseDateText(b, opts) !== null || parseTimeText(b) !== null);
  return fail(reversed ? M.dateOrder : M.date);
}

function pickOptions(
  prop: Property,
  config: ConfigOf<'select'> | ConfigOf<'multi_select'>,
  names: readonly string[],
): ValueResult {
  const options = [...config.options];
  const created: SelectOption[] = [];
  const ids: Id[] = [];
  for (const name of names) {
    let option = findOptionByName(options, name);
    if (!option) {
      const error = validateOptionName(name, options);
      if (error) return fail(error);
      option = newOption(name, options);
      options.push(option);
      created.push(option);
    }
    if (!ids.includes(option.id)) ids.push(option.id);
  }
  const input = config.type === 'select' ? (ids[0] ?? null) : ids;
  const res = validateValue({ ...prop, config: { ...config, options } }, input);
  return res.ok && created.length ? { ...res, newOptions: created } : res;
}

function pickByName(
  prop: Property,
  text: string,
  find: ((text: string) => Id | undefined) | undefined,
): ValueResult {
  if (!find) return fail(M.invalid);
  const whole = find(text);
  const ids: Id[] = whole === undefined ? [] : [whole];
  for (const name of whole === undefined ? splitOnCommas(text) : []) {
    const id = find(name);
    if (id === undefined) return fail(M.invalid);
    ids.push(id);
  }
  return validateValue(prop, ids);
}

const CHECK_ITEM = /^\[([ xX]?)\]\s*(.*)$/;

/** "[x] Call back; [ ] Send recap" → checklist items (text without a box is an unticked item). */
export function parseChecklistText(text: string): ChecklistItem[] {
  return splitOnCommas(text, ';').map((part) => {
    const m = CHECK_ITEM.exec(part);
    const done = (m?.[1] ?? '').toLowerCase() === 'x';
    return { id: newId(), text: m ? (m[2] ?? '') : part, done };
  });
}

// ------------------------------------------------------------------ formatValue

export interface FormatOptions {
  /** CSV export (and type changes): relative dates in full, plain names, Yes/No, checklist items. */
  forExport?: boolean;
}

/** The same as EvalContext, which now has isRemovedUser. Kept for existing imports. */
export type FormatContext = EvalContext;

/** "1 row you can't open", "3 rows you can't open". */
export function hiddenRowsText(n: number): string {
  return n === 1 ? "1 row you can't open" : `${n} rows you can't open`;
}

const idsOf = (v: ReadValue): Id[] =>
  Array.isArray(v) ? (v as readonly unknown[]).filter((x): x is Id => typeof x === 'string') : [];
const isText = (s: string | undefined): s is string => s !== undefined && s !== '';
const isObject = (v: ReadValue): v is Exclude<ReadValue, unknown[]> & object =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The text a cell shows, or that CSV export writes (`forExport`). Numbers in the property's format
 * (bar and ring show the number text too); dates in its format and the viewer's time zone; option
 * names; several values joined with ", "; people's names; related rows' titles (hidden ones counted:
 * "2 rows you can't open"); file names; checklists "3/5" (export "[x] item; [ ] item"); checkboxes
 * "" (export "Yes" or "No"); IDs "QA-12"; formulas and rollups through formatComputed. An empty Name
 * shows "Untitled" in cells; no Created by or Edited by means an anonymous response ("Anonymous").
 */
export function formatValue(
  prop: Property,
  value: ReadValue,
  ctx: EvalContext,
  opts: FormatOptions = {},
): string {
  const c = prop.config;
  const exp = opts.forExport === true;
  switch (c.type) {
    case 'title':
      return typeof value === 'string' && value ? value : exp ? '' : 'Untitled';
    case 'text':
      return Array.isArray(value) ? plainText(value as RichText) : '';
    case 'number':
      return typeof value === 'string' ? decimalText(value, c) : '';
    case 'select':
    case 'status':
      return c.options.find((o) => o.id === value)?.name ?? '';
    case 'multi_select':
      return idsOf(value)
        .map((id) => c.options.find((o) => o.id === id)?.name)
        .filter(isText)
        .join(', ');
    case 'date':
    case 'created_time':
    case 'edited_time': {
      if (!isObject(value) || !isValidDateValue(value)) return '';
      const format = exp && c.format === 'relative' ? 'full' : c.format;
      return dateText(value, format, c.timeFormat, ctx.viewer);
    }
    case 'checkbox':
      return exp ? (value === true ? 'Yes' : 'No') : '';
    case 'url':
      return typeof value === 'string' && isSafeWebLink(value) ? value : '';
    case 'email':
    case 'phone':
      return typeof value === 'string' ? value : '';
    case 'person':
      return peopleText(idsOf(value), ctx, exp);
    case 'created_by':
    case 'edited_by':
      return value === null ? 'Anonymous' : peopleText(idsOf(value), ctx, exp);
    case 'files':
      return Array.isArray(value) ? (value as FileRef[]).map((f) => f.name).join(', ') : '';
    case 'relation':
      return titlesText(idsOf(value), ctx, true);
    case 'checklist':
      return Array.isArray(value) ? checklistText(value as ChecklistItem[], exp) : '';
    case 'unique_id':
      return typeof value === 'string' ? (c.prefix ? `${c.prefix}-${value}` : value) : '';
    case 'formula':
    case 'rollup': {
      const computed = isObject(value) && 'kind' in value ? value : { kind: 'empty' as const };
      return formatComputed(computed, c.number, ctx, opts);
    }
    case 'button':
      return '';
  }
}

/** One short-name formatter per time zone ("EDT", "GMT+2"). */
const zoneNameFormats = new Map<string, Intl.DateTimeFormat>();

function zoneName(instant: string, timeZone: string): string {
  let f = zoneNameFormats.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' });
    zoneNameFormats.set(timeZone, f);
  }
  const part = f.formatToParts(Date.parse(instant)).find((x) => x.type === 'timeZoneName');
  return part?.value ?? timeZone;
}

/**
 * A date as shown. A date with a time and a fixed time zone shows in that zone with the zone's short
 * name next to the time ("Oct 26, 2026 11:00 AM EDT"; a range names it once at the end unless the
 * start and end differ, as across a clock change); other dates show in the viewer's zone.
 */
function dateText(
  v: DateValue,
  format: DateFormat,
  timeFormat: TimeFormat,
  viewer: Viewer,
): string {
  const zone = v.hasTime ? v.timeZone : undefined;
  if (zone === undefined || !isValidTimeZone(zone)) {
    return formatDateValue(v, { format, timeFormat, viewer });
  }
  const opts = { format, timeFormat, viewer: { ...viewer, timeZone: zone } };
  if (timeFormat === 'hidden') return formatDateValue(v, opts);
  const a = zoneName(v.start, zone);
  const b = v.end === null ? a : zoneName(v.end, zone);
  if (v.end === null || a === b) return `${formatDateValue(v, opts)} ${a}`;
  const one = (start: string, name: string): string =>
    `${formatDateValue({ start, end: null, hasTime: true }, opts)} ${name}`;
  return `${one(v.start, a)} → ${one(v.end, b)}`;
}

/** A canonical decimal in a number format; an unusable currency code falls back to a plain number. */
function decimalText(
  d: string,
  f: Pick<NumberDisplay, 'format' | 'decimals' | 'currency'>,
): string {
  try {
    return formatDecimal(d, { format: f.format, decimals: f.decimals, currency: f.currency });
  } catch {
    return formatDecimal(d, { format: 'number', decimals: 'auto' });
  }
}

function personName(id: Id, ctx: EvalContext, exp: boolean): string | undefined {
  const name = ctx.userName(id);
  return name !== undefined && !exp && ctx.isRemovedUser?.(id) ? `${name} (removed)` : name;
}

const peopleText = (ids: readonly Id[], ctx: EvalContext, exp: boolean): string =>
  ids
    .map((id) => personName(id, ctx, exp))
    .filter(isText)
    .join(', ');

/** Related rows' titles joined with ", "; rows the viewer can't open are counted at the end. */
function titlesText(ids: readonly Id[], ctx: EvalContext, countHidden: boolean): string {
  const titles: string[] = [];
  let hidden = 0;
  for (const id of ids) {
    const title = ctx.rowTitle?.(id);
    if (title === undefined) hidden++;
    else titles.push(title || 'Untitled');
  }
  if (hidden && countHidden) titles.push(hiddenRowsText(hidden));
  return titles.join(', ');
}

/** Titles of related rows the viewer can open, joined with ", " (Relation → Text). */
export function relationTitlesText(ids: readonly Id[], ctx: EvalContext): string {
  return titlesText(ids, ctx, false);
}

function checklistText(items: readonly ChecklistItem[], exp: boolean): string {
  if (exp) return items.map((i) => `[${i.done ? 'x' : ' '}] ${i.text}`).join('; ');
  return `${items.filter((i) => i.done).length}/${items.length}`;
}

/**
 * The text of a formula or rollup result. Numbers use `number` (null: a plain number such as
 * "1234.5"); dates the full format in the viewer's time zone (or the date's fixed zone); people
 * their names; pages their titles (rows the viewer can't open are counted: "1 row you can't open");
 * lists their items joined with ", ", at most 100 in cells, then "+12 more" (export writes every
 * item); errors their message. A checkbox result shows "" in cells (a box is drawn), else "Yes"
 * or "No".
 */
export function formatComputed(
  value: ComputedValue,
  number: NumberDisplay | null,
  ctx: EvalContext,
  opts: FormatOptions = {},
): string {
  const exp = opts.forExport === true;
  if (value.kind === 'boolean' && !exp) return '';
  /** Each item's text; null for a row the viewer can't open. */
  const items: (string | null)[] = [];
  const add = (v: ComputedValue): void => {
    switch (v.kind) {
      case 'empty':
        return;
      case 'text':
        if (v.value) items.push(v.value);
        return;
      case 'number': {
        const d = numberToDecimal(v.value);
        if (d !== null) items.push(decimalText(d, number ?? PLAIN));
        return;
      }
      case 'boolean':
        items.push(v.value ? 'Yes' : 'No');
        return;
      case 'date':
        if (isValidDateValue(v.value)) items.push(dateText(v.value, 'full', 'viewer', ctx.viewer));
        return;
      case 'person': {
        const name = personName(v.value, ctx, exp);
        if (name) items.push(name);
        return;
      }
      case 'page': {
        const title = ctx.rowTitle?.(v.value);
        items.push(title === undefined ? null : title || 'Untitled');
        return;
      }
      case 'list':
        for (const item of v.value) add(item);
        return;
      case 'error':
        items.push(v.message);
        return;
    }
  };
  add(value);
  const shown = exp ? items : items.slice(0, LIMITS.formulaListShown);
  const parts = shown.filter((t): t is string => t !== null);
  const hidden = shown.length - parts.length;
  if (hidden) parts.push(hiddenRowsText(hidden));
  if (items.length > shown.length) parts.push(`+${items.length - shown.length} more`);
  return parts.join(', ');
}

const PLAIN = { format: 'number', decimals: 'auto', currency: 'USD' } as const;
