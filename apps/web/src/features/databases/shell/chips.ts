/**
 * The filter bar's chips (spec 3.2): the sorts, then one chip per condition of an "All of" filter,
 * or a single "Advanced filter" chip when the filter uses "Any of" or groups. Each chip opens its
 * panel under it.
 */
import type { Id, Property, View } from '@carehub/databases';
import { filterBarMode } from '@carehub/databases/filter';
import { conditionText, directionText, type FilterNames } from '../filter-text';

export const ADVANCED_FILTER = 'Advanced filter';

export interface BarChip {
  /** Names the chip: its panel opens under it. */
  key: string;
  panel: 'filter' | 'sort';
  text: string;
  /** What a screen reader says, when the text alone says too little. */
  label?: string;
  /** A chip for one sort: its direction, shown as an arrow. */
  direction?: 'asc' | 'desc';
  /** A condition's chip: the condition its panel shows. */
  conditionId?: Id;
}

export function barChips(
  view: Pick<View, 'filter' | 'sorts'>,
  properties: readonly Property[],
  names: FilterNames,
): BarChip[] {
  const byId = new Map(properties.map((p) => [p.id, p]));
  const chips: BarChip[] = [];

  const sorts = view.sorts.flatMap((sort) => {
    const property = byId.get(sort.propertyId);
    return property ? [{ name: property.name, direction: sort.direction }] : [];
  });
  const words = sorts.map((s) => `${s.name}, ${directionText(s.direction)}`).join(', then ');
  const only = sorts.length === 1 ? sorts[0] : undefined;
  if (only) {
    const { name, direction } = only;
    chips.push({ key: 'sort', panel: 'sort', text: name, label: `Sorted by ${words}`, direction });
  } else if (sorts.length > 1) {
    const text = `${sorts.length} sorts`;
    chips.push({ key: 'sort', panel: 'sort', text, label: `${text}: ${words}` });
  }

  const mode = filterBarMode(view.filter);
  if (mode === 'advanced') chips.push({ key: 'advanced', panel: 'filter', text: ADVANCED_FILTER });
  if (mode === 'chips' && view.filter) {
    for (const condition of view.filter.children) {
      const property = condition.kind === 'condition' ? byId.get(condition.propertyId) : undefined;
      if (condition.kind !== 'condition' || !property) continue;
      chips.push({
        key: `condition:${condition.id}`,
        panel: 'filter',
        text: conditionText(condition, property, names),
        conditionId: condition.id,
      });
    }
  }
  return chips;
}
