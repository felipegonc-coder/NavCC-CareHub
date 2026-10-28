/**
 * The filter bar's chips (spec 3.2): the sorts, then one chip per rule of an "All of" filter, or
 * a single "Advanced filter" chip when the filter uses "Any of" or groups. Each chip opens its
 * panel under it. A rule says what the Filter panel says of it (ruleText).
 */
import type { EvalContext, Id, Property, View } from '@carehub/databases';
import { filterBarMode } from '@carehub/databases/filter';
import type { PanelTarget } from '../contract';
import { FILTER_TEXT } from '../filters/messages';
import { ruleText } from '../filters/rule-text';

export interface BarChip {
  /** Names the chip: its panel opens under it. */
  key: string;
  panel: 'filter' | 'sort';
  text: string;
  /** What a screen reader says, when the text alone says too little. */
  label?: string;
  /** A chip for one sort: its direction, shown as an arrow. */
  direction?: 'asc' | 'desc';
  /** Where the Filter panel opens: the chip's rule, or the advanced filter. */
  target?: PanelTarget;
}

const DIRECTION_TEXT = { asc: 'ascending', desc: 'descending' } as const;

/**
 * `ctx` names people and related rows (panelContext). `visible`: the properties the viewer can
 * see (the answer's propertyIds), all when absent. Sorts and rules on any other property have no
 * chip, so a property the viewer can't see isn't named.
 */
export function barChips(
  view: Pick<View, 'filter' | 'sorts'>,
  ctx: EvalContext,
  visible?: readonly Id[],
): BarChip[] {
  const seen = visible ? new Set(visible) : null;
  const byId = new Map<Id, Property>();
  for (const p of ctx.properties) if (!seen || seen.has(p.id)) byId.set(p.id, p);
  const chips: BarChip[] = [];

  const sorts = view.sorts.flatMap((sort) => {
    const property = byId.get(sort.propertyId);
    return property ? [{ name: property.name, direction: sort.direction }] : [];
  });
  const words = sorts.map((s) => `${s.name}, ${DIRECTION_TEXT[s.direction]}`).join(', then ');
  const only = sorts.length === 1 ? sorts[0] : undefined;
  if (only) {
    const { name, direction } = only;
    chips.push({ key: 'sort', panel: 'sort', text: name, label: `Sorted by ${words}`, direction });
  } else if (sorts.length > 1) {
    const text = `${sorts.length} sorts`;
    chips.push({ key: 'sort', panel: 'sort', text, label: `${text}: ${words}` });
  }

  const mode = filterBarMode(view.filter);
  if (mode === 'advanced') {
    const text = FILTER_TEXT.advancedFilter;
    chips.push({ key: 'advanced', panel: 'filter', text, target: { advanced: true } });
  }
  if (mode === 'chips' && view.filter) {
    for (const rule of view.filter.children) {
      const property = rule.kind === 'condition' ? byId.get(rule.propertyId) : undefined;
      if (rule.kind !== 'condition' || !property) continue;
      chips.push({
        key: `rule:${rule.id}`,
        panel: 'filter',
        text: ruleText(rule, property, ctx),
        target: { ruleId: rule.id },
      });
    }
  }
  return chips;
}
