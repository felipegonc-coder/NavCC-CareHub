/** What the Group panel says (Databases spec 3.2 and 3.3). */
import type { Grouping } from '@carehub/databases';

type DateBucket = NonNullable<Grouping['dateBucket']>;
type GroupSort = NonNullable<Grouping['sort']>;

export const GROUP_TEXT = {
  groupBy: 'Group by',
  subGroupBy: 'Sub-group by',
  none: 'None',
  noProperties: 'No properties to group by.',
  notGrouped: "This layout doesn't group rows.",
  dateBy: 'Group dates by',
  statusBy: 'Group status by',
  option: 'Option',
  statusGroup: 'Status group',
  textBy: 'Group text by',
  numberBy: 'Group numbers by',
  exactValue: 'Exact value',
  firstLetter: 'First letter',
  ranges: 'Ranges',
  from: 'From',
  to: 'To',
  size: 'Size',
  rangeNumbers: 'Enter a number in From, To and Size.',
  rangeSize: 'The size must be above 0.',
  sortGroups: 'Sort groups',
  hideEmpty: 'Hide empty groups',
  groups: 'Groups',
  lanes: 'Sub-groups',
  showAll: 'Show all',
  hideAll: 'Hide all',
  show: (label: string) => `Show ${label}`,
  hide: (label: string) => `Hide ${label}`,
  move: (label: string) => `Move ${label}`,
  moved: (label: string, position: number, count: number) =>
    `Moved ${label} to ${position} of ${count}.`,
} as const;

/** Date groups (spec 3.2: Relative, or by day, week, month or year), in menu order. */
export const DATE_BUCKETS: readonly DateBucket[] = ['relative', 'day', 'week', 'month', 'year'];

export const DATE_BUCKET_LABELS: Readonly<Record<DateBucket, string>> = {
  relative: 'Relative',
  day: 'Day',
  week: 'Week',
  month: 'Month',
  year: 'Year',
};

/** Group order (spec 3.2: "option order, A→Z or Z→A, or by hand"), in menu order. */
export const GROUP_SORT_LABELS: Readonly<Record<GroupSort, string>> = {
  option: 'Option order',
  asc: 'A→Z',
  desc: 'Z→A',
  manual: 'By hand',
};
