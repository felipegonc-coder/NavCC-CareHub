/**
 * Changing a property's type (spec 3.4, "Changing a property's type"): which changes are offered,
 * and the settings and values a change gives. Values that don't fit are cleared and counted, so the
 * confirm can say how many.
 */
import { newId } from './ids';
import {
  findOptionByName,
  nextOptionColor,
  validateOptionName,
  type OptionConfig,
} from './options';
import { fromPlainText, plainText } from './richtext';
import { isEmptyValue, readValue } from './row';
import {
  LIMITS,
  type ConfigOf,
  type EvalContext,
  type Id,
  type Property,
  type PropertyConfig,
  type PropertyType,
  type Row,
  type SelectOption,
  type StatusOption,
} from './types';
import {
  formatValue,
  isCheckedWord,
  parseTyped,
  relationTitlesText,
  splitOnCommas,
} from './values';

const OPTION_TYPES: ReadonlySet<PropertyType> = new Set(['select', 'multi_select', 'status']);
const FROM_TEXT: ReadonlySet<PropertyType> = new Set<PropertyType>([
  ...OPTION_TYPES,
  'number',
  'date',
  'checkbox',
  'url',
  'email',
  'phone',
  'person',
]);

/** Computed or automatic types: any property but Name can change into one, carrying no values. */
const NO_VALUES: ReadonlySet<PropertyType> = new Set(['formula', 'rollup', 'unique_id', 'button']);

/**
 * Whether a property can change from one type to another: anything to Text; Text to Number, Date,
 * Checkbox, Link, Email, Phone, Select, Multi-select, Status or Person; between Select,
 * Multi-select and Status; ID to Number; anything into Formula, Rollup, ID or Button (no values
 * carry over; the screen warns with the cleared count). Name never changes type. Same type: false.
 */
export function canConvert(from: PropertyType, to: PropertyType): boolean {
  if (from === to || from === 'title' || to === 'title') return false;
  if (to === 'text' || NO_VALUES.has(to)) return true;
  if (from === 'text') return FROM_TEXT.has(to);
  if (OPTION_TYPES.has(from)) return OPTION_TYPES.has(to);
  return from === 'unique_id' && to === 'number';
}

/** The settings and values after a type change. */
export interface ConversionPlan {
  /** The new settings: `toConfig`, plus any options made from the values. */
  config: PropertyConfig;
  /** Row id → new stored value, for the rows that keep one. Every other row becomes empty. */
  values: Map<Id, unknown>;
  /** Rows that had a value that couldn't be kept (shown in the confirm, before the change). */
  cleared: number;
}

export interface ConversionOptions {
  /** The member with this exact name or email (Text → Person). Without it, nobody matches. */
  findUser?: (text: string) => Id | undefined;
}

interface Converted {
  /** null: empty. */
  value: unknown;
  /** The row had a value that couldn't be kept. */
  lost: boolean;
}
interface Converter {
  row(row: Row): Converted;
  config(): PropertyConfig;
}

const EMPTY: Converted = { value: null, lost: false };
const LOST: Converted = { value: null, lost: true };
const kept = (value: unknown): Converted => ({ value, lost: false });
/** Text → Checkbox: these untick without counting as cleared; other unknown text is cleared. */
const UNCHECKED_WORDS: ReadonlySet<string> = new Set(['no', 'false', '0', 'unchecked']);

const idList = (v: unknown): Id[] =>
  Array.isArray(v) ? v.filter((x: unknown): x is Id => typeof x === 'string') : [];

/** Cuts to `max` characters without splitting an emoji. */
function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const code = s.charCodeAt(max - 1);
  return s.slice(0, code >= 0xd800 && code <= 0xdbff ? max - 1 : max);
}

/**
 * What changing `prop` to `toConfig` does to `rows` (check canConvert first; anything else throws):
 * - to Text: values as exported (formulas and rollups as shown, so they stop updating); relations
 *   as their titles joined with ", " (rows the context can't open are left out).
 * - Text to Number, Date, Checkbox, Link, Email or Phone: read as if typed (see parseTyped).
 * - Text to Select, Multi-select or Status: options made from the values (Multi-select splits on
 *   commas; Select and Status keep the first part); new Status options go in To-do.
 * - Between Select, Multi-select and Status: every option carries over (matched by name, new
 *   Status options in To-do); multi to single keeps the first value.
 * - Text to Person: an exact name or email through `opts.findUser`, split on commas.
 * - ID to Number: the numbers.
 * - into Formula, Rollup, ID or Button: no values; every row that had one counts as cleared (for
 *   ID the server then numbers the rows, oldest first).
 */
export function planConversion(
  prop: Property,
  toConfig: PropertyConfig,
  rows: readonly Row[],
  ctx: EvalContext,
  opts: ConversionOptions = {},
): ConversionPlan {
  const from = prop.config.type;
  const to = toConfig.type;
  if (!canConvert(from, to)) {
    throw new RangeError(`A ${from} property can't change to ${to}.`);
  }
  const converter: Converter = NO_VALUES.has(to)
    ? {
        row: (row) => (isEmptyValue(readValue(row, prop, ctx)) ? EMPTY : LOST),
        config: () => toConfig,
      }
    : converterFor(prop, toConfig, ctx, opts);
  const values = new Map<Id, unknown>();
  let cleared = 0;
  for (const row of rows) {
    const { value, lost } = converter.row(row);
    if (value !== null) values.set(row.id, value);
    else if (lost) cleared++;
  }
  return { config: converter.config(), values, cleared };
}

function converterFor(
  prop: Property,
  to: PropertyConfig,
  ctx: EvalContext,
  opts: ConversionOptions,
): Converter {
  const fixed = (row: (row: Row) => Converted): Converter => ({ row, config: () => to });
  const textOf = (row: Row): string =>
    plainText(readValue(row, prop as Property<ConfigOf<'text'>>)).trim();
  switch (to.type) {
    case 'text':
      return fixed((row) => {
        const v = readValue(row, prop, ctx);
        const shown =
          prop.config.type === 'relation'
            ? relationTitlesText(idList(v), ctx)
            : formatValue(prop, v, ctx, { forExport: true });
        const t = clip(shown.trim(), LIMITS.text);
        return t ? kept(fromPlainText(t)) : isEmptyValue(v) ? EMPTY : LOST;
      });
    case 'select':
    case 'multi_select':
    case 'status':
      return optionConverter(prop, to, textOf);
    case 'checkbox':
      return fixed((row) => {
        const t = textOf(row);
        if (!t) return EMPTY;
        if (isCheckedWord(t)) return kept(true);
        return UNCHECKED_WORDS.has(t.toLowerCase()) ? EMPTY : LOST;
      });
    case 'person':
      return fixed((row) => {
        const t = textOf(row);
        if (!t) return EMPTY;
        const whole = opts.findUser?.(t);
        const names = whole === undefined ? splitOnCommas(t) : [];
        const found = names
          .map((n) => opts.findUser?.(n))
          .filter((id): id is Id => id !== undefined);
        const ids = [...new Set(whole === undefined ? found : [whole])];
        const max = to.single ? 1 : LIMITS.multiSelectValues;
        return ids.length ? kept(ids.slice(0, max)) : LOST;
      });
    case 'number':
      if (prop.config.type === 'unique_id') {
        return fixed((row) => (row.uniqueNumber === null ? EMPTY : kept(String(row.uniqueNumber))));
      }
      break;
    default:
      break;
  }
  // Text → Number, Date, Link, Email or Phone: read as if typed into the new property.
  const target: Property = { ...prop, config: to };
  return fixed((row) => {
    const t = textOf(row);
    if (!t) return EMPTY;
    const res = parseTyped(target, t, ctx.viewer);
    return res.ok && res.value !== null ? kept(res.value) : LOST;
  });
}

/** Select, Multi-select and Status targets: options found by name or made as values come in. */
function optionConverter(
  prop: Property,
  to: OptionConfig,
  textOf: (row: Row) => string,
): Converter {
  const options: StatusOption[] = (to.options as readonly SelectOption[]).map((o) => ({
    ...o,
    group: (o as Partial<StatusOption>).group ?? 'todo',
  }));
  const pick = (name: string, carry?: SelectOption): Id | null => {
    const found = findOptionByName(options, name);
    if (found) return found.id;
    if (validateOptionName(name, options) !== null) return null;
    const free = carry && !options.some((o) => o.id === carry.id);
    const option: StatusOption = {
      id: free ? carry.id : newId(),
      name: name.trim(),
      color: carry?.color ?? nextOptionColor(options),
      group: 'todo',
    };
    if (carry?.description) option.description = carry.description;
    options.push(option);
    return option.id;
  };
  const fromText = prop.config.type === 'text';
  // Between option types every old option carries over, in order, even if no row uses it.
  const carried = new Map<Id, Id | null>();
  const old = 'options' in prop.config ? (prop.config.options as readonly SelectOption[]) : [];
  for (const o of fromText ? [] : old) carried.set(o.id, pick(o.name, o));
  const row = (r: Row): Converted => {
    let ids: (Id | null | undefined)[];
    if (fromText) {
      const t = textOf(r);
      if (!t) return EMPTY;
      const names = splitOnCommas(t);
      ids = (to.type === 'multi_select' ? names : names.slice(0, 1)).map((n) => pick(n));
    } else {
      const v = readValue(r, prop);
      const before = typeof v === 'string' ? [v] : idList(v);
      if (!before.length) return EMPTY;
      ids = before.map((id) => carried.get(id));
    }
    const unique = [...new Set(ids.filter((id): id is Id => typeof id === 'string'))];
    if (!unique.length) return LOST;
    return kept(to.type === 'multi_select' ? unique.slice(0, LIMITS.multiSelectValues) : unique[0]);
  };
  const config = (): PropertyConfig => {
    if (to.type === 'status') return { ...to, options };
    return {
      ...to,
      options: options.map(({ id, name, color, description }) =>
        description === undefined ? { id, name, color } : { id, name, color, description },
      ),
    };
  };
  return { row, config };
}
