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

/** Access levels from Phase 1 sharing, lowest to highest. */
export const ACCESS_LEVELS = ['none', 'view', 'comment', 'edit', 'full'] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

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
}

export interface FileRef {
  /** Upload id from the Phase 1 uploads API. */
  id: Id;
  name: string;
  size: number;
  mime: string;
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

export type ButtonAction =
  { kind: 'set_values'; values: Record<Id, unknown> } | { kind: 'open_link'; url: string };

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
  | { type: 'button'; label: string; actions: ButtonAction[] };

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
  /** Group order: manual (uses `order`), or by value. */
  sort?: 'manual' | 'asc' | 'desc';
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
  /** Rows shown before "Load more" (per group). */
  loadLimit: 10 | 25 | 50 | 100;
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
}

// ---------------------------------------------------------------- row-level access

/** People named in this property (Person or Created by) get `level` on that row. */
export interface RowAccessRule {
  id: Id;
  propertyId: Id;
  level: Exclude<AccessLevel, 'none'>;
}

// ---------------------------------------------------------------- row templates and databases

/** A preset date that resolves when the row is made: today's date, or this moment. */
export type DynamicDate = { dynamic: 'today' | 'now' };

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
  viewerAccess: AccessLevel | 'rows_only';
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
  computedChain: 5,
  rowAccessRules: 10,
  templates: 50,
  /** Rows per database query response (the client asks for more as you scroll). */
  queryPageRows: 100,
} as const;
