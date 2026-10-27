/**
 * Words the Filter and Sort panels show. Condition names come from the package (filterOpLabel),
 * and so do the limits; these are the rest.
 */
import { LIMITS, type DateWindow, type RelativeDay } from '@carehub/databases';
import { MAX_WINDOW_COUNT } from '@carehub/databases/schemas';

export const FILTER_TEXT = {
  filterBy: 'Filter by',
  noProperties: 'No properties to filter by.',
  advancedFilter: 'Advanced filter',
  addAdvancedFilter: 'Add advanced filter',
  turnIntoAdvanced: 'Turn into advanced filter',
  addRule: 'Add filter rule',
  addGroup: 'Add filter group',
  deleteFilter: 'Delete filter',
  duplicateRule: 'Duplicate rule',
  deleteRule: 'Delete rule',
  duplicateGroup: 'Duplicate group',
  deleteGroup: 'Delete group',
  filterGroup: 'Filter group',
  noRules: 'No filter rules yet.',
  property: 'Property',
  condition: 'Condition',
  value: 'Value',
  combinator: 'Match',
  allOf: 'All of',
  anyOf: 'Any of',
  deletedProperty: 'This property was deleted.',
  me: 'Me',
  unknownPerson: 'Unknown person',
  untitled: 'Untitled',
  searchRows: 'Search rows',
  noMatches: 'No matches',
  chooseDate: 'Choose a date',
  exactDate: 'Exact date',
  date: 'Date',
  start: 'Start',
  end: 'End',
  window: 'Within',
  custom: 'Custom',
  direction: 'Past or next',
  past: 'Past',
  next: 'Next',
  count: 'How many',
  unit: 'Unit',
  enterNumber: 'Enter a number.',
  windowCount: `Enter a whole number from 1 to ${MAX_WINDOW_COUNT.toLocaleString('en-US')}.`,
  maxConditions: `Filters can have up to ${LIMITS.filterConditions} conditions.`,
  maxLayers: `Filters can have up to ${LIMITS.filterDepth} layers.`,
} as const;

export const PANEL_TEXT = {
  filters: 'Filters',
  sorts: 'Sorts',
} as const;

export const SORT_TEXT = {
  sorts: 'Sorts',
  noSorts: 'No sorts yet. Rows keep their order in this view.',
  noProperties: 'No properties to sort by.',
  addSort: 'Add sort',
  deleteSort: 'Delete sort',
  property: 'Property',
  direction: 'Direction',
  ascending: 'Ascending',
  descending: 'Descending',
  maxSorts: `Up to ${LIMITS.sorts} sorts.`,
  move: (name: string) => `Move the sort on ${name}`,
  remove: (name: string) => `Remove the sort on ${name}`,
  moved: (name: string, position: number, count: number) =>
    `Moved the sort on ${name} to ${position} of ${count}.`,
} as const;

/** Relative days for date conditions, in menu order. */
export const RELATIVE_DAY_LABELS: Readonly<Record<RelativeDay, string>> = {
  today: 'Today',
  tomorrow: 'Tomorrow',
  yesterday: 'Yesterday',
  one_week_ago: 'One week ago',
  one_week_from_now: 'One week from now',
  one_month_ago: 'One month ago',
  one_month_from_now: 'One month from now',
};

/** Named windows for "Is within", in menu order. */
export const WINDOW_LABELS: Readonly<Record<Extract<DateWindow, string>, string>> = {
  this_week: 'This week',
  last_week: 'Last week',
  next_week: 'Next week',
  past_7_days: 'Past 7 days',
  next_7_days: 'Next 7 days',
  this_month: 'This month',
  last_month: 'Last month',
  next_month: 'Next month',
  past_30_days: 'Past 30 days',
  next_30_days: 'Next 30 days',
  this_year: 'This year',
  last_year: 'Last year',
  next_year: 'Next year',
};

export const WINDOW_UNIT_LABELS = {
  day: ['day', 'days'],
  week: ['week', 'weeks'],
  month: ['month', 'months'],
  year: ['year', 'years'],
} as const;

/** "This week", "Past 30 days", or a custom window such as "Past 3 weeks" and "Next 1 day". */
export function windowLabel(window: DateWindow): string {
  if (typeof window === 'string') return WINDOW_LABELS[window];
  const [one, many] = WINDOW_UNIT_LABELS[window.unit];
  const direction = window.direction === 'past' ? FILTER_TEXT.past : FILTER_TEXT.next;
  return `${direction} ${window.count} ${window.count === 1 ? one : many}`;
}
