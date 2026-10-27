/**
 * A filter rule in words, for the filter chips and the advanced filter's rows (Databases spec
 * 3.2): "Status is Done, In progress", "Technician contains any of Me", "Due date is within Past
 * 7 days". Condition names come from the package.
 */
import {
  formatCalendarDate,
  ME,
  type DateRef,
  type DateWindow,
  type EvalContext,
  type FilterCondition,
  type Id,
  type Property,
  type StatusGroup,
} from '@carehub/databases';
import { filterOpLabel, filterValueKind } from '@carehub/databases/filter';
import { STATUS_GROUP_LABELS } from '@carehub/databases/group';
import { formatValue } from '@carehub/databases/values';
import { FILTER_TEXT, RELATIVE_DAY_LABELS, WINDOW_LABELS, windowLabel } from './messages';

const idsOf = (v: unknown): Id[] =>
  Array.isArray(v) ? v.filter((x): x is Id => typeof x === 'string') : [];

export function dateRefText(ref: DateRef): string {
  return 'relative' in ref
    ? RELATIVE_DAY_LABELS[ref.relative]
    : formatCalendarDate(ref.exact, 'full');
}

const isRef = (v: unknown): v is DateRef =>
  typeof v === 'object' && v !== null && ('relative' in v || 'exact' in v);

const isWindow = (v: unknown): v is DateWindow =>
  typeof v === 'string'
    ? Object.hasOwn(WINDOW_LABELS, v)
    : typeof v === 'object' && v !== null && 'unit' in v && 'count' in v && 'direction' in v;

/** A rule's value in words ("Done, In progress", "Me", "Today", "Past 7 days"); "" without one. */
export function valueText(rule: FilterCondition, prop: Property, ctx: EvalContext): string {
  const v = rule.value;
  if (v === undefined) return '';
  const config = prop.config;
  switch (filterValueKind(prop, rule.op)) {
    case 'text':
      return typeof v === 'string' ? v : '';
    case 'number':
      return typeof v !== 'string' ? '' : config.type === 'number' ? formatValue(prop, v, ctx) : v;
    case 'options': {
      const options = 'options' in config ? config.options : [];
      return idsOf(v)
        .map((id) => options.find((o) => o.id === id)?.name)
        .filter((name): name is string => name !== undefined)
        .join(', ');
    }
    case 'status_groups':
      return idsOf(v)
        .map((g) => STATUS_GROUP_LABELS[g as StatusGroup])
        .filter((label): label is string => label !== undefined)
        .join(', ');
    case 'people':
      return idsOf(v)
        .map((id) => (id === ME ? FILTER_TEXT.me : (ctx.userName(id) ?? FILTER_TEXT.unknownPerson)))
        .join(', ');
    case 'rows':
      return idsOf(v)
        .map((id) => ctx.rowTitle?.(id) || FILTER_TEXT.untitled)
        .join(', ');
    case 'date':
      return isRef(v) ? dateRefText(v) : '';
    case 'date_range':
      return typeof v === 'object' && 'start' in v && isRef(v.start) && isRef(v.end)
        ? `${dateRefText(v.start)} → ${dateRefText(v.end)}`
        : '';
    case 'date_window':
      return isWindow(v) ? windowLabel(v) : '';
    case 'none':
      return '';
  }
}

/** What a filter chip says: "Status is Done, In progress", "Paid is ticked", "Due date is within This week". */
export function ruleText(
  rule: FilterCondition,
  prop: Property | undefined,
  ctx: EvalContext,
): string {
  if (!prop) return FILTER_TEXT.deletedProperty;
  const op = filterOpLabel(rule.op).toLowerCase();
  const value = valueText(rule, prop, ctx);
  return value ? `${prop.name} ${op} ${value}` : `${prop.name} ${op}`;
}
