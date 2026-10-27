/**
 * Select, Multi-select and Status options: names, colors, how many rows use one, and removing one.
 * Option names are 1–100 characters, have no commas and are unique in their property ignoring case.
 */
import { newId } from './ids';
import { readValue } from './row';
import {
  LIMITS,
  OPTION_COLORS,
  type ConfigOf,
  type Id,
  type OptionColor,
  type Property,
  type Row,
  type SelectOption,
} from './types';

/** Messages for option names, word for word from the spec. */
export const OPTION_MESSAGES = {
  empty: 'Enter an option name.',
  comma: "Option names can't contain commas.",
  tooLong: 'Option names can be up to 100 characters.',
  taken: 'An option with that name already exists.',
} as const;

/** Settings of the property types that have options. */
export type OptionConfig = ConfigOf<'select'> | ConfigOf<'multi_select'> | ConfigOf<'status'>;

/** A property that has options: Select, Multi-select or Status. */
export type OptionProperty = Property<OptionConfig>;

/** Option names are compared without surrounding spaces and ignoring case. */
const nameKey = (name: string): string => name.trim().normalize('NFC').toLowerCase();

/**
 * Checks a new or changed option name (surrounding spaces are ignored) and returns the problem,
 * or null when it's fine. Pass exceptId when renaming that option, so it doesn't clash with itself.
 */
export function validateOptionName(
  name: string,
  options: readonly SelectOption[],
  exceptId?: Id,
): string | null {
  const n = name.trim();
  if (!n) return OPTION_MESSAGES.empty;
  if (n.includes(',')) return OPTION_MESSAGES.comma;
  if (n.length > LIMITS.optionName) return OPTION_MESSAGES.tooLong;
  const key = nameKey(n);
  if (options.some((o) => o.id !== exceptId && nameKey(o.name) === key)) {
    return OPTION_MESSAGES.taken;
  }
  return null;
}

/** The option with this name, ignoring case and surrounding spaces. */
export function findOptionByName<T extends SelectOption>(
  options: readonly T[],
  name: string,
): T | undefined {
  const key = nameKey(name);
  return options.find((o) => nameKey(o.name) === key);
}

const COLOR_CYCLE: readonly OptionColor[] = OPTION_COLORS.filter((c) => c !== 'default');

/**
 * The color for a new option: the one after the last option's color in OPTION_COLORS order,
 * skipping Default and starting again after Red. The first option gets Gray.
 */
export function nextOptionColor(options: readonly SelectOption[]): OptionColor {
  const last = options[options.length - 1];
  const i = last ? COLOR_CYCLE.indexOf(last.color) : -1;
  return COLOR_CYCLE[(i + 1) % COLOR_CYCLE.length] ?? 'gray';
}

/** A new option with a fresh id and the next color. Check the name with validateOptionName first. */
export function newOption(name: string, options: readonly SelectOption[]): SelectOption {
  return { id: newId(), name: name.trim(), color: nextOptionColor(options) };
}

function usesOption(row: Row, prop: OptionProperty, optionId: Id): boolean {
  const v = readValue(row, prop);
  return Array.isArray(v) ? v.includes(optionId) : v === optionId;
}

/**
 * How many rows use the option: as their Select or Status value, or among their Multi-select values.
 * Shown before deleting it ("Deleting an option says how many rows use it").
 */
export function optionUsage(rows: readonly Row[], prop: OptionProperty, optionId: Id): number {
  let n = 0;
  for (const row of rows) if (usesOption(row, prop, optionId)) n++;
  return n;
}

/** Status options sit in three groups and each group keeps at least one option. */
export function canDeleteStatusOption(config: ConfigOf<'status'>, optionId: Id): boolean {
  const option = config.options.find((o) => o.id === optionId);
  return !!option && config.options.some((o) => o.id !== optionId && o.group === option.group);
}

/**
 * The settings without one option. When Status loses its default option, the default moves to the
 * first To-do option (as for new Status properties). Check canDeleteStatusOption first.
 */
export function withoutOption<C extends OptionConfig>(config: C, optionId: Id): C {
  if (config.type !== 'status') {
    return { ...config, options: config.options.filter((o) => o.id !== optionId) };
  }
  const options = config.options.filter((o) => o.id !== optionId);
  const keep = options.some((o) => o.id === config.defaultOptionId);
  const fallback = options.find((o) => o.group === 'todo') ?? options[0];
  const defaultOptionId = keep ? config.defaultOptionId : (fallback?.id ?? config.defaultOptionId);
  return { ...config, options, defaultOptionId };
}

/**
 * The changes that take a deleted option out of every row that uses it: Select and Status become
 * empty (null) and Multi-select keeps its other values. Rows that don't use it aren't listed.
 */
export function removeOptionFromRows(
  rows: readonly Row[],
  prop: OptionProperty,
  optionId: Id,
): { rowId: Id; value: Id[] | null }[] {
  const out: { rowId: Id; value: Id[] | null }[] = [];
  for (const row of rows) {
    const v = readValue(row, prop);
    if (Array.isArray(v)) {
      if (!v.includes(optionId)) continue;
      const rest = v.filter((id) => id !== optionId);
      out.push({ rowId: row.id, value: rest.length ? rest : null });
    } else if (v === optionId) {
      out.push({ rowId: row.id, value: null });
    }
  }
  return out;
}
