/**
 * Reading one CSV value into a property's stored value (spec 3.7, "Reading values"). Imports use
 * it for every cell; pasting a block from a spreadsheet reads values the same way.
 */
import { normalizeDecimal, roundDecimal } from '../decimal';
import { newId } from '../ids';
import { parseDateText, parseNumberText, parseTimeText } from '../parse-text';
import { fromPlainText, isSafeLink } from '../richtext';
import {
  LIMITS,
  OPTION_COLORS,
  type ChecklistItem,
  type ConfigOf,
  type Id,
  type OptionColor,
  type Property,
  type SelectOption,
  type StatusOption,
  type Viewer,
} from '../types';
import { unprotectCell } from './write';

/** What reading values needs besides the text. */
export interface ImportContext {
  /** The person importing: dates and times are read in their time zone, and "today" is their today. */
  viewer: Pick<Viewer, 'timeZone' | 'now'>;
  /** The workspace member with exactly this name or account email (emails ignoring case), if any. */
  findUser(text: string): Id | undefined;
  /** Rows of the target database the importer can open whose title is exactly `title`, oldest first. */
  findRows(targetDatabaseId: Id, title: string): readonly Id[];
}

/** A stored value (null: empty), with any options to create first; or why the text couldn't be read. */
export type CellResult =
  { ok: true; value: unknown; newOptions?: SelectOption[] } | { ok: false; reason: string };

const ok = (value: unknown): CellResult => ({ ok: true, value });
const fail = (reason: string): CellResult => ({ ok: false, reason });

const OPTION_COMMA = "Option names can't contain commas.";
const OPTION_LENGTH = 'Option names can be up to 100 characters.';

// ------------------------------------------------------------------ simple types

/** Long fractions, as programs and spreadsheets often write them ("0.30000000000000004"). */
const LONG_FRACTION = /^(.*?)((?:\d{1,3}(?:,\d{3})+|\d*)\.\d{11,}(?:e[+-]?\d+)?)(.*)$/is;

/** parseNumberText, but more than 10 decimal places are rounded to the 10 the Number property keeps. */
function readNumber(s: string): string | null {
  const direct = parseNumberText(s);
  if (direct !== null) return direct;
  const m = LONG_FRACTION.exec(s);
  const literal = m?.[2] ? normalizeDecimal(m[2].replace(/,/g, '')) : null;
  if (!m || literal === null) return null;
  const rest = m[3] ?? '';
  return parseNumberText(
    `${m[1] ?? ''}${roundDecimal(literal, rest.includes('%') ? 8 : 10)}${rest}`,
  );
}

function readDate(s: string, dayFirst: boolean, ctx: ImportContext): CellResult {
  const read = (t: string) =>
    parseDateText(t, { viewer: ctx.viewer, dayFirst }) ??
    // A date that only makes sense the other way round (26/10/2026 in a month-first property).
    parseDateText(t, { viewer: ctx.viewer, dayFirst: !dayFirst });
  const value = read(s);
  if (value) return ok(value);
  const [start, end, ...more] = s.split(/\s*(?:→|->)\s*/);
  if (start && end && !more.length && read(start) && (read(end) || parseTimeText(end))) {
    return fail("The end date can't be before the start date.");
  }
  return fail("This isn't a date.");
}

const TICKED = new Set(['yes', 'true', '1', 'x', '✓', '✔', 'checked']);
const UNTICKED = new Set(['no', 'false', '0', 'unchecked']);

/** true for yes, true, 1, x, ✓ and checked (any case); false for no, false, 0 and unchecked; null for other text. */
export function checkboxWord(text: string): boolean | null {
  const w = text.trim().toLowerCase();
  return TICKED.has(w) ? true : UNTICKED.has(w) ? false : null;
}

/** A web address, with "https://" added when it has no scheme; null unless http or https (up to 2,000 characters). */
export function readUrlText(text: string): string | null {
  let url = text.trim();
  if (!/^https?:\/\//i.test(url)) {
    // Another scheme (mailto:, ftp:, javascript:...), but not a host with a port (example.com:8080).
    if (/^[a-z][a-z\d+.-]*:(?!\d)/i.test(url)) return null;
    url = `https://${url}`;
  }
  return url.length <= LIMITS.url && isSafeLink(url) ? url : null;
}

const EMAIL = /^[^\s@<>()[\],;:"]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+$/u;

/** An email address like name@example.com ("mailto:" is dropped); null otherwise. */
export function readEmailText(text: string): string | null {
  const email = text.trim().replace(/^mailto:/i, '');
  return email.length <= LIMITS.email && EMAIL.test(email) ? email : null;
}

/** Digits, spaces and + - ( ) . x, with at least one digit, up to 50 characters. */
function readPhone(s: string): string | null {
  const phone = s.replace(/\s+/g, ' ');
  return phone.length <= LIMITS.phone && /^[\d +().x-]+$/.test(phone) && /\d/.test(phone)
    ? phone
    : null;
}

// ------------------------------------------------------------------ options

const PALETTE: readonly OptionColor[] = OPTION_COLORS.filter((c) => c !== 'default');

/** The color after `last` in OPTION_COLORS order, skipping Default (Gray when there's none). */
function nextColor(last: OptionColor | undefined): OptionColor {
  const i = last ? PALETTE.indexOf(last) : -1;
  return PALETTE[(i + 1) % PALETTE.length] ?? 'gray';
}

function findOption<T extends SelectOption>(options: readonly T[], name: string): T | undefined {
  const key = name.toLowerCase();
  return options.find((o) => o.name.toLowerCase() === key);
}

const optionName = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** Select and Status: the option with this name ignoring case, or a new one (Status: in To-do). */
function readOption(c: ConfigOf<'select'> | ConfigOf<'status'>, s: string): CellResult {
  const name = optionName(s);
  const found = findOption<SelectOption>(c.options, name);
  if (found) return ok(found.id);
  if (name.includes(',')) return fail(OPTION_COMMA);
  if (name.length > LIMITS.optionName) return fail(OPTION_LENGTH);
  const color = nextColor(c.options.at(-1)?.color);
  const option: SelectOption | StatusOption =
    c.type === 'status'
      ? { id: newId(), name, color, group: 'todo' }
      : { id: newId(), name, color };
  return { ok: true, value: option.id, newOptions: [option] };
}

/** Multi-select: names split on commas, each matched or created, without repeats. */
function readOptions(options: readonly SelectOption[], s: string): CellResult {
  const ids: Id[] = [];
  const created: SelectOption[] = [];
  for (const piece of s.split(',')) {
    const name = optionName(piece);
    if (!name) continue;
    let option = findOption(options, name) ?? findOption(created, name);
    if (!option) {
      if (name.length > LIMITS.optionName) return fail(OPTION_LENGTH);
      option = { id: newId(), name, color: nextColor((created.at(-1) ?? options.at(-1))?.color) };
      created.push(option);
    }
    if (!ids.includes(option.id)) ids.push(option.id);
    if (ids.length > LIMITS.multiSelectValues) return fail('Up to 100 values.');
  }
  if (!ids.length) return ok(null);
  return created.length ? { ok: true, value: ids, newOptions: created } : ok(ids);
}

// ------------------------------------------------------------------ people, relations, checklists

/** People by exact name or account email: the whole text first, then each comma-separated name. */
function readPeople(single: boolean, s: string, ctx: ImportContext): CellResult {
  const whole = ctx.findUser(s);
  const ids = new Set<Id>(whole === undefined ? [] : [whole]);
  if (whole === undefined) {
    for (const piece of s.split(',')) {
      const name = piece.trim();
      if (!name) continue;
      const id = ctx.findUser(name);
      if (id === undefined) return fail(`No member has the name or email "${name}".`);
      ids.add(id);
    }
  }
  if (single && ids.size > 1) return fail('This property allows one person only.');
  return ok(ids.size ? [...ids] : null);
}

/** Most comma-separated pieces tried together as one title ("Blue Pine Plumbing, LLC"). */
const MAX_TITLE_PIECES = 10;

/** Rows by exact title. Titles may contain commas, so the longest run of pieces that matches wins. */
function readRelation(c: ConfigOf<'relation'>, s: string, ctx: ImportContext): CellResult {
  const pieces = s.split(',');
  const ids = new Set<Id>();
  for (let i = 0; i < pieces.length;) {
    let used = 0;
    for (let j = Math.min(pieces.length, i + MAX_TITLE_PIECES); j > i && !used; j--) {
      const title = pieces.slice(i, j).join(',').trim();
      const id = title ? ctx.findRows(c.targetDatabaseId, title)[0] : undefined;
      if (id !== undefined) {
        ids.add(id);
        used = j - i;
      }
    }
    if (!used) {
      const title = pieces[i]?.trim();
      if (title) return fail(`No row is called "${title}".`);
      used = 1;
    }
    i += used;
    if (ids.size > LIMITS.relationLinks) return fail('Up to 500 linked rows.');
  }
  if (c.single && ids.size > 1) return fail('This relation allows one row only.');
  return ok(ids.size ? [...ids] : null);
}

const MARK = /^\[([ xX]?)\]\s*/;

/** "[x] Call Avery; [ ] Email Jordan". Items without a mark aren't done. */
function readChecklist(s: string): CellResult {
  const pieces = MARK.test(s) ? s.split(/;\s*(?=\[[ xX]?\])/) : s.split(';');
  const items: ChecklistItem[] = [];
  for (const piece of pieces) {
    const m = MARK.exec(piece.trim());
    const text = (m ? piece.trim().slice(m[0].length) : piece).trim();
    if (!text) continue;
    if (text.length > LIMITS.checklistItemText) return fail('Items can be up to 500 characters.');
    items.push({ id: newId(), text, done: m?.[1]?.toLowerCase() === 'x' });
    if (items.length > LIMITS.checklistItems) return fail('Up to 100 items.');
  }
  return ok(items.length ? items : null);
}

// ------------------------------------------------------------------ any property

/**
 * One CSV value for a property, in stored form (an empty cell gives null). The apostrophe an export
 * puts before formula-like text is removed first. Select, Multi-select and Status create options
 * that don't exist yet (returned in newOptions: pass a property that already has them for the next
 * rows). Files, created and edited properties, ID, formulas, rollups and buttons can't be filled.
 */
export function readCell(prop: Property, text: string, ctx: ImportContext): CellResult {
  const s = unprotectCell(text.trim()).trim();
  if (!s) return ok(null);
  const c = prop.config;
  switch (c.type) {
    case 'title': {
      const title = s.replace(/\s*[\r\n]+\s*/g, ' ');
      return title.length > LIMITS.title ? fail('Names can be up to 2,000 characters.') : ok(title);
    }
    case 'text':
      return s.length > LIMITS.text
        ? fail('Text can be up to 10,000 characters.')
        : ok(fromPlainText(s));
    case 'number': {
      const d = readNumber(s);
      return d === null ? fail("This isn't a number.") : ok(d);
    }
    case 'select':
    case 'status':
      return readOption(c, s);
    case 'multi_select':
      return readOptions(c.options, s);
    case 'date':
      return readDate(s, c.format === 'dmy', ctx);
    case 'checkbox':
      return ok(checkboxWord(s) === true);
    case 'url': {
      const url = readUrlText(s);
      return url === null ? fail("This isn't a web address.") : ok(url);
    }
    case 'email': {
      const email = readEmailText(s);
      return email === null ? fail("This isn't an email address.") : ok(email);
    }
    case 'phone': {
      const phone = readPhone(s);
      return phone === null ? fail("This isn't a phone number.") : ok(phone);
    }
    case 'person':
      return readPeople(c.single, s, ctx);
    case 'relation':
      return readRelation(c, s, ctx);
    case 'checklist':
      return readChecklist(s);
    default:
      return fail("This property can't be filled from a CSV file.");
  }
}
