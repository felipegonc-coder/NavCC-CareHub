import type { Aggregate, ComputedKind, Property } from './types';

/**
 * What a rollup produces for each calculation. Counts, percents and number maths give numbers;
 * earliest, latest and date range give dates (date range: earliest start → latest end);
 * show original and show unique give a list (filters on lists match any item's text).
 */
export function rollupResultKind(aggregate: Aggregate): ComputedKind {
  switch (aggregate) {
    case 'earliest':
    case 'latest':
    case 'date_range':
      return 'date';
    case 'none':
    case 'show_original':
    case 'show_unique':
      return 'list';
    default:
      return 'number';
  }
}

/** Result kind of a formula or rollup property; null for other types and for formulas with an error. */
export function computedKind(prop: Property): ComputedKind | null {
  const c = prop.config;
  if (c.type === 'formula') return c.resultKind;
  if (c.type === 'rollup') return rollupResultKind(c.aggregate);
  return null;
}
