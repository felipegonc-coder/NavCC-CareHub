import { describe, expect, it } from 'vitest';
import {
  CHART_MESSAGES,
  OTHER_KEY,
  VALUE_SERIES_KEY,
  canChartBy,
  canChartValue,
  chartData,
  chartPropertyIds,
  chartValueLabel,
  validateChartOptions,
  type ChartData,
} from './chart';
import { EMPTY_COLOR, OPTION_CHART_COLORS, OTHER_COLOR, paletteColor } from './chart-palette';
import { fromPlainText } from './richtext';
import {
  EMPTY_GROUP,
  type ChartOptions,
  type ComputedValue,
  type EvalContext,
  type Property,
  type PropertyConfig,
  type Row,
  type SelectOption,
  type Viewer,
} from './types';

// ------------------------------------------------------------------ fixtures (fictional)

const prop = <C extends PropertyConfig>(id: string, name: string, config: C): Property<C> => ({
  id,
  name,
  description: '',
  config,
  rowPage: 'always',
});
const opt = (id: string, name: string, color: SelectOption['color']): SelectOption => ({
  id,
  name,
  color,
});
const NUMBER = {
  format: 'number',
  currency: 'USD',
  decimals: 'auto',
  showAs: 'number',
  color: 'blue',
  divideBy: null,
  showNumber: true,
} as const;
const formula = (
  id: string,
  resultKind: 'number' | 'text' | 'boolean' | 'date' | 'person' | 'list',
) =>
  prop(id, id, {
    type: 'formula',
    expression: '',
    resultKind,
    number: resultKind === 'number' ? { ...NUMBER, format: 'percent' } : null,
  });

const title = prop('title', 'Name', { type: 'title' });
const status = prop('status', 'Status', {
  type: 'status',
  options: [
    { id: 's-todo', name: 'Not started', color: 'default', group: 'todo' },
    { id: 's-doing', name: 'In progress', color: 'blue', group: 'in_progress' },
    { id: 's-done', name: 'Done', color: 'green', group: 'complete' },
  ],
  defaultOptionId: 's-todo',
});
// Option order differs from A to Z.
const trade = prop('trade', 'Trade', {
  type: 'select',
  options: [
    opt('o-plumb', 'Plumbing', 'blue'),
    opt('o-hvac', 'HVAC', 'orange'),
    opt('o-elec', 'Electrical', 'yellow'),
  ],
});
const tags = prop('tags', 'Tags', {
  type: 'multi_select',
  options: [opt('t-urgent', 'Urgent', 'red'), opt('t-repeat', 'Repeat visit', 'purple')],
});
const owner = prop('owner', 'Owner', { type: 'person', single: false, notify: false });
const done = prop('done', 'Done', { type: 'checkbox' });
const hours = prop('hours', 'Hours', { type: 'number', ...NUMBER });
const cost = prop('cost', 'Cost', { type: 'number', ...NUMBER, format: 'currency', decimals: 2 });
const oddCost = prop('oddCost', 'Odd cost', {
  type: 'number',
  ...NUMBER,
  format: 'currency',
  currency: 'not a code',
  decimals: 2,
});
const due = prop('due', 'Due', { type: 'date', format: 'full', timeFormat: 'viewer' });
const notes = prop('notes', 'Notes', { type: 'text' });
const site = prop('site', 'Site', { type: 'url' });
const createdBy = prop('createdBy', 'Created by', { type: 'created_by' });
const created = prop('created', 'Created', {
  type: 'created_time',
  format: 'full',
  timeFormat: 'viewer',
});
const files = prop('files', 'Files', { type: 'files' });
const link = prop('link', 'Jobs', {
  type: 'relation',
  targetDatabaseId: 'db-jobs',
  single: false,
  twoWayPropertyId: null,
});
const score = formula('score', 'number');
const label = formula('label', 'text');
const urgentF = formula('urgentF', 'boolean');
const dueF = formula('dueF', 'date');
const leadF = formula('leadF', 'person');
const listF = formula('listF', 'list');
const brokenF = prop('brokenF', 'brokenF', {
  type: 'formula',
  expression: '',
  resultKind: null,
  number: null,
});
const totalHours = prop('totalHours', 'Total hours', {
  type: 'rollup',
  relationPropertyId: 'link',
  targetPropertyId: 'hours',
  aggregate: 'sum',
  number: null,
});
const jobNames = prop('jobNames', 'Job names', {
  type: 'rollup',
  relationPropertyId: 'link',
  targetPropertyId: 'title',
  aggregate: 'show_original',
  number: null,
});
const ticket = prop('ticket', 'Ticket', { type: 'unique_id', prefix: 'BP' });

const properties: Property[] = [
  title,
  status,
  trade,
  tags,
  owner,
  done,
  hours,
  cost,
  oddCost,
  due,
  notes,
  site,
  createdBy,
  created,
  files,
  link,
  score,
  label,
  urgentF,
  dueF,
  leadF,
  listF,
  brokenF,
  totalHours,
  jobNames,
  ticket,
];

const USERS: Record<string, string> = { 'u-avery': 'Avery Lin', 'u-jordan': 'Jordan Park' };
const VIEWER: Viewer = {
  userId: 'u-avery',
  timeZone: 'America/Denver',
  weekStart: 0,
  hour12: true,
  now: new Date('2026-10-26T18:00:00Z'),
};
const context = (viewer: Partial<Viewer> = {}, over: Partial<EvalContext> = {}): EvalContext => ({
  properties,
  viewer: { ...VIEWER, ...viewer },
  userName: (id) => USERS[id],
  isRemovedUser: (id) => id === 'u-jordan',
  rowTitle: (id) => (id === 'p-hidden' ? undefined : id === 'p-blank' ? '' : `Job ${id}`),
  // Formula and rollup results live in the row values in these tests.
  computed: (row, id) => (row.values[id] as ComputedValue | undefined) ?? { kind: 'empty' },
  ...over,
});
const ctx = context();

const row = (id: string, values: Record<string, unknown> = {}, extra: Partial<Row> = {}): Row => ({
  id,
  title: `Blue Pine Plumbing job ${id}`,
  values,
  createdAt: '2026-10-01T15:00:00Z',
  createdBy: 'u-avery',
  editedAt: '2026-10-01T15:00:00Z',
  editedBy: 'u-avery',
  uniqueNumber: null,
  ...extra,
});

const chart = (over: Partial<ChartOptions> = {}): ChartOptions => ({
  kind: 'bar',
  xPropertyId: 'status',
  xDateBucket: 'month',
  value: { aggregate: 'count', propertyId: null },
  splitBy: null,
  order: 'option',
  showValues: false,
  showLegend: true,
  hideEmpty: false,
  stacked: true,
  cumulative: false,
  height: 'm',
  ...over,
});
const data = (rows: Row[], over: Partial<ChartOptions> = {}, c: EvalContext = ctx): ChartData =>
  chartData(rows, { chart: chart(over) }, c);
const value = (
  aggregate: ChartOptions['value']['aggregate'],
  propertyId: string | null = 'hours',
): Pick<ChartOptions, 'value'> => ({ value: { aggregate, propertyId } });

const labels = (d: ChartData) => d.categories.map((c) => c.label);
const keys = (d: ChartData) => d.categories.map((c) => c.key);
const texts = (d: ChartData, s = 0) => d.series[s]?.values.map((p) => p.text);
const exacts = (d: ChartData, s = 0) => d.series[s]?.values.map((p) => p.exact);
const totals = (d: ChartData) => d.categories.map((c) => c.total.exact);

const statusRows = (): Row[] => [
  row('r1', { status: 's-todo', owner: ['u-avery'], hours: '2' }),
  row('r2', { status: 's-doing', owner: ['u-jordan'], hours: '1.5' }),
  row('r3', { status: 's-doing', owner: ['u-avery', 'u-jordan'], hours: '3' }),
  row('r4', { status: 's-done', hours: '4' }),
  row('r5', { owner: ['u-avery'] }),
];

// ------------------------------------------------------------------ categories

describe('chartData categories', () => {
  it('counts rows by status in option order, keeping options without rows (DB-13)', () => {
    const rows = [...statusRows(), row('r6', { status: 's-doing' })];
    const d = data(rows);
    expect(d.problem).toBeNull();
    expect(labels(d)).toEqual(['Not started', 'In progress', 'Done', 'No value']);
    expect(keys(d)).toEqual(['o:s-todo', 'o:s-doing', 'o:s-done', EMPTY_GROUP]);
    expect(d.series).toHaveLength(1);
    expect(d.series[0]).toMatchObject({ key: VALUE_SERIES_KEY, label: 'Count' });
    expect(exacts(d)).toEqual(['1', '3', '1', '1']);
    expect(texts(d)).toEqual(['1', '3', '1', '1']);
    expect(d.series[0]?.values[1]?.value).toBe(3);
    expect(d.series[0]?.values[1]?.rowIds).toEqual(['r2', 'r3', 'r6']);
    expect(d.total).toEqual({ exact: '6', value: 6, text: '6' });
    expect(d.valueLabel).toBe('Count');
  });

  it('follows the rows it is given, so a filtered view matches its filter (DB-13)', () => {
    const filtered = statusRows().filter((r) => r.values.status !== 's-todo');
    const d = data(filtered);
    expect(labels(d)).toEqual(['Not started', 'In progress', 'Done', 'No value']);
    expect(exacts(d)).toEqual(['0', '2', '1', '1']);
    expect(d.total.exact).toBe('4');
  });

  it('shows every option at 0 when there are no rows', () => {
    const d = data([]);
    expect(labels(d)).toEqual(['Not started', 'In progress', 'Done']);
    expect(exacts(d)).toEqual(['0', '0', '0']);
    expect(d.series[0]?.values[0]?.rowIds).toEqual([]);
    expect(d.total.exact).toBe('0');
  });

  it('leaves out No value with "Hide empty" but keeps options without rows', () => {
    const d = data(statusRows(), { hideEmpty: true });
    expect(labels(d)).toEqual(['Not started', 'In progress', 'Done']);
    expect(exacts(d)).toEqual(['1', '2', '1']);
    expect(d.total.exact).toBe('4');
  });

  it('counts a multi-select row once in each of its options', () => {
    const rows = [
      row('r1', { tags: ['t-urgent', 't-repeat'] }),
      row('r2', { tags: ['t-urgent', 't-urgent'] }),
      row('r3', { tags: [] }),
    ];
    const d = data(rows, { xPropertyId: 'tags' });
    expect(labels(d)).toEqual(['Urgent', 'Repeat visit', 'No value']);
    expect(exacts(d)).toEqual(['2', '1', '1']);
    expect(d.series[0]?.values[0]?.rowIds).toEqual(['r1', 'r2']);
    // Slices add up to the total.
    expect(d.total.exact).toBe('4');
  });

  it('counts options that no longer exist as No value', () => {
    const d = data([row('r1', { trade: 'o-gone' }), row('r2', { trade: 'o-hvac' })], {
      xPropertyId: 'trade',
    });
    expect(labels(d)).toEqual(['Plumbing', 'HVAC', 'Electrical', 'No value']);
    expect(exacts(d)).toEqual(['0', '1', '0', '1']);
  });

  it('names people, marks removed people and skips unknown ones', () => {
    const rows = [
      row('r1', { owner: ['u-jordan', 'u-avery'] }),
      row('r2', { owner: ['u-avery'] }),
      row('r3', { owner: ['u-ghost'] }),
      row('r4', {}),
    ];
    const d = data(rows, { xPropertyId: 'owner' });
    expect(labels(d)).toEqual(['Avery Lin', 'Jordan Park (removed)', 'No value']);
    expect(keys(d)).toEqual(['u:u-avery', 'u:u-jordan', EMPTY_GROUP]);
    expect(exacts(d)).toEqual(['2', '1', '2']);
  });

  it('shows anonymous form responses as "Anonymous" for Created by', () => {
    const rows = [
      row('r1'),
      row('r2', {}, { createdBy: null }),
      row('r3', {}, { createdBy: 'u-jordan' }),
    ];
    const d = data(rows, { xPropertyId: 'createdBy' });
    expect(labels(d)).toEqual(['Avery Lin', 'Jordan Park (removed)', 'Anonymous']);
    expect(keys(d)[2]).toBe(EMPTY_GROUP);
    expect(exacts(d)).toEqual(['1', '1', '1']);
  });

  it('always shows Unchecked then Checked for checkboxes, and never No value', () => {
    const d = data([row('r1', { done: true }), row('r2', { done: false }), row('r3')], {
      xPropertyId: 'done',
    });
    expect(labels(d)).toEqual(['Unchecked', 'Checked']);
    expect(keys(d)).toEqual(['b:false', 'b:true']);
    expect(exacts(d)).toEqual(['2', '1']);
    expect(labels(data([], { xPropertyId: 'done' }))).toEqual(['Unchecked', 'Checked']);
  });

  it('groups text, names and links by their exact value, A to Z', () => {
    const rows = [
      row('r1', { notes: fromPlainText('Water heater 10') }),
      row('r2', { notes: fromPlainText('Leak under sink') }),
      row('r3', { notes: fromPlainText('Water heater 9') }),
      row('r4', { notes: fromPlainText('Leak under sink') }),
      row('r5', { notes: [] }),
    ];
    const d = data(rows, { xPropertyId: 'notes' });
    expect(labels(d)).toEqual(['Leak under sink', 'Water heater 9', 'Water heater 10', 'No value']);
    expect(exacts(d)).toEqual(['2', '1', '1', '1']);
    expect(keys(d)[0]).toBe('t:Leak under sink');

    const byName = data([row('r1'), row('r2', {}, { title: '' })], { xPropertyId: 'title' });
    expect(labels(byName)).toEqual(['Blue Pine Plumbing job r1', 'No value']);
    const bySite = data(
      [row('r1', { site: 'https://bluepine.example' }), row('r2', { site: 'javascript:alert(1)' })],
      { xPropertyId: 'site' },
    );
    expect(labels(bySite)).toEqual(['https://bluepine.example', 'No value']);
  });

  it('uses formula and rollup results: text, true or false, people and lists', () => {
    const text = data(
      [
        row('r1', { label: { kind: 'text', value: 'Callback' } }),
        row('r2', { label: { kind: 'text', value: '' } }),
        row('r3', { label: { kind: 'error', message: 'Bad formula' } }),
      ],
      { xPropertyId: 'label' },
    );
    expect(labels(text)).toEqual(['Callback', 'No value']);
    expect(exacts(text)).toEqual(['1', '2']);

    const flags = data([row('r1', { urgentF: { kind: 'boolean', value: true } }), row('r2')], {
      xPropertyId: 'urgentF',
    });
    expect(labels(flags)).toEqual(['Unchecked', 'Checked', 'No value']);
    expect(exacts(flags)).toEqual(['0', '1', '1']);

    const lead = data([row('r1', { leadF: { kind: 'person', value: 'u-avery' } })], {
      xPropertyId: 'leadF',
    });
    expect(labels(lead)).toEqual(['Avery Lin']);

    const list = data(
      [
        row('r1', {
          jobNames: {
            kind: 'list',
            value: [
              { kind: 'text', value: 'Boiler' },
              { kind: 'text', value: 'Boiler' },
              { kind: 'number', value: 12 },
              { kind: 'number', value: 3 },
              { kind: 'page', value: 'p-7' },
              { kind: 'page', value: 'p-blank' },
              { kind: 'page', value: 'p-hidden' },
              { kind: 'list', value: [{ kind: 'person', value: 'u-jordan' }] },
            ],
          },
        }),
        row('r2', { jobNames: { kind: 'list', value: [] } }),
      ],
      { xPropertyId: 'jobNames' },
    );
    expect(labels(list)).toEqual([
      '3',
      '12',
      'Boiler',
      'Job p-7',
      'Jordan Park (removed)',
      'Untitled',
      'No value',
    ]);
    expect(exacts(list)).toEqual(['1', '1', '1', '1', '1', '1', '1']);
  });
});

// ------------------------------------------------------------------ dates

describe('chartData dates', () => {
  const dated = (id: string, start: string, extra: Record<string, unknown> = {}): Row =>
    row(id, { due: { start, end: null, hasTime: false }, ...extra });

  it('shows months without rows as 0 between the first and last date (DB-13)', () => {
    const rows = [
      dated('r1', '2026-07-03'),
      dated('r2', '2026-07-20'),
      dated('r3', '2026-10-05'),
      row('r4'),
    ];
    const d = data(rows, { kind: 'line', xPropertyId: 'due' });
    expect(labels(d)).toEqual([
      'July 2026',
      'August 2026',
      'September 2026',
      'October 2026',
      'No value',
    ]);
    expect(keys(d)).toEqual(['d:2026-07', 'd:2026-08', 'd:2026-09', 'd:2026-10', EMPTY_GROUP]);
    expect(exacts(d)).toEqual(['2', '0', '0', '1', '1']);
    expect(d.series[0]?.values[1]?.rowIds).toEqual([]);
    const hidden = data(rows, { kind: 'line', xPropertyId: 'due', hideEmpty: true });
    expect(exacts(hidden)).toEqual(['2', '0', '0', '1']);
  });

  it.each([
    ['day', 0, ['Oct 24, 2026', 'Oct 25, 2026', 'Oct 26, 2026'], ['1', '0', '1']],
    ['week', 0, ['Week of Oct 18, 2026', 'Week of Oct 25, 2026'], ['1', '1']],
    ['week', 1, ['Week of Oct 19, 2026', 'Week of Oct 26, 2026'], ['1', '1']],
    ['month', 0, ['October 2026'], ['2']],
    ['quarter', 0, ['Q4 2026'], ['2']],
    ['year', 0, ['2026'], ['2']],
  ] as const)('buckets by %s (weeks start on day %s)', (bucket, weekStart, want, counts) => {
    // Oct 24, 2026 is a Saturday and Oct 26 a Monday.
    const rows = [dated('r1', '2026-10-24'), dated('r2', '2026-10-26')];
    const d = data(rows, { xPropertyId: 'due', xDateBucket: bucket }, context({ weekStart }));
    expect(labels(d)).toEqual(want);
    expect(exacts(d)).toEqual(counts);
  });

  it('labels quarters and years and fills the years between', () => {
    const rows = [dated('r1', '2024-02-29'), dated('r2', '2026-12-31')];
    const years = data(rows, { xPropertyId: 'due', xDateBucket: 'year' });
    expect(labels(years)).toEqual(['2024', '2025', '2026']);
    expect(keys(years)).toEqual(['d:2024', 'd:2025', 'd:2026']);
    expect(exacts(years)).toEqual(['1', '0', '1']);
    const quarters = data(rows, { xPropertyId: 'due', xDateBucket: 'quarter' });
    expect(quarters.categories).toHaveLength(12);
    expect(keys(quarters)[0]).toBe('d:2024-Q1');
    expect(labels(quarters).slice(-2)).toEqual(['Q3 2026', 'Q4 2026']);
  });

  it("puts dates with a time on the viewer's day", () => {
    // 03:30 UTC on Nov 1 is still Oct 31 in Denver, but Nov 1 in London.
    const rows = [row('r1', {}, { createdAt: '2026-11-01T03:30:00Z' })];
    const denver = data(rows, { xPropertyId: 'created' });
    expect(labels(denver)).toEqual(['October 2026']);
    const london = data(rows, { xPropertyId: 'created' }, context({ timeZone: 'Europe/London' }));
    expect(labels(london)).toEqual(['November 2026']);
    const fallback = data(rows, { xPropertyId: 'created' }, context({ timeZone: 'Not/AZone' }));
    expect(labels(fallback)).toEqual(['October 2026']);
  });

  it('buckets date results of formulas and leaves out bad dates', () => {
    const rows = [
      row('r1', {
        dueF: { kind: 'date', value: { start: '2026-09-30', end: null, hasTime: false } },
      }),
      row('r2', { dueF: { kind: 'date', value: { start: 'soon', end: null, hasTime: false } } }),
      row('r3', { due: { start: '2026-13-45', end: null, hasTime: false } }),
    ];
    expect(labels(data(rows, { xPropertyId: 'dueF' }))).toEqual(['September 2026', 'No value']);
    expect(labels(data(rows, { xPropertyId: 'due' }))).toEqual(['No value']);
  });

  it('keeps the latest 50 buckets and puts earlier dates in "Other" first', () => {
    const rows = [
      dated('r1', '2026-01-01'),
      dated('r2', '2026-02-15'),
      dated('r3', '2026-03-31'),
      dated('r4', '2026-01-20'),
      row('r5'),
    ];
    const d = data(rows, { xPropertyId: 'due', xDateBucket: 'day' });
    expect(d.categories).toHaveLength(52);
    expect(d.categories[0]).toMatchObject({ key: OTHER_KEY, label: 'Other', color: OTHER_COLOR });
    expect(labels(d)[1]).toBe('Feb 10, 2026');
    expect(labels(d)[50]).toBe('Mar 31, 2026');
    expect(labels(d)[51]).toBe('No value');
    expect(d.series[0]?.values[0]).toMatchObject({ exact: '2', rowIds: ['r1', 'r4'] });
    expect(d.total.exact).toBe('5');

    // Sorted by value, "Other" goes after the dates.
    const byValue = data(rows, { xPropertyId: 'due', xDateBucket: 'day', order: 'value_desc' });
    expect(labels(byValue).slice(0, 3)).toEqual(['Feb 15, 2026', 'Mar 31, 2026', 'Feb 10, 2026']);
    expect(labels(byValue).slice(-2)).toEqual(['Other', 'No value']);
  });

  it('adds up month by month when cumulative, keeping each point to its own rows', () => {
    const rows = [
      dated('r1', '2026-07-03', { hours: '2' }),
      dated('r2', '2026-07-20', { hours: '1.25' }),
      dated('r3', '2026-10-05', { hours: '4' }),
    ];
    const d = data(rows, { kind: 'line', xPropertyId: 'due', cumulative: true });
    expect(exacts(d)).toEqual(['2', '2', '2', '3']);
    expect(totals(d)).toEqual(['2', '2', '2', '3']);
    expect(d.series[0]?.values[3]?.rowIds).toEqual(['r3']);
    expect(d.total.exact).toBe('3');
    const sums = data(rows, {
      kind: 'line',
      xPropertyId: 'due',
      cumulative: true,
      ...value('sum'),
    });
    expect(texts(sums)).toEqual(['3.25', '3.25', '3.25', '7.25']);
    const averages = data(rows, {
      kind: 'line',
      xPropertyId: 'due',
      cumulative: true,
      ...value('average'),
    });
    // The running average of everything so far, not an average of averages.
    expect(exacts(averages)).toEqual(['1.625', '1.625', '1.625', '2.4166666667']);
  });
});

// ------------------------------------------------------------------ limits and splits

describe('chartData limits', () => {
  it('keeps the 50 biggest categories and puts the rest in "Other" (spec: 50 + Other)', () => {
    const rows: Row[] = [];
    for (let i = 1; i <= 55; i += 1) rows.push(row(`r${i}`, { notes: fromPlainText(`Item ${i}`) }));
    rows.push(row('x1', { notes: fromPlainText('Item 55') }));
    rows.push(row('x2', { notes: fromPlainText('Item 55') }));
    rows.push(row('x3', { notes: fromPlainText('Item 54') }));
    const d = data(rows, { xPropertyId: 'notes' });
    expect(d.categories).toHaveLength(51);
    expect(labels(d).slice(0, 2)).toEqual(['Item 1', 'Item 2']);
    expect(labels(d).slice(-4)).toEqual(['Item 48', 'Item 54', 'Item 55', 'Other']);
    expect(d.series[0]?.values[50]).toMatchObject({
      exact: '5',
      rowIds: ['r49', 'r50', 'r51', 'r52', 'r53'],
    });
    expect(d.total.exact).toBe('58');
  });

  it('lists each row once in "Other", in view order', () => {
    const options = Array.from({ length: 52 }, (_, i) => opt(`m${i + 1}`, `Area ${i + 1}`, 'gray'));
    const areas = prop('areas', 'Areas', { type: 'multi_select', options });
    const c = context({}, { properties: [...properties, areas] });
    const first50 = options.slice(0, 50).map((o) => o.id);
    // Area 52 ties with the first 50 and comes after them; Area 51 has fewer rows.
    const rows = [
      row('rA', { areas: first50 }),
      row('rD', { areas: first50 }),
      row('rC', { areas: ['m52'] }),
      row('rB', { areas: ['m51', 'm52'] }),
    ];
    const d = data(rows, { xPropertyId: 'areas' }, c);
    expect(d.categories).toHaveLength(51);
    expect(d.categories[50]?.key).toBe(OTHER_KEY);
    expect(d.series[0]?.values[50]).toMatchObject({ exact: '3', rowIds: ['rC', 'rB'] });
    expect(d.categories[50]?.total.rowIds).toEqual(['rC', 'rB']);

    // Options without rows past the limit don't make an empty "Other".
    const empty = data([], { xPropertyId: 'areas' }, c);
    expect(empty.categories).toHaveLength(50);
    expect(keys(empty)).not.toContain(OTHER_KEY);
  });

  it('splits into the 10 biggest series, then "Other", then No value', () => {
    const rows: Row[] = [];
    for (let i = 1; i <= 12; i += 1) {
      rows.push(row(`r${i}`, { status: 's-doing', label: { kind: 'text', value: `Crew ${i}` } }));
    }
    rows.push(row('x1', { status: 's-done', label: { kind: 'text', value: 'Crew 12' } }));
    rows.push(row('x2', { status: 's-todo', label: { kind: 'text', value: 'Crew 12' } }));
    rows.push(row('x3', { status: 's-todo', label: { kind: 'text', value: 'Crew 11' } }));
    rows.push(row('x4', { status: 's-done' }));
    const d = data(rows, { splitBy: 'label' });
    expect(d.series.map((s) => s.label)).toEqual([
      'Crew 1',
      'Crew 2',
      'Crew 3',
      'Crew 4',
      'Crew 5',
      'Crew 6',
      'Crew 7',
      'Crew 8',
      'Crew 11',
      'Crew 12',
      'Other',
      'No value',
    ]);
    const other = d.series[10];
    expect(other).toMatchObject({ key: OTHER_KEY, color: OTHER_COLOR });
    expect(exacts(d, 10)).toEqual(['0', '2', '0']);
    expect(other?.values[1]?.rowIds).toEqual(['r9', 'r10']);
    expect(d.series[11]).toMatchObject({ key: EMPTY_GROUP, color: EMPTY_COLOR });
    expect(exacts(d, 11)).toEqual(['0', '0', '1']);
    expect(exacts(d, 9)).toEqual(['1', '1', '1']);
    expect(d.display.stacked).toBe(true);
  });

  it('stacks splits that add up to the category totals (DB-45)', () => {
    const d = data(statusRows(), { splitBy: 'owner' });
    expect(d.series.map((s) => s.label)).toEqual([
      'Avery Lin',
      'Jordan Park (removed)',
      'No value',
    ]);
    expect(labels(d)).toEqual(['Not started', 'In progress', 'Done', 'No value']);
    expect(exacts(d, 0)).toEqual(['1', '1', '0', '1']);
    expect(exacts(d, 1)).toEqual(['0', '2', '0', '0']);
    expect(exacts(d, 2)).toEqual(['0', '0', '1', '0']);
    d.categories.forEach((cat, i) => {
      const sum = d.series.reduce((n, s) => n + (s.values[i]?.value ?? 0), 0);
      expect(cat.total.value).toBe(sum);
    });
    expect(d.categories[1]?.total.rowIds).toEqual(['r2', 'r3']);
    expect(d.total.exact).toBe('6');
    expect(data(statusRows(), { splitBy: 'owner', grouped: true }).display.stacked).toBe(false);
  });

  it('with "Hide empty", leaves out rows without a split value too', () => {
    const d = data(statusRows(), { splitBy: 'owner', hideEmpty: true });
    expect(d.series.map((s) => s.label)).toEqual(['Avery Lin', 'Jordan Park (removed)']);
    expect(labels(d)).toEqual(['Not started', 'In progress', 'Done']);
    expect(totals(d)).toEqual(['1', '3', '0']);
  });

  it('splits by a checkbox with Unchecked first', () => {
    const rows = [row('r1', { status: 's-todo', done: true }), row('r2', { status: 's-todo' })];
    const d = data(rows, { splitBy: 'done' });
    expect(d.series.map((s) => s.key)).toEqual(['b:false', 'b:true']);
  });
});

// ------------------------------------------------------------------ values

describe('chartData values', () => {
  const rows = [
    row('r1', { trade: 'o-plumb', hours: '0.1', cost: '1234.5' }),
    row('r2', { trade: 'o-plumb', hours: '0.2', cost: '10' }),
    row('r3', { trade: 'o-plumb', hours: '2', cost: '5' }),
    row('r4', { trade: 'o-plumb', hours: '-1' }),
    row('r5', { trade: 'o-hvac' }),
    row('r6', { trade: 'o-hvac', hours: '7' }),
  ];

  it.each([
    ['sum', ['1.3', '7', '0'], '8.3', 'Sum of Hours'],
    ['average', ['0.325', '7', null], '1.66', 'Average of Hours'],
    ['median', ['0.15', '7', null], '0.2', 'Median of Hours'],
    ['min', ['-1', '7', null], '-1', 'Min of Hours'],
    ['max', ['2', '7', null], '7', 'Max of Hours'],
  ] as const)('works out the %s exactly', (aggregate, want, total, label) => {
    const d = data(rows, { xPropertyId: 'trade', ...value(aggregate) });
    expect(exacts(d)).toEqual(want);
    expect(d.total.exact).toBe(total);
    expect(d.valueLabel).toBe(label);
    expect(d.series[0]?.label).toBe(label);
  });

  it('adds 0.1 and 0.2 to exactly 0.3', () => {
    const d = data(rows.slice(0, 2), { xPropertyId: 'trade', ...value('sum') });
    expect(d.series[0]?.values[0]).toMatchObject({ exact: '0.3', value: 0.3, text: '0.3' });
  });

  it('leaves the average, median, min and max of nothing empty, and the sum at 0', () => {
    const avg = data(rows, { xPropertyId: 'trade', ...value('average') });
    expect(avg.series[0]?.values[2]).toEqual({ exact: null, value: null, text: '', rowIds: [] });
    const sum = data(rows, { xPropertyId: 'trade', ...value('sum') });
    expect(sum.series[0]?.values[2]).toMatchObject({ exact: '0', text: '0' });
  });

  it('counts rows without a number, but leaves them out of averages', () => {
    const count = data(rows, { xPropertyId: 'trade' });
    expect(exacts(count)).toEqual(['4', '2', '0']);
    const avg = data(rows.slice(4), { xPropertyId: 'trade', ...value('average') });
    expect(exacts(avg)).toEqual([null, '7', null]);
    expect(avg.series[0]?.values[1]?.rowIds).toEqual(['r5', 'r6']);
  });

  it("shows numbers in the property's format, counts with commas", () => {
    const money = data(rows, { xPropertyId: 'trade', ...value('sum', 'cost') });
    expect(texts(money)).toEqual(['$1,249.50', '$0.00', '$0.00']);
    expect(money.total.text).toBe('$1,249.50');
    const odd = data([row('r1', { trade: 'o-hvac', oddCost: '1234.5' })], {
      xPropertyId: 'trade',
      ...value('sum', 'oddCost'),
    });
    expect(texts(odd)?.[1]).toBe('1234.5');
    const many = Array.from({ length: 1200 }, (_, i) => row(`r${i}`, { status: 's-done' }));
    expect(texts(data(many))?.[2]).toBe('1,200');
  });

  it('adds up formula and rollup numbers in their own format', () => {
    const scored = [
      row('r1', { trade: 'o-plumb', score: { kind: 'number', value: 0.5 } }),
      row('r2', { trade: 'o-plumb', score: { kind: 'number', value: 0.25 } }),
      row('r3', { trade: 'o-plumb', score: { kind: 'text', value: 'n/a' } }),
      row('r4', { trade: 'o-hvac', totalHours: { kind: 'number', value: 1234.5 } }),
    ];
    const d = data(scored, { xPropertyId: 'trade', ...value('sum', 'score') });
    expect(texts(d)).toEqual(['75%', '0%', '0%']);
    expect(exacts(d)).toEqual(['0.75', '0', '0']);
    const rollup = data(scored, { xPropertyId: 'trade', ...value('max', 'totalHours') });
    expect(texts(rollup)).toEqual(['', '1234.5', '']);
  });
});

// ------------------------------------------------------------------ order

describe('chartData order', () => {
  const rows = [
    row('r1', { trade: 'o-plumb' }),
    row('r2', { trade: 'o-hvac' }),
    row('r3', { trade: 'o-hvac' }),
    row('r4', { trade: 'o-hvac' }),
    row('r5', { trade: 'o-elec' }),
    row('r6', { trade: 'o-elec' }),
    row('r7'),
    row('r8'),
    row('r9'),
    row('r10'),
  ];

  it.each([
    ['option', ['Plumbing', 'HVAC', 'Electrical', 'No value']],
    ['date', ['Plumbing', 'HVAC', 'Electrical', 'No value']],
    ['alphabetical', ['Electrical', 'HVAC', 'Plumbing', 'No value']],
    ['value_asc', ['Plumbing', 'Electrical', 'HVAC', 'No value']],
    ['value_desc', ['HVAC', 'Electrical', 'Plumbing', 'No value']],
  ] as const)('orders by %s with No value last', (order, want) => {
    expect(labels(data(rows, { xPropertyId: 'trade', order }))).toEqual(want);
  });

  it('puts ties in natural order and categories with nothing to show last', () => {
    const tied = [
      row('r1', { trade: 'o-elec', hours: '2' }),
      row('r2', { trade: 'o-plumb', hours: '2' }),
      row('r3', { trade: 'o-hvac' }),
    ];
    const asc = data(tied, { xPropertyId: 'trade', order: 'value_asc', ...value('average') });
    expect(labels(asc)).toEqual(['Plumbing', 'Electrical', 'HVAC']);
    const desc = data(tied, { xPropertyId: 'trade', order: 'value_desc', ...value('average') });
    expect(labels(desc)).toEqual(['Plumbing', 'Electrical', 'HVAC']);
  });

  it('keeps dates in date order when sorted A to Z', () => {
    const dated = [
      row('r1', { due: { start: '2026-12-02', end: null, hasTime: false } }),
      row('r2', { due: { start: '2026-02-02', end: null, hasTime: false } }),
    ];
    const d = data(dated, { xPropertyId: 'due', xDateBucket: 'quarter', order: 'alphabetical' });
    expect(labels(d)).toEqual(['Q1 2026', 'Q2 2026', 'Q3 2026', 'Q4 2026']);
  });
});

// ------------------------------------------------------------------ pie and donut

describe('chartData pie and donut', () => {
  it('draws one slice per category, ignores the split, and slices add up (DB-45)', () => {
    const d = data(statusRows(), { kind: 'pie', splitBy: 'owner' });
    expect(d.series).toHaveLength(1);
    expect(d.series[0]?.key).toBe(VALUE_SERIES_KEY);
    expect(exacts(d)).toEqual(['1', '2', '1', '1']);
    const sum = d.series[0]?.values.reduce((n, p) => n + (p.value ?? 0), 0);
    expect(sum).toBe(d.total.value);
    expect(d.display).toMatchObject({ kind: 'pie', colorBy: 'category', centerValue: false });
  });

  it('shows the total in the middle of a donut unless turned off', () => {
    const d = data(statusRows(), { kind: 'donut', ...value('sum') });
    expect(d.display.centerValue).toBe(true);
    expect(d.total).toEqual({ exact: '10.5', value: 10.5, text: '10.5' });
    expect(data([], { kind: 'donut', centerValue: false }).display.centerValue).toBe(false);
  });

  it("doesn't need a split property that's gone", () => {
    expect(data(statusRows(), { kind: 'donut', splitBy: 'deleted' }).problem).toBeNull();
  });
});

// ------------------------------------------------------------------ colors

describe('chartData colors', () => {
  it('uses option colors with the default palette, gray for No value', () => {
    const d = data(statusRows());
    expect(d.categories.map((c) => c.color)).toEqual([
      OPTION_CHART_COLORS.default,
      OPTION_CHART_COLORS.blue,
      OPTION_CHART_COLORS.green,
      EMPTY_COLOR,
    ]);
    expect(d.display.colorBy).toBe('category');
    expect(d.series[0]?.color).toEqual(paletteColor('default', 0));
  });

  it('colors by position with another palette, the same whatever the sort order', () => {
    const rows = [row('r1', { trade: 'o-elec' }), row('r2', { trade: 'o-elec' })];
    const d = data(rows, { xPropertyId: 'trade', palette: 'colorblind', order: 'value_desc' });
    expect(labels(d)).toEqual(['Electrical', 'Plumbing', 'HVAC']);
    expect(d.categories.map((c) => c.color)).toEqual([
      paletteColor('colorblind', 2),
      paletteColor('colorblind', 0),
      paletteColor('colorblind', 1),
    ]);
  });

  it('colors people and dates from the palette, one color per series', () => {
    const d = data(statusRows(), { xPropertyId: 'owner' });
    expect(d.categories[0]?.color).toEqual(paletteColor('default', 0));
    expect(d.categories[1]?.color).toEqual(paletteColor('default', 1));
    expect(d.display.colorBy).toBe('series');
    const split = data(statusRows(), { xPropertyId: 'owner', splitBy: 'status', palette: 'mono' });
    expect(split.series.map((s) => s.color)).toEqual([
      paletteColor('mono', 0),
      paletteColor('mono', 1),
      paletteColor('mono', 2),
      EMPTY_COLOR,
    ]);
    expect(split.display.colorBy).toBe('series');
  });

  it('gives split series their option colors', () => {
    const d = data(statusRows(), { xPropertyId: 'owner', splitBy: 'status' });
    expect(d.series.map((s) => s.color)).toEqual([
      OPTION_CHART_COLORS.default,
      OPTION_CHART_COLORS.blue,
      OPTION_CHART_COLORS.green,
      EMPTY_COLOR,
    ]);
    expect(d.series.map((s) => s.key)).toEqual(['o:s-todo', 'o:s-doing', 'o:s-done', EMPTY_GROUP]);
  });

  it('colors one line by series even for option categories', () => {
    expect(data(statusRows(), { kind: 'line' }).display.colorBy).toBe('series');
  });
});

// ------------------------------------------------------------------ display

describe('chartData display', () => {
  const display = (over: Partial<ChartOptions>) => data([], over).display;

  it('passes on the plain settings', () => {
    expect(
      display({ showValues: true, showLegend: false, height: 'xl', dataLabels: true }),
    ).toEqual({
      kind: 'bar',
      height: 'xl',
      showLegend: false,
      showValues: true,
      dataLabels: true,
      stacked: false,
      smooth: false,
      cumulative: false,
      axisRange: null,
      referenceLine: null,
      palette: 'default',
      centerValue: false,
      colorBy: 'category',
    });
  });

  it('checks values from older or broken settings', () => {
    const odd = display({
      kind: 'radar' as never,
      height: 'huge' as never,
      palette: 'neon' as never,
    });
    expect(odd).toMatchObject({ kind: 'bar', height: 'm', palette: 'default' });
  });

  it('keeps each extra to the kinds it applies to', () => {
    expect(display({ kind: 'line', smooth: true }).smooth).toBe(true);
    expect(display({ kind: 'bar', smooth: true }).smooth).toBe(false);
    expect(display({ kind: 'line', cumulative: true }).cumulative).toBe(true);
    expect(display({ kind: 'pie', cumulative: true }).cumulative).toBe(false);
    expect(display({ kind: 'bar', stacked: true }).stacked).toBe(false);
    expect(display({ kind: 'line', splitBy: 'owner', stacked: true }).stacked).toBe(false);
    expect(display({ kind: 'horizontal_bar', splitBy: 'owner' }).stacked).toBe(true);
    expect(display({ kind: 'bar', splitBy: 'owner', stacked: false }).stacked).toBe(false);
  });

  it('checks the axis range and the reference line', () => {
    expect(display({ axisRange: { min: 0, max: null } }).axisRange).toEqual({ min: 0, max: null });
    expect(display({ axisRange: { min: 5, max: 10 } }).axisRange).toEqual({ min: 5, max: 10 });
    expect(display({ axisRange: { min: 10, max: 10 } }).axisRange).toBeNull();
    expect(display({ axisRange: { min: null, max: null } }).axisRange).toBeNull();
    expect(display({ axisRange: { min: Number.NaN, max: 4 } }).axisRange).toEqual({
      min: null,
      max: 4,
    });
    expect(display({ kind: 'pie', axisRange: { min: 0, max: 4 } }).axisRange).toBeNull();
    expect(display({ referenceLine: { value: 40, label: '  Target ' } }).referenceLine).toEqual({
      value: 40,
      label: 'Target',
    });
    expect(
      display({ referenceLine: { value: Number.POSITIVE_INFINITY, label: 'x' } }).referenceLine,
    ).toBeNull();
    expect(
      display({ kind: 'donut', referenceLine: { value: 4, label: '' } }).referenceLine,
    ).toBeNull();
    expect(display({ referenceLine: null }).referenceLine).toBeNull();
  });
});

// ------------------------------------------------------------------ table

describe('chartData "View as table"', () => {
  it('has the same numbers as the chart, cumulative ones included (DB-13, DB-45)', () => {
    const d = data(statusRows(), { splitBy: 'owner', cumulative: true, ...value('sum') });
    expect(d.table).toHaveLength(d.categories.length * d.series.length);
    d.categories.forEach((cat, i) => {
      d.series.forEach((s, j) => {
        const line = d.table[i * d.series.length + j];
        expect(line).toEqual({
          categoryKey: cat.key,
          category: cat.label,
          seriesKey: s.key,
          series: s.label,
          exact: s.values[i]?.exact ?? null,
          text: s.values[i]?.text ?? '',
        });
      });
    });
    // Avery Lin: 2 (Not started), +3 (In progress), +0, +0 (No value) when cumulative.
    expect(exacts(d, 0)).toEqual(['2', '5', '5', '5']);
  });

  it('labels the only series with the value', () => {
    const d = data(statusRows(), value('average'));
    expect(d.table[0]).toMatchObject({
      category: 'Not started',
      series: 'Average of Hours',
      seriesKey: VALUE_SERIES_KEY,
      exact: '2',
      text: '2',
    });
    expect(d.table[3]).toMatchObject({ category: 'No value', exact: null, text: '' });
  });
});

// ------------------------------------------------------------------ problems

describe('chartData problems', () => {
  it.each([
    ['no category property', { xPropertyId: null }, 'choose_category'],
    ['a deleted category property', { xPropertyId: 'deleted' }, 'property_unavailable'],
    ['files as categories', { xPropertyId: 'files' }, 'invalid_settings'],
    ['numbers as categories', { xPropertyId: 'hours' }, 'invalid_settings'],
    ['a deleted split property', { splitBy: 'deleted' }, 'property_unavailable'],
    ['a relation split', { splitBy: 'link' }, 'invalid_settings'],
    ['a sum of nothing chosen', value('sum', null), 'invalid_settings'],
    ['a sum of a deleted property', value('sum', 'deleted'), 'property_unavailable'],
    ['a sum of text', value('sum', 'notes'), 'invalid_settings'],
    ['an unknown calculation', value('range' as never), 'invalid_settings'],
  ] as const)('reports %s', (_, over: Partial<ChartOptions>, problem) => {
    const d = data(statusRows(), over);
    expect(d.problem).toBe(problem);
    expect(d.categories).toEqual([]);
    expect(d.series).toEqual([]);
    expect(d.table).toEqual([]);
    expect(d.total).toEqual({ exact: null, value: null, text: '' });
    expect(d.display.height).toBe('m');
  });

  it('asks for a category when the view has no chart settings yet', () => {
    const d = chartData(statusRows(), {}, ctx);
    expect(d.problem).toBe('choose_category');
    expect(d.valueLabel).toBe('Count');
    expect(d.display.kind).toBe('bar');
  });
});

// ------------------------------------------------------------------ settings helpers

describe('chart settings', () => {
  it.each([
    [title, true],
    [notes, true],
    [status, true],
    [trade, true],
    [tags, true],
    [owner, true],
    [done, true],
    [due, true],
    [site, true],
    [created, true],
    [createdBy, true],
    [label, true],
    [urgentF, true],
    [dueF, true],
    [leadF, true],
    [listF, true],
    [jobNames, true],
    [hours, false],
    [files, false],
    [link, false],
    [score, false],
    [brokenF, false],
    [totalHours, false],
    [ticket, false],
  ] as const)('canChartBy(%s) is %s', (p, want) => {
    expect(canChartBy(p)).toBe(want);
  });

  it('adds up numbers and number results only', () => {
    expect(canChartValue(hours)).toBe(true);
    expect(canChartValue(cost)).toBe(true);
    expect(canChartValue(score)).toBe(true);
    expect(canChartValue(totalHours)).toBe(true);
    expect(canChartValue(ticket)).toBe(false);
    expect(canChartValue(label)).toBe(false);
    expect(canChartValue(brokenF)).toBe(false);
    expect(canChartValue(status)).toBe(false);
  });

  it('lists the properties a chart reads, once each', () => {
    expect(chartPropertyIds(chart())).toEqual(['status']);
    expect(chartPropertyIds(chart({ splitBy: 'owner', ...value('sum') }))).toEqual([
      'status',
      'owner',
      'hours',
    ]);
    expect(chartPropertyIds(chart({ splitBy: 'status', ...value('count') }))).toEqual(['status']);
    expect(chartPropertyIds(chart({ kind: 'pie', splitBy: 'owner' }))).toEqual(['status']);
    expect(chartPropertyIds(chart({ xPropertyId: null, ...value('max', null) }))).toEqual([]);
  });

  it('names the value', () => {
    expect(chartValueLabel({ aggregate: 'count', propertyId: 'hours' }, properties)).toBe('Count');
    expect(chartValueLabel({ aggregate: 'sum', propertyId: 'cost' }, properties)).toBe(
      'Sum of Cost',
    );
    expect(chartValueLabel({ aggregate: 'median', propertyId: 'hours' }, properties)).toBe(
      'Median of Hours',
    );
    expect(chartValueLabel({ aggregate: 'min', propertyId: 'gone' }, properties)).toBe('Min');
    expect(chartValueLabel({ aggregate: 'max', propertyId: null }, properties)).toBe('Max');
  });

  it.each([
    ['fine settings', {}, null],
    ['no category yet', { xPropertyId: null }, null],
    ['a deleted category', { xPropertyId: 'deleted' }, null],
    ['files as categories', { xPropertyId: 'files' }, CHART_MESSAGES.category],
    ['a relation split', { splitBy: 'link' }, CHART_MESSAGES.split],
    ['a relation split on a pie', { kind: 'pie', splitBy: 'link' }, null],
    ['a sum of nothing', value('sum', null), CHART_MESSAGES.value],
    ['a sum of a deleted property', value('sum', 'deleted'), CHART_MESSAGES.value],
    ['an average of text', value('average', 'notes'), CHART_MESSAGES.value],
    ['an average of a formula number', value('average', 'score'), null],
    ['min above max', { axisRange: { min: 10, max: 2 } }, CHART_MESSAGES.axisRange],
    ['min equal to max', { axisRange: { min: 2, max: 2 } }, CHART_MESSAGES.axisRange],
    ['one end of the range', { axisRange: { min: null, max: 2 } }, null],
    [
      'a range that is not a number',
      { axisRange: { min: Number.NaN, max: 2 } },
      CHART_MESSAGES.number,
    ],
    [
      'a reference line that is not a number',
      { referenceLine: { value: Number.NaN, label: '' } },
      CHART_MESSAGES.number,
    ],
    ['a bad range on a donut', { kind: 'donut', axisRange: { min: 3, max: 1 } }, null],
  ] as const)('validates %s', (_, over: Partial<ChartOptions>, want) => {
    expect(validateChartOptions(chart(over), properties)).toBe(want);
  });
});
