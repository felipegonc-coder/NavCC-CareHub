/**
 * The words for filters and sorts, as the filter bar's chips show them ("Status: Is Done",
 * "Due date: Is within Past 7 days"). The filter and sort panels can use the same words.
 */
import {
  formatCalendarDate,
  ME,
  type DateRef,
  type DateWindow,
  type FilterCondition,
  type Id,
  type Property,
  type RelativeDay,
  type Sort,
  type StatusGroup,
} from '@carehub/databases';
import { filterOpLabel, filterValueKind } from '@carehub/databases/filter';
import { STATUS_GROUP_LABELS } from '@carehub/databases/group';

export const RELATIVE_DAY_LABELS: Record<RelativeDay, string> = {
  today: 'Today',
  tomorrow: 'Tomorrow',
  yesterday: 'Yesterday',
  one_week_ago: 'One week ago',
  one_week_from_now: 'One week from now',
  one_month_ago: 'One month ago',
  one_month_from_now: 'One month from now',
};

export const DATE_WINDOW_LABELS: Record<Extract<DateWindow, string>, string> = {
  this_week: 'This week',
  last_week: 'Last week',
  next_week: 'Next week',
  this_month: 'This month',
  last_month: 'Last month',
  next_month: 'Next month',
  this_year: 'This year',
  last_year: 'Last year',
  next_year: 'Next year',
  past_7_days: 'Past 7 days',
  next_7_days: 'Next 7 days',
  past_30_days: 'Past 30 days',
  next_30_days: 'Next 30 days',
};

/** Names a condition's value may need, when the view's answer has them. */
export interface FilterNames {
  person(userId: Id): string | undefined;
  row(rowId: Id): string | undefined;
}

/** "Oct 26, 2026", or "Today", "One week ago"... */
export function dateRefText(ref: DateRef): string {
  return 'exact' in ref ? formatCalendarDate(ref.exact, 'full') : RELATIVE_DAY_LABELS[ref.relative];
}

/** "This week", "Past 7 days", or "Next 3 months". */
export function dateWindowText(window: DateWindow): string {
  if (typeof window === 'string') return DATE_WINDOW_LABELS[window];
  const unit = window.count === 1 ? window.unit : `${window.unit}s`;
  return `${window.direction === 'past' ? 'Past' : 'Next'} ${window.count} ${unit}`;
}

/** What a condition compares with, in words; '' for conditions without a value (Is ticked). */
export function filterValueText(
  condition: FilterCondition,
  property: Property,
  names: FilterNames,
): string {
  const value: unknown = condition.value;
  const ids = Array.isArray(value) ? value.filter((v): v is Id => typeof v === 'string') : [];
  switch (filterValueKind(property, condition.op)) {
    case 'none':
      return '';
    case 'text':
    case 'number':
      return typeof value === 'string' ? value : '';
    case 'options': {
      const config = property.config;
      const options = 'options' in config ? config.options : [];
      return listed(
        ids.map((id) => options.find((o) => o.id === id)?.name),
        'option',
        'options',
      );
    }
    case 'status_groups':
      return listed(
        ids.map((group) => STATUS_GROUP_LABELS[group as StatusGroup]),
        'group',
        'groups',
      );
    case 'people':
      return listed(
        ids.map((id) => (id === ME ? 'Me' : names.person(id))),
        'person',
        'people',
      );
    case 'rows':
      return listed(ids.map(names.row), 'row', 'rows');
    case 'date':
      return isDateRef(value) ? dateRefText(value) : '';
    case 'date_range':
      return isRecord(value) && isDateRef(value.start) && isDateRef(value.end)
        ? `${dateRefText(value.start)} – ${dateRefText(value.end)}`
        : '';
    case 'date_window':
      return isDateWindow(value) ? dateWindowText(value) : '';
  }
}

/** A filter chip: "Status: Is Done", "Paid: Is ticked", "Technician: Contains any of Me". */
export function conditionText(
  condition: FilterCondition,
  property: Property,
  names: FilterNames,
): string {
  const value = filterValueText(condition, property, names);
  const words = value ? `${filterOpLabel(condition.op)} ${value}` : filterOpLabel(condition.op);
  return `${property.name}: ${words}`;
}

/** "ascending" or "descending". */
export function directionText(direction: Sort['direction']): string {
  return direction === 'asc' ? 'ascending' : 'descending';
}

/** The names, when all are known; otherwise how many ("2 people"). */
function listed(names: (string | undefined)[], one: string, many: string): string {
  if (names.every((name) => name !== undefined)) return names.join(', ');
  return `${names.length} ${names.length === 1 ? one : many}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDateRef(value: unknown): value is DateRef {
  if (!isRecord(value)) return false;
  return typeof value.exact === 'string' || typeof value.relative === 'string';
}

function isDateWindow(value: unknown): value is DateWindow {
  if (typeof value === 'string') return value in DATE_WINDOW_LABELS;
  return isRecord(value) && typeof value.count === 'number' && typeof value.unit === 'string';
}
