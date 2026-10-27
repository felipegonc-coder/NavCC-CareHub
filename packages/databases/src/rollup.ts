/**
 * Rollups (spec 3.10, additions 3): a calculation over one property of the rows a relation links
 * to. Only related rows the viewer can open count, and the cell says so on hover. A rollup that
 * would read itself gives "This would make a loop."
 */
import { aggregateFamily, aggregateValues } from './aggregate';
import { formatDecimal } from './decimal';
import { readValue } from './row';
import { defaultConfig } from './schema';
import type {
  Aggregate,
  ComputedValue,
  ConfigOf,
  EvalContext,
  Id,
  NumberDisplay,
  Property,
  Row,
} from './types';

/** The rows one row's relation links to, as the viewer sees them. */
export interface RollupSource {
  /** The related rows the viewer can open. */
  rows: readonly Row[];
  /** The related database's properties. */
  properties: readonly Property[];
  /** For reading the related rows (their formulas and rollups, titles, people). */
  ctx: EvalContext;
  /** All the rows the relation links to, counting ones the viewer can't open. */
  total?: number;
}

export const ROLLUP_RELATION_DELETED = "This rollup's relation was deleted.";
export const ROLLUP_PROPERTY_DELETED = "This rollup's property was deleted.";
export const ROLLUP_LOOP = 'This would make a loop.';

const error = (message: string): ComputedValue => ({ kind: 'error', message });

/**
 * A row's rollup value. `related` gives the rows the row's relation links to, or null when that
 * relation is gone (deleted, or no longer a relation). The target property's calculation runs
 * over those rows, as for a column total; a rollup set to None shows the originals.
 */
export function computeRollup(
  row: Row,
  prop: Property<ConfigOf<'rollup'>>,
  related: (row: Row, relationPropertyId: Id) => RollupSource | null,
): ComputedValue {
  const { relationPropertyId, targetPropertyId, aggregate } = prop.config;
  const source = related(row, relationPropertyId);
  if (!source) return error(ROLLUP_RELATION_DELETED);
  const target = source.properties.find((p) => p.id === targetPropertyId);
  if (!target) return error(ROLLUP_PROPERTY_DELETED);
  if (target.id === prop.id) return error(ROLLUP_LOOP);
  const values = source.rows.map((r) => readValue(r, target, source.ctx));
  const agg = aggregate === 'none' ? 'show_original' : aggregate;
  return aggregateValues(values, agg, target, source.ctx);
}

/**
 * The hover text when the viewer can't open some related rows: "Based on 2 of 3 rows you can
 * open". Null when every row counts (or the total isn't known).
 */
export function rollupBasisLabel(shown: number, total?: number): string | null {
  if (total === undefined || shown >= total) return null;
  const n = (x: number) => formatDecimal(String(x), { format: 'number_commas', decimals: 0 });
  return `Based on ${n(shown)} of ${n(total)} ${total === 1 ? 'row' : 'rows'} you can open`;
}

/**
 * The number display a rollup starts with: the target's number format for number maths (also
 * what's given with no calculation), percent for percents, and none (a plain number) for counts,
 * dates and lists, or when the target has no number format.
 */
export function defaultRollupNumber(
  target: Property,
  aggregate: Aggregate = 'sum',
): NumberDisplay | null {
  const family = aggregateFamily(aggregate);
  const base = defaultConfig('number');
  const c = target.config;
  const own =
    c.type === 'number' ? c : c.type === 'formula' || c.type === 'rollup' ? c.number : null;
  const from =
    family === 'percent'
      ? { ...base, format: 'percent' as const }
      : family === 'number'
        ? own
        : null;
  if (!from) return null;
  const { showAs, color, divideBy, showNumber } = base;
  return {
    format: from.format,
    currency: from.currency,
    decimals: from.decimals,
    showAs,
    color,
    divideBy,
    showNumber,
  };
}

/**
 * What a rollup reads, in the same shape as the formula engine's dependencies, for refusing
 * loops through any chain when it's saved: its relation here, and its property over there.
 */
export function rollupDependencies(prop: Property<ConfigOf<'rollup'>>): {
  local: Id[];
  related: { relationPropertyId: Id; propertyId: Id }[];
} {
  const { relationPropertyId, targetPropertyId } = prop.config;
  return {
    local: [relationPropertyId],
    related: [{ relationPropertyId, propertyId: targetPropertyId }],
  };
}

/**
 * Wraps an EvalContext's `computed` so a formula or rollup that comes back to itself while it's
 * being worked out (through any chain of rows and properties) gives "This would make a loop."
 */
export function guardLoops(
  computed: (row: Row, propertyId: Id) => ComputedValue,
): (row: Row, propertyId: Id) => ComputedValue {
  const active = new Set<string>();
  return (row, propertyId) => {
    const key = `${row.id}/${propertyId}`;
    if (active.has(key)) return error(ROLLUP_LOOP);
    active.add(key);
    try {
      return computed(row, propertyId);
    } finally {
      active.delete(key);
    }
  };
}
