/**
 * The shared contract for Care Hub databases and forms.
 *
 * Types and constants only. Every stored shape is plain JSON (it lives in Postgres jsonb
 * and travels over the API unchanged). Change this file only with the lane lead's OK:
 * every module in packages/databases and both apps depend on it.
 */

export type Id = string;
/** A calendar date with no time zone, "YYYY-MM-DD". Never shifts between time zones. */
export type CalendarDate = string;
/** An exact moment, ISO 8601 in UTC: "YYYY-MM-DDTHH:mm:ss.sssZ". Shown in the viewer's time zone. */
export type Instant = string;

// ---------------------------------------------------------------- access

/**
 * Access levels, lowest to highest (decision 0007). Compare with their position, never by name.
 * edit_content ("Can edit content", databases only): edit rows and their content, but not properties,
 * views, settings or new select options. Rows inherit it as edit.
 */
export const ACCESS_LEVELS = ['none', 'view', 'comment', 'edit_content', 'edit', 'full'] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

/**
 * What a share grants on a database. 'rows_only' ("Only rows they're in") is grant-only: it means view
 * on the database page; rows start at none and row access rules lift the rows the person is in.
 */
export type DatabaseGrant = AccessLevel | 'rows_only';

/** Someone a setting can name: one person, a group, or everyone with a workspace role. */
export interface Principal {
  type: 'user' | 'group' | 'role';
  id: Id;
}

// ---------------------------------------------------------------- viewer

export type WeekDay = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday

/** Who is looking, and how they like dates shown. Filters, groups and formats depend on it. */
export interface Viewer {
  userId: Id;
  /** IANA time zone from the profile; default "America/Denver". */
  timeZone: string;
  /** First day of the week; default 0 (Sunday). */
  weekStart: WeekDay;
  /** true: "3:30 PM"; false: "15:30". */
  hour12: boolean;
  /** The current moment. Always injected (tests pass a fixed date). */
  now: Date;
  /** Workspace role, for property access lists that name roles. */
  roleId?: Id;
  /** Groups the viewer belongs to (GET /api/workspace/groups), for lists that name groups. */
  groupIds?: readonly Id[];
  /** From GET /api/workspace/members (decision 0007 section 4.3). Guests see only what is shared with them. Absent: member. */
  kind?: 'member' | 'guest';
}

// ---------------------------------------------------------------- options

export const OPTION_COLORS = [
  'default',
  'gray',
  'brown',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'red',
] as const;
export type OptionColor = (typeof OPTION_COLORS)[number];

export interface SelectOption {
  id: Id;
  /** 1–100 characters, no commas, unique in the property ignoring case. */
  name: string;
  color: OptionColor;
  description?: string;
}

export const STATUS_GROUPS = ['todo', 'in_progress', 'complete'] as const;
export type StatusGroup = (typeof STATUS_GROUPS)[number];
export interface StatusOption extends SelectOption {
  group: StatusGroup;
}

// ---------------------------------------------------------------- rich text

export const TEXT_MARKS = ['bold', 'italic', 'underline', 'strike', 'code'] as const;
export type TextMark = (typeof TEXT_MARKS)[number];
/** Text color, or a background color with the "_background" suffix. */
export type TextColor =
  Exclude<OptionColor, 'default'> | `${Exclude<OptionColor, 'default'>}_background`;

export type Mention =
  { kind: 'user'; id: Id } | { kind: 'page'; id: Id } | { kind: 'date'; date: DateValue };

export interface RichTextSpan {
  /** The visible text. For a mention, the label at the time it was inserted (a fallback for search and export). */
  text: string;
  marks?: TextMark[];
  color?: TextColor;
  /** http or https only. */
  link?: string;
  mention?: Mention;
}
export type RichText = RichTextSpan[];

// ---------------------------------------------------------------- stored values

/**
 * A date with an optional end and an optional time.
 * hasTime false: start and end are CalendarDates. hasTime true: start and end are Instants.
 * The end is never before the start.
 */
export interface DateValue {
  start: string;
  end: string | null;
  hasTime: boolean;
  /**
   * Dates with a time only: show this value in a fixed IANA time zone (for example "America/Chicago")
   * instead of each viewer's own. Absent: the viewer's zone.
   */
  timeZone?: string;
  /** Remind the people in the row's Person properties (sent as a notice; the bell icon in the cell). */
  reminder?: DateReminder;
}

/**
 * When a date reminds. Dates with a time: minutes before the start (0 = at the time). Dates without a
 * time: days before, at 9:00 AM in each person's time zone (0 = on the day).
 */
export type DateReminder =
  { minutesBefore: 0 | 5 | 10 | 15 | 30 | 60 | 120 | 1440 | 2880 } | { daysBefore: 0 | 1 | 2 | 7 };

export interface FileRef {
  /** Upload id from the Phase 1 uploads API (for a web link: a new id of its own). */
  id: Id;
  name: string;
  size: number;
  mime: string;
  /** Set for a web link instead of an upload (size 0, mime ""). Must pass isSafeWebLink. */
  url?: string;
}

export interface ChecklistItem {
  id: Id;
  /** Up to 500 characters. */
  text: string;
  done: boolean;
}

/**
 * The stored value for each property type that stores one.
 * Empty is always "absent" (no key, or null): never "", [] or a blank date.
 * created_*, edited_*, unique_id, formula, rollup and button store nothing in Row.values.
 */
export interface StoredValueMap {
  /** Name: kept as the row page's title (Row.title), not in Row.values. */
  title: string;
  text: RichText;
  /** Exact decimal in canonical form (see decimal.ts), e.g. "-1234.5". Percent 45% is stored as "0.45". */
  number: string;
  /** Option id. */
  select: Id;
  /** Option ids in the order chosen (up to 100). */
  multi_select: Id[];
  /** Option id. */
  status: Id;
  date: DateValue;
  checkbox: boolean;
  url: string;
  email: string;
  phone: string;
  /** User ids (just one when the property is "one person only"). */
  person: Id[];
  /** Up to 20 uploads. */
  files: FileRef[];
  /** Row page ids in the target database (up to 500; just one when "one row only"). */
  relation: Id[];
  /** Up to 100 items. */
  checklist: ChecklistItem[];
}
export type StoredType = keyof StoredValueMap;

/** What a formula or rollup computes. The kind of a formula's result is fixed by the formula. */
export type ComputedValue =
  | { kind: 'empty' }
  /** rich: set when the formula used style() or link(); value is always the plain text. */
  | { kind: 'text'; value: string; rich?: RichText }
  | { kind: 'number'; value: number }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'date'; value: DateValue }
  | { kind: 'person'; value: Id }
  | { kind: 'page'; value: Id }
  | { kind: 'list'; value: ComputedValue[] }
  | { kind: 'error'; message: string };
export type ComputedKind = Exclude<ComputedValue['kind'], 'error' | 'empty'>;

// ---------------------------------------------------------------- property configs

export const NUMBER_FORMATS = ['number', 'number_commas', 'percent', 'currency'] as const;
export type NumberFormat = (typeof NUMBER_FORMATS)[number];
export type NumberDecimals = 'auto' | 0 | 1 | 2 | 3 | 4;

/** Common currencies first in the picker; any ISO 4217 code Intl knows is allowed. */
export const CURRENCIES = [
  'USD',
  'EUR',
  'GBP',
  'CAD',
  'AUD',
  'NZD',
  'JPY',
  'CNY',
  'HKD',
  'TWD',
  'KRW',
  'SGD',
  'INR',
  'IDR',
  'MYR',
  'PHP',
  'THB',
  'VND',
  'CHF',
  'SEK',
  'NOK',
  'DKK',
  'PLN',
  'CZK',
  'HUF',
  'RON',
  'TRY',
  'ILS',
  'AED',
  'SAR',
  'ZAR',
  'BRL',
  'MXN',
  'ARS',
  'CLP',
  'COP',
  'PEN',
  'UYU',
] as const;

/** How a number shows: Number properties, and number results of formulas and rollups. */
export interface NumberDisplay {
  format: NumberFormat;
  /** ISO 4217 code used when format is "currency"; default "USD". */
  currency: string;
  decimals: NumberDecimals;
  /** Notion-style display: a plain number, a bar or a ring (bar and ring need divideBy). */
  showAs: 'number' | 'bar' | 'ring';
  color: OptionColor;
  divideBy: number | null;
  showNumber: boolean;
}

/** Oct 26, 2026 · 10/26/2026 · 26/10/2026 · 2026-10-26 · relative (Today, Tomorrow, Yesterday, else full). */
export const DATE_FORMATS = ['full', 'mdy', 'dmy', 'ymd', 'relative'] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];
/** "viewer" follows the person's 12- or 24-hour setting. */
export type TimeFormat = 'viewer' | '12h' | '24h' | 'hidden';

export const AGGREGATES = [
  'none',
  'show_original',
  'show_unique',
  'count_all',
  'count_values',
  'count_unique',
  'count_empty',
  'count_not_empty',
  'percent_empty',
  'percent_not_empty',
  'sum',
  'average',
  'median',
  'min',
  'max',
  'range',
  'earliest',
  'latest',
  'date_range',
  'checked',
  'unchecked',
  'percent_checked',
  'percent_unchecked',
] as const;
/** Column totals (view calculations) and rollups share these. show_original and show_unique are rollup-only. */
export type Aggregate = (typeof AGGREGATES)[number];

/**
 * How a button or template changes one property. `set` takes a stored value, a DynamicDate, ME or
 * THIS_PAGE; `formula` is worked out when the button is pressed; add/remove change list items
 * (multi-select, person, relation); addNumber adds an exact decimal (negative to subtract).
 */
export type ValueEdit =
  { set: unknown } | { formula: string } | { add: Id[] } | { remove: Id[] } | { addNumber: string };

/**
 * One step of a Button property (up to LIMITS.buttonActions, run in order). See the Templates and
 * buttons spec. set_values is "Edit this row".
 */
export type ButtonAction =
  | {
      kind: 'set_values';
      /** Plain stored values (older buttons). */
      values: Record<Id, unknown>;
      /** Richer changes: Today, Now, Me, a formula, add or remove items, add to a number. */
      edits?: Record<Id, ValueEdit>;
    }
  | {
      kind: 'add_row';
      /** This database or another one the presser can edit. */
      databaseId: Id;
      templateId?: Id | null;
      edits: Record<Id, ValueEdit>;
      /** Open the new row afterwards. */
      open?: 'side_peek' | 'center_peek' | 'full_page' | null;
    }
  | {
      kind: 'edit_rows';
      databaseId: Id;
      /** Which rows (up to LIMITS.buttonEditRows); null: all of them. */
      filter: FilterGroup | null;
      edits: Record<Id, ValueEdit>;
    }
  | {
      kind: 'open_page';
      /** null: the row an earlier "Add a row" step made. */
      pageId: Id | null;
      openIn: 'side_peek' | 'center_peek' | 'full_page' | 'new_tab';
    }
  /** http and https only (isSafeWebLink), checked when saved and again before opening. */
  | { kind: 'open_link'; url: string }
  | {
      kind: 'send_message';
      /**
       * People, plus everyone in these Person properties of the row, in these groups and with these
       * roles, or every member (up to LIMITS.buttonMessagePeople in all). Roles and Everyone only
       * on buttons set up by Admins.
       */
      to: {
        userIds: Id[];
        propertyIds: Id[];
        /** Groups (Roles and permissions): their members. Absent: none. */
        groupIds?: Id[];
        /** Workspace roles: everyone who has one. Absent: none. */
        roleIds?: Id[];
        /** Every member of the workspace (not guests). Absent: false. */
        everyone?: boolean;
      };
      message: string;
    }
  | { kind: 'confirm'; title: string; message: string; confirmLabel: string }
  | { kind: 'define_variables'; variables: { id: Id; name: string; formula: string }[] };

export type PropertyConfig =
  | { type: 'title' }
  | { type: 'text' }
  | ({ type: 'number' } & NumberDisplay)
  | { type: 'select'; options: SelectOption[] }
  | { type: 'multi_select'; options: SelectOption[] }
  | { type: 'status'; options: StatusOption[]; defaultOptionId: Id }
  | { type: 'date'; format: DateFormat; timeFormat: TimeFormat }
  | { type: 'checkbox' }
  | { type: 'url' }
  | { type: 'email' }
  | { type: 'phone' }
  | { type: 'person'; single: boolean; notify: boolean }
  | { type: 'files' }
  | { type: 'relation'; targetDatabaseId: Id; single: boolean; twoWayPropertyId: Id | null }
  | { type: 'checklist' }
  | { type: 'created_time'; format: DateFormat; timeFormat: TimeFormat }
  | { type: 'edited_time'; format: DateFormat; timeFormat: TimeFormat }
  | { type: 'created_by' }
  | { type: 'edited_by' }
  | {
      type: 'formula';
      /** Stored form: property references use ids, prop("<property id>"). The editor shows names. */
      expression: string;
      /** Result kind found when the formula was last saved; null if it has an error. */
      resultKind: ComputedKind | null;
      /** How a number result shows; null means plain number. */
      number: NumberDisplay | null;
    }
  | {
      type: 'rollup';
      relationPropertyId: Id;
      /** A property of the related database (any type, formulas and rollups included). */
      targetPropertyId: Id;
      aggregate: Aggregate;
      number: NumberDisplay | null;
    }
  | { type: 'unique_id'; prefix: string | null }
  | {
      type: 'button';
      label: string;
      actions: ButtonAction[];
      icon?: string | null;
      color?: OptionColor;
      /** Who can press it: people who can edit the row (default), or everyone who can view it. */
      whoCanPress?: 'editors' | 'viewers';
    };

export type PropertyType = PropertyConfig['type'];
export type ConfigOf<T extends PropertyType> = Extract<PropertyConfig, { type: T }>;

export const PROPERTY_TYPES = [
  'title',
  'text',
  'number',
  'select',
  'multi_select',
  'status',
  'date',
  'checkbox',
  'url',
  'email',
  'phone',
  'person',
  'files',
  'relation',
  'checklist',
  'created_time',
  'edited_time',
  'created_by',
  'edited_by',
  'formula',
  'rollup',
  'unique_id',
  'button',
] as const satisfies readonly PropertyType[];

export interface Property<C extends PropertyConfig = PropertyConfig> {
  id: Id;
  /** 1–100 characters, unique in its database. */
  name: string;
  description: string;
  config: C;
  /** How it shows on row pages (per database). */
  rowPage: 'always' | 'hide_when_empty' | 'always_hide';
  /** Who can see and change it (set with Full access). Absent: everyone with access. Ignored for Name. */
  access?: PropertyAccess;
}

/**
 * Property access lists. null: everyone with access to the database. The server strips properties a
 * viewer can't see from every response (rows, views, totals, exports, search, formulas they feed).
 */
export interface PropertyAccess {
  see: Principal[] | null;
  /** Only people who can also see it. */
  change: Principal[] | null;
}

// ---------------------------------------------------------------- rows

export interface Row {
  /** The row's page id. */
  id: Id;
  /** The Name value (the page title). "" shows as "Untitled". */
  title: string;
  /** Property id → stored value for that property's type. Absent or null means empty. */
  values: Partial<Record<Id, unknown>>;
  createdAt: Instant;
  /** null for an anonymous form response. */
  createdBy: Id | null;
  editedAt: Instant;
  editedBy: Id | null;
  /** Number for the Unique ID property, given when the row is created. */
  uniqueNumber: number | null;
  icon?: string | null;
  /** The form (view id) this row was sent with, if any: "Sent with the form 'QA dispute request'". */
  formId?: Id | null;
}

// ---------------------------------------------------------------- filters

export const FILTER_OPS = [
  'is',
  'is_not',
  'contains',
  'does_not_contain',
  'starts_with',
  'ends_with',
  'eq',
  'neq',
  'gt',
  'lt',
  'gte',
  'lte',
  'group_is',
  'contains_any',
  'contains_all',
  'before',
  'after',
  'on_or_before',
  'on_or_after',
  'between',
  'within',
  'is_checked',
  'is_not_checked',
  'all_done',
  'not_all_done',
  'is_empty',
  'is_not_empty',
] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

export type RelativeDay =
  | 'today'
  | 'tomorrow'
  | 'yesterday'
  | 'one_week_ago'
  | 'one_week_from_now'
  | 'one_month_ago'
  | 'one_month_from_now';
export type DateRef = { exact: CalendarDate } | { relative: RelativeDay };
export type DateWindow =
  | 'this_week'
  | 'last_week'
  | 'next_week'
  | 'this_month'
  | 'last_month'
  | 'next_month'
  | 'this_year'
  | 'last_year'
  | 'next_year'
  | 'past_7_days'
  | 'next_7_days'
  | 'past_30_days'
  | 'next_30_days'
  | { direction: 'past' | 'next'; count: number; unit: 'day' | 'week' | 'month' | 'year' };

/**
 * Filter values by operator:
 * - text-like is/is_not/contains/does_not_contain/starts_with/ends_with: string
 * - eq/neq/gt/lt/gte/lte: string (exact decimal)
 * - select and status is/is_not: Id[] ("is any of" / "is none of"); status group_is: StatusGroup[]
 * - contains_any/contains_all/does_not_contain on multi-select, person, relation: Id[] (person may use "me")
 * - date is/before/after/on_or_before/on_or_after: DateRef; between: { start: DateRef; end: DateRef }; within: DateWindow
 * - checkbox, checklist, is_empty, is_not_empty: no value
 */
export type FilterValue =
  string | Id[] | StatusGroup[] | DateRef | { start: DateRef; end: DateRef } | DateWindow;

export interface FilterCondition {
  kind: 'condition';
  id: Id;
  propertyId: Id;
  op: FilterOp;
  value?: FilterValue;
}
export interface FilterGroup {
  kind: 'group';
  id: Id;
  combinator: 'and' | 'or';
  children: FilterNode[];
}
export type FilterNode = FilterCondition | FilterGroup;
/** The word for the viewer in person filters ("Me" means whoever is looking). */
export const ME = 'me';

// ---------------------------------------------------------------- sorts and groups

export interface Sort {
  propertyId: Id;
  direction: 'asc' | 'desc';
}

/** Key of the "No value" group. */
export const EMPTY_GROUP = '__empty__';

export interface Grouping {
  propertyId: Id;
  /** Dates: relative buckets (Today, Past 7 days, ...) or day, week, month, year. */
  dateBucket?: 'relative' | 'day' | 'week' | 'month' | 'year';
  /** Status: one group per option, or per status group. */
  statusBy?: 'option' | 'group';
  /** Text-like: exact value, or first letter. */
  textBy?: 'exact' | 'alphabetical';
  /** Numbers: buckets of `step` from `start` to `end`. */
  numberRange?: { start: number; end: number; step: number } | null;
  /**
   * Group order: option order, A to Z, Z to A, or manual (uses `order`). Unset: option order for
   * select, multi-select and status; A to Z for everything else. Relative dates go newest first.
   */
  sort?: 'option' | 'manual' | 'asc' | 'desc';
  /** Group keys in manual order; new groups go at the end. */
  order?: string[];
  /** Group keys hidden in this view (for example EMPTY_GROUP for "No value"). */
  hidden?: string[];
  hideEmpty?: boolean;
}

// ---------------------------------------------------------------- views

export const VIEW_LAYOUTS = [
  'table',
  'board',
  'list',
  'gallery',
  'calendar',
  'timeline',
  'chart',
  'form',
  'feed',
  'dashboard',
] as const;
export type ViewLayout = (typeof VIEW_LAYOUTS)[number];

export interface ViewPropertySetting {
  propertyId: Id;
  visible: boolean;
  /** Table column width, 80–800 px. */
  width?: number;
  /** Table: wrap this column. */
  wrap?: boolean;
}

export type CardPreview =
  { kind: 'none' } | { kind: 'cover' } | { kind: 'content' } | { kind: 'files'; propertyId: Id };

export interface TableOptions {
  /** Columns up to and including this one stay in place when scrolling sideways. */
  frozenUpTo: Id | null;
  wrapCells: boolean;
  showVerticalLines: boolean;
}
export interface BoardOptions {
  cardPreview: CardPreview;
  cardSize: 's' | 'm' | 'l';
  fitImage: boolean;
  colorColumns: boolean;
  /** The figure in each column header. Absent: Count all. */
  headerCalculation?: { propertyId: Id | null; aggregate: Aggregate };
}
export interface GalleryOptions {
  cardPreview: CardPreview;
  cardSize: 's' | 'm' | 'l';
  fitImage: boolean;
}
export interface CalendarOptions {
  /** A date, created time or edited time property. */
  showBy: Id | null;
  mode: 'month' | 'week';
  showWeekends: boolean;
}
export interface TimelineOptions {
  /** Start (or the whole range) comes from this date property. */
  showBy: Id | null;
  /** Optional separate end-date property. */
  endBy: Id | null;
  scale: 'hours' | 'day' | 'week' | 'bi_week' | 'month' | 'quarter' | 'year';
  showTable: boolean;
  tableProperties: ViewPropertySetting[];
  /** Absent: true. */
  showWeekends?: boolean;
  /** Properties shown on the bars. */
  barPropertyIds?: Id[];
  /** Draw dependency arrows (needs dependencies turned on). */
  showDependencies?: boolean;
}
export interface ChartOptions {
  kind: 'bar' | 'horizontal_bar' | 'line' | 'pie' | 'donut';
  /** Categories (bar, line) or slices (pie, donut). */
  xPropertyId: Id | null;
  xDateBucket: 'day' | 'week' | 'month' | 'quarter' | 'year';
  value: {
    aggregate: 'count' | 'sum' | 'average' | 'median' | 'min' | 'max';
    propertyId: Id | null;
  };
  /** Bar and line: split by a second property (top 10, the rest as "Other"). */
  splitBy: Id | null;
  order: 'option' | 'date' | 'alphabetical' | 'value_asc' | 'value_desc';
  showValues: boolean;
  showLegend: boolean;
  hideEmpty: boolean;
  stacked: boolean;
  cumulative: boolean;
  height: 's' | 'm' | 'l' | 'xl';
  /** Bars side by side instead of stacked (when split). */
  grouped?: boolean;
  /** Line charts: smooth curves. */
  smooth?: boolean;
  /** Labels on bars, points and slices. */
  dataLabels?: boolean;
  /** Value axis range; null ends are automatic. */
  axisRange?: { min: number | null; max: number | null };
  referenceLine?: { value: number; label: string } | null;
  palette?: 'default' | 'colorful' | 'colorblind' | 'mono';
  /** Donut: the figure in the middle. */
  centerValue?: boolean;
}

/** Feed: rows as posts, newest first, with their page content and comments. */
export interface FeedOptions {
  /** Show each row's page content (true) or only its title and properties. */
  showContent: boolean;
  showComments: boolean;
}

/** Dashboard: tiles in rows of up to LIMITS.dashboardColumns, up to LIMITS.dashboardWidgets. */
export interface DashboardWidget {
  id: Id;
  /** A view of this database (marked with dashboardId) drawn as the tile. */
  viewId: Id;
  /** Columns it spans. */
  width: 1 | 2 | 3 | 4;
  height: 's' | 'm' | 'l';
}
export interface DashboardOptions {
  /** Row by row, left to right. */
  widgets: DashboardWidget[];
}

/**
 * Conditional color: the first matching row rule colors the row; a matching property rule colors that
 * cell and beats the row color. Colors must keep text readable (4.5:1) in light and dark.
 */
export interface ColorRule {
  id: Id;
  filter: FilterGroup;
  target: { kind: 'row' } | { kind: 'property'; propertyId: Id };
  color: OptionColor;
}

export interface View {
  id: Id;
  name: string;
  layout: ViewLayout;
  filter: FilterGroup | null;
  /** Up to 10. Empty: rows keep the view's manual order. */
  sorts: Sort[];
  /** Required for board. Optional for table, list, gallery and timeline. */
  grouping: Grouping | null;
  /** Board only. */
  subGrouping: Grouping | null;
  /** Display order and visibility. Properties missing here are hidden and come last. */
  properties: ViewPropertySetting[];
  /** Row ids in manual order, used while `sorts` is empty. Rows missing here come last, oldest first. */
  manualOrder: Id[];
  openPagesIn: 'side_peek' | 'center_peek' | 'full_page';
  showPageIcon: boolean;
  /** Rows shown before "Load more" (per group). Default 50 in every layout. */
  loadLimit: 10 | 25 | 50 | 100 | 200;
  /** Column totals: property id → calculation. */
  calculations: Partial<Record<Id, Aggregate>>;
  /** Template used by New in this view. undefined: the database default; null: an empty row. */
  defaultTemplateId?: Id | null;
  table?: TableOptions;
  board?: BoardOptions;
  gallery?: GalleryOptions;
  calendar?: CalendarOptions;
  timeline?: TimelineOptions;
  chart?: ChartOptions;
  form?: FormDefinition;
  feed?: FeedOptions;
  dashboard?: DashboardOptions;
  /** Set on a view that is a tile of this dashboard view: it isn't listed in the view tabs. */
  dashboardId?: Id;
  /** Up to LIMITS.colorRules, first match wins. */
  colorRules?: ColorRule[];
  /** Sub-items (when on for the database): nested under parents, flat, or only top-level rows. */
  subItems?: 'nested' | 'flattened' | 'parents_only';
  /**
   * Nested sub-items: filters also apply to sub-items (a matching sub-item shows under its parents,
   * which show greyed out as context). Absent: false (filters apply to top-level rows, which show
   * with all their sub-items).
   */
  filterSubItems?: boolean;
  /** Show the Name column or card title. Absent: true. */
  showTitle?: boolean;
  /** Wrap all property text (list, gallery, board, timeline). Absent: false. */
  wrapText?: boolean;
  /** Linked views and database blocks: views as tabs or a dropdown. Absent: tabs. */
  tabsAs?: 'tabs' | 'dropdown';
}

/** What someone without Can edit changed for themselves ("Changed for you only · Reset"). Never saved. */
export interface ViewOverride {
  filter?: FilterGroup | null;
  sorts?: Sort[];
  grouping?: Grouping | null;
}

// ---------------------------------------------------------------- forms

export type FormConditionOp =
  | 'is'
  | 'is_not'
  | 'contains'
  | 'does_not_contain'
  | 'eq'
  | 'neq'
  | 'gt'
  | 'lt'
  | 'gte'
  | 'lte'
  | 'is_any_of'
  | 'is_none_of'
  | 'contains_any'
  | 'contains_all'
  | 'contains_none'
  | 'is_checked'
  | 'is_not_checked'
  | 'before'
  | 'after'
  | 'is_empty'
  | 'is_not_empty';

export interface FormCondition {
  id: Id;
  /** The earlier question this depends on (questions are keyed by property id). */
  questionPropertyId: Id;
  op: FormConditionOp;
  /** string for text and numbers (exact decimal), Id[] for options, people and rows, CalendarDate for dates. */
  value?: string | Id[];
}
export interface FormLogic {
  combinator: 'and' | 'or';
  /** Up to 10. */
  conditions: FormCondition[];
}
export interface FormQuestion {
  propertyId: Id;
  /** Starts as the property name; changing it doesn't rename the property. */
  text: string;
  description: RichText;
  required: boolean;
  /** Text: short or long answer. Select: radio buttons up to 7 options, or always a dropdown. */
  display: 'default' | 'long' | 'dropdown';
  /** Shown only when this matches. Never on the first question. */
  logic: FormLogic | null;
  /** Set when a condition was removed because its property or option was deleted ("Logic changed"). */
  logicChanged?: boolean;
}
export interface FormDefinition {
  title: string;
  description: RichText;
  /** Up to 100, in order. */
  questions: FormQuestion[];
  submitLabel: string;
  confirmation: RichText;
  allowMultiple: boolean;
  accepting: boolean;
  /** Secret part of the form link. "Change link" replaces it. */
  linkCode: string;
  linkChangedAt: Instant | null;
  /** Felipe approved anonymous responses (FM-D1): off by default, a setting per form. */
  anonymous: boolean;
  /** People who asked to be notified about new responses. */
  notifyUserIds: Id[];
  /**
   * Who can respond. Absent: members. 'anyone': anyone on the network without signing in (FM-D2,
   * off by default): always anonymous, no Person or Relation questions.
   */
  audience?: 'members' | 'members_and_guests' | 'anyone';
  /** Stops taking responses at this moment ("This form closed on Oct 30, 2026."). */
  closeAt?: Instant | null;
  /** Stops after this many responses ("This form isn't taking more responses."). */
  maxResponses?: number | null;
  cover?: FileRef | null;
  icon?: string | null;
}

// ---------------------------------------------------------------- row-level access

/** People named in this property (Person or Created by) get `level` on that row. */
export interface RowAccessRule {
  id: Id;
  propertyId: Id;
  level: Exclude<AccessLevel, 'none'>;
}

// ---------------------------------------------------------------- row templates and databases

/** A preset date that resolves when the row is made: today's date, or this moment, plus offsetDays ("Today + 3 days"). */
export type DynamicDate = { dynamic: 'today' | 'now'; offsetDays?: number };

/** In a template's or button's relation value: the page the template or button runs from. */
export const THIS_PAGE = 'this_page';

/**
 * Repeating template: makes a row on a schedule ("Weekly huddle – Oct 26"), as "Created by Sam Ortiz
 * (repeating)". Up to LIMITS.repeatingTemplates per database. A run missed by less than 24 hours still runs.
 */
export interface RepeatSchedule {
  every: 'day' | 'weekday' | 'week' | 'month' | 'year';
  /** Every N days, weeks, months or years. Absent: 1. */
  interval?: number;
  /** Weekly: which days (0 = Sunday). */
  weekDays?: WeekDay[];
  /** Monthly: day 1–28, or the last day. */
  monthDay?: number | 'last';
  /** Yearly: month 1–12 (the day comes from monthDay). */
  month?: number;
  /** "HH:MM", in quarter hours. */
  time: string;
  timeZone: string;
  start: CalendarDate;
  /** Ending on a date: the last day it makes a row. null: no end date. */
  end: CalendarDate | null;
  /**
   * Ending after a number of times: how many more rows it makes, up to LIMITS.repeatTimes. The
   * server counts it down after each row it makes; at 0 the repeat has ended (saving it as it is
   * still works). Not set together with an end date. Absent or null: no such limit.
   */
  timesLeft?: number | null;
  paused: boolean;
  /**
   * Who set it up; the rows are created under their name. If they lose access, it pauses and the
   * people with Full access on the database get a notice.
   */
  ownerId: Id;
}

/**
 * A template for new rows. Its icon, cover and content live on its own page (id), which is never
 * shown as a row: not in views, search, counts, totals, rollups, charts or exports.
 */
export interface RowTemplate {
  id: Id;
  name: string;
  icon: string | null;
  /** Preset values in stored form. A date may be a DynamicDate; a person list may contain ME (the person creating the row). */
  values: Partial<Record<Id, unknown>>;
  repeat?: RepeatSchedule | null;
}

/** How row pages look in this database (Customize page). */
export interface RowPageLayout {
  /** Up to LIMITS.rowPagePinned properties shown under the title. */
  pinned: Id[];
  /** The other properties: listed in the page, in a side panel, or hidden. */
  properties: 'in_page' | 'panel' | 'hidden';
  comments: 'full' | 'compact' | 'off';
  backlinks: 'list' | 'count' | 'off';
}

/** A database as the API returns it (its id is its page id). */
export interface DatabaseMeta {
  id: Id;
  title: string;
  icon: string | null;
  description: RichText;
  /** true: shown inside a page by a database block; false: its own page. */
  inline: boolean;
  /** Lock structure: nobody changes properties, views or forms while on. Rows stay editable. */
  locked: boolean;
  properties: Property[];
  views: View[];
  /** Row-level access rules (DB-D2). Only people with Full access see and change them. */
  accessRules: RowAccessRule[];
  templates: RowTemplate[];
  /** Database-wide default template; null: New makes an empty row. */
  defaultTemplateId: Id | null;
  /** The viewer's access. 'rows_only': no access to the database itself, only rows that rules give them. */
  viewerAccess: DatabaseGrant;
  /** With 'rows_only': the share also lets them add rows ("Can add rows"). */
  viewerCanAddRows?: boolean;
  rowPageLayout?: RowPageLayout;
  /** Sub-items: a "Parent item" relation to this database and its two-way "Sub-items" pair. */
  subItems?: { parentPropertyId: Id; childrenPropertyId: Id } | null;
  /** Dependencies: "Blocked by" and "Blocking" relations; moving a blocker shifts what it blocks, or not. */
  dependencies?: {
    blockedByPropertyId: Id;
    blockingPropertyId: Id;
    shift: 'shift' | 'none';
  } | null;
}

// ---------------------------------------------------------------- evaluation context

/** Everything the pure engines need besides the rows themselves. */
export interface EvalContext {
  properties: readonly Property[];
  viewer: Viewer;
  /** Display name for a user id; undefined if unknown. Removed members still have a name. */
  userName(id: Id): string | undefined;
  /** Title of a related row, or undefined when the viewer can't open it. */
  rowTitle?(id: Id): string | undefined;
  /** Value of a formula or rollup property for a row. */
  computed?(row: Row, propertyId: Id): ComputedValue;
  /** true for people who were removed from the workspace (their name shows as "Name (removed)"). */
  isRemovedUser?(id: Id): boolean;
}

// ---------------------------------------------------------------- limits

export const LIMITS = {
  properties: 200,
  views: 100,
  rows: 50_000,
  propertyName: 100,
  title: 2_000,
  text: 10_000,
  optionName: 100,
  multiSelectValues: 100,
  files: 20,
  formFiles: 10,
  relationLinks: 500,
  checklistItems: 100,
  checklistItemText: 500,
  url: 2_000,
  email: 254,
  phone: 50,
  numberIntegerDigits: 15,
  numberFractionDigits: 10,
  sorts: 10,
  filterConditions: 50,
  /** Root group plus nested groups: up to 3 layers, like Notion. */
  filterDepth: 3,
  formQuestions: 100,
  formConditions: 10,
  formDescription: 2_000,
  formResponsesPerMinute: 10,
  columnWidthMin: 80,
  columnWidthMax: 800,
  csvBytes: 10 * 1024 * 1024,
  csvRows: 20_000,
  csvColumns: 200,
  chartCategories: 50,
  chartSplits: 10,
  undoSteps: 20,
  deletedPropertyDays: 30,
  undoToastMs: 8_000,
  /** Characters in a formula as stored. */
  formulaLength: 10_000,
  /** Evaluation steps per formula per row before "This formula is too complex." */
  formulaSteps: 100_000,
  /** Items in any list a formula builds. */
  formulaListItems: 10_000,
  /** Nesting depth of a formula expression. */
  formulaNesting: 100,
  /** Longest chain of formulas and rollups that read other formulas and rollups, across databases. */
  computedChain: 10,
  /** Formulas read related rows at most this many relations away. */
  formulaRelationDepth: 2,
  /** Time per formula per row before "⚠ Too slow". */
  formulaTimeMs: 50,
  /** Pattern functions (test, match, replace, replaceAll): longest pattern and longest text searched. */
  formulaPatternLength: 200,
  formulaPatternInput: 10_000,
  /** List items a cell shows before "+12 more". */
  formulaListShown: 100,
  rowAccessRules: 10,
  templates: 50,
  /** Rows per database query response (the client asks for more as you scroll). */
  queryPageRows: 100,
  loadLimitMax: 200,
  /** Responses per minute for one form anyone can fill in, from everyone together. */
  formAnyoneResponsesPerMinute: 30,
  colorRules: 10,
  subItemDepth: 10,
  /** Rows one date change may shift through dependencies before it stops and says so. */
  dependencyShiftRows: 500,
  rowPagePinned: 4,
  dashboardWidgets: 12,
  dashboardColumns: 4,
  repeatingTemplates: 10,
  /** Most times a repeat can be set to end after (ours; the spec has none). */
  repeatTimes: 1_000,
  buttonActions: 10,
  buttonEditRows: 500,
  buttonMessagePeople: 50,
  buttonRunLog: 50,
} as const;
