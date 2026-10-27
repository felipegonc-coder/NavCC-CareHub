import { describe, expect, it } from 'vitest';
import {
  NO_ACCESS_GROUP,
  STATUS_GROUP_LABELS,
  canGroupBy,
  groupKeysOf,
  groupMovePatch,
  groupRows,
  valueForGroup,
  type RowGroup,
} from './group';
import { fromPlainText } from './richtext';
import {
  EMPTY_GROUP,
  type ComputedValue,
  type DateValue,
  type EvalContext,
  type Grouping,
  type Property,
  type PropertyConfig,
  type Row,
  type SelectOption,
  type Viewer,
} from './types';

const prop = <C extends PropertyConfig>(id: string, config: C): Property<C> => ({
  id,
  name: id,
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
const formula = (id: string, resultKind: 'number' | 'text' | 'list' | null) =>
  prop(id, {
    type: 'formula',
    expression: '',
    resultKind,
    number: resultKind === 'number' ? { ...NUMBER, format: 'percent' } : null,
  });

// Option order differs from both A to Z and Z to A.
const trade = prop('trade', {
  type: 'select',
  options: [
    opt('o-hvac', 'HVAC', 'green'),
    opt('o-plumbing', 'Plumbing', 'blue'),
    opt('o-electrical', 'Electrical', 'red'),
  ],
});
const tags = prop('tags', {
  type: 'multi_select',
  options: [
    opt('t-urgent', 'Urgent', 'red'),
    opt('t-callback', 'Callback', 'yellow'),
    opt('t-warranty', 'Warranty', 'purple'),
  ],
});
const stage = prop('stage', {
  type: 'status',
  defaultOptionId: 's-triage',
  options: [
    { ...opt('s-new', 'Not started', 'default'), group: 'todo' },
    { ...opt('s-triage', 'Triage', 'gray'), group: 'todo' },
    { ...opt('s-doing', 'In progress', 'blue'), group: 'in_progress' },
    { ...opt('s-wait', 'Waiting on parts', 'orange'), group: 'in_progress' },
    { ...opt('s-done', 'Done', 'green'), group: 'complete' },
  ],
});
const properties: Property[] = [
  prop('name', { type: 'title' }),
  trade,
  tags,
  stage,
  prop('due', { type: 'date', format: 'full', timeFormat: 'viewer' }),
  prop('done', { type: 'checkbox' }),
  prop('notes', { type: 'text' }),
  prop('site', { type: 'url' }),
  prop('amount', { type: 'number', ...NUMBER, format: 'number_commas' }),
  prop('price', { type: 'number', ...NUMBER, format: 'currency', decimals: 2 }),
  prop('owner', { type: 'person', single: false, notify: true }),
  prop('lead', { type: 'person', single: true, notify: true }),
  prop('jobs', {
    type: 'relation',
    targetDatabaseId: 'db-jobs',
    single: false,
    twoWayPropertyId: null,
  }),
  prop('job', {
    type: 'relation',
    targetDatabaseId: 'db-jobs',
    single: true,
    twoWayPropertyId: null,
  }),
  prop('created', { type: 'created_time', format: 'full', timeFormat: 'viewer' }),
  prop('creator', { type: 'created_by' }),
  prop('editor', { type: 'edited_by' }),
  formula('score', 'number'),
  formula('items', 'list'),
  formula('broken', null),
  prop('hours', {
    type: 'rollup',
    relationPropertyId: 'jobs',
    targetPropertyId: 'job-hours',
    aggregate: 'sum',
    number: null,
  }),
  prop('files', { type: 'files' }),
  prop('steps', { type: 'checklist' }),
  prop('ticket', { type: 'unique_id', prefix: 'QA' }),
  prop('button', { type: 'button', label: 'Call back', actions: [] }),
];
const byId = (id: string): Property => {
  const p = properties.find((x) => x.id === id);
  if (!p) throw new Error(`No property ${id}`);
  return p;
};

const USERS: Record<string, string> = {
  'u-avery': 'Avery Lin',
  'u-jordan': 'Jordan Park',
  'u-sam': 'Sam Ortiz',
};
/** r-secret and r-hidden are rows the viewer can't open. */
const TITLES: Record<string, string> = {
  'r-pine': 'Blue Pine Plumbing',
  'r-intake': 'Intake call',
  'r-blank': '',
};
// Monday Oct 26, 2026, noon in Denver.
const VIEWER: Viewer = {
  userId: 'u-avery',
  timeZone: 'America/Denver',
  weekStart: 0,
  hour12: true,
  now: new Date('2026-10-26T18:00:00Z'),
};
function context(viewer: Partial<Viewer> = {}, titles = true): EvalContext {
  const ctx: EvalContext = {
    properties,
    viewer: { ...VIEWER, ...viewer },
    userName: (id) => USERS[id],
    computed: (row, id) => (row.values[id] as ComputedValue | undefined) ?? { kind: 'empty' },
    isRemovedUser: (id) => id === 'u-sam',
  };
  if (titles) ctx.rowTitle = (id) => TITLES[id];
  return ctx;
}
const ctx = context();

const row = (id: string, values: Row['values'] = {}, extra: Partial<Row> = {}): Row => ({
  id,
  title: 'Call back Blue Pine Plumbing',
  values,
  createdAt: '2026-10-20T15:00:00.000Z',
  createdBy: 'u-avery',
  editedAt: '2026-10-21T15:00:00.000Z',
  editedBy: 'u-jordan',
  uniqueNumber: null,
  ...extra,
});
const date = (start: string, end: string | null = null): DateValue => ({
  start,
  end,
  hasTime: start.includes('T'),
});
const by = (propertyId: string, more: Partial<Grouping> = {}): Grouping => ({
  propertyId,
  ...more,
});
const keys = (gs: RowGroup[]): string[] => gs.map((g) => g.key);
const labels = (gs: RowGroup[]): string[] => gs.map((g) => g.label);
const ids = (g: RowGroup | undefined): string[] | undefined => g?.rows.map((r) => r.id);
const table = (gs: RowGroup[]) => gs.map((g) => [g.key, g.label, ids(g)]);

describe('canGroupBy', () => {
  it('groups by every type the spec lists', () => {
    const ok =
      'trade tags stage due done notes site amount owner jobs created creator editor score hours';
    for (const id of ok.split(' ')) expect(canGroupBy(byId(id))).toBe(true);
  });
  it('refuses Name, Files, Checklist, ID, Button and formulas with an error', () => {
    for (const id of 'name files steps ticket button broken'.split(' '))
      expect(canGroupBy(byId(id))).toBe(false);
  });
});

describe('groupRows: select', () => {
  const rows = [
    row('a', { trade: 'o-plumbing' }),
    row('b', { trade: 'o-electrical' }),
    row('c'),
    row('d', { trade: 'o-hvac' }),
    row('e', { trade: 'o-plumbing' }),
    row('f', { trade: 'o-deleted' }),
  ];
  it('uses option order when unset, "No value" first, rows in the order given', () => {
    const gs = groupRows(rows, by('trade'), ctx);
    expect(table(gs)).toEqual([
      [EMPTY_GROUP, 'No value', ['c', 'f']],
      ['o-hvac', 'HVAC', ['d']],
      ['o-plumbing', 'Plumbing', ['a', 'e']],
      ['o-electrical', 'Electrical', ['b']],
    ]);
    expect(gs[1]).toMatchObject({
      color: 'green',
      hidden: false,
      collapsedKey: 'trade:value:o-hvac',
    });
    expect(gs[0]?.color).toBeUndefined();
  });
  it('sorts groups by option order, A to Z or Z to A', () => {
    const order = (sort: NonNullable<Grouping['sort']>) =>
      labels(groupRows(rows, by('trade', { sort }), ctx));
    expect(order('option')).toEqual(['No value', 'HVAC', 'Plumbing', 'Electrical']);
    expect(order('asc')).toEqual(['No value', 'Electrical', 'HVAC', 'Plumbing']);
    expect(order('desc')).toEqual(['No value', 'Plumbing', 'HVAC', 'Electrical']);
  });
  it('keeps a manual order, with new groups at the end in option order', () => {
    const manual = (order: string[]) =>
      labels(groupRows(rows, by('trade', { sort: 'manual', order }), ctx));
    expect(manual(['o-electrical', 'o-deleted', 'o-electrical'])).toEqual([
      'No value',
      'Electrical',
      'HVAC',
      'Plumbing',
    ]);
    expect(manual(['o-plumbing', EMPTY_GROUP])).toEqual([
      'Plumbing',
      'No value',
      'HVAC',
      'Electrical',
    ]);
  });
  it('uses a saved order only when the sort is manual', () => {
    const g = by('trade', { sort: 'asc', order: ['o-plumbing'] });
    expect(labels(groupRows(rows, g, ctx))).toEqual(['No value', 'Electrical', 'HVAC', 'Plumbing']);
  });
  it('lists every option for boards, and can hide empty groups', () => {
    const one = [row('a', { trade: 'o-plumbing' })];
    const all = { includeEmptyGroups: true };
    expect(labels(groupRows(one, by('trade'), ctx, all))).toEqual([
      'No value',
      'HVAC',
      'Plumbing',
      'Electrical',
    ]);
    expect(labels(groupRows(one, by('trade', { hideEmpty: true }), ctx, all))).toEqual([
      'Plumbing',
    ]);
  });
  it('marks the groups hidden in the view', () => {
    const gs = groupRows(rows, by('trade', { hidden: [EMPTY_GROUP, 'o-hvac'] }), ctx);
    expect(gs.map((g) => g.hidden)).toEqual([true, true, false, false]);
  });
  it('puts every row in "No value" when the property was deleted', () => {
    const gs = groupRows([row('a'), row('b')], by('gone'), ctx, { includeEmptyGroups: true });
    expect(gs.map((g) => [g.key, g.label, ids(g), g.collapsedKey])).toEqual([
      [EMPTY_GROUP, 'No value', ['a', 'b'], 'gone:value:__empty__'],
    ]);
  });
});

describe('groupRows: multi-select, status and checkbox', () => {
  it('puts a multi-select row in each of its groups (DB-07)', () => {
    const a = row('a', { tags: ['t-callback', 't-urgent', 't-callback'] });
    expect(groupKeysOf(a, by('tags'), ctx)).toEqual(['t-callback', 't-urgent']);
    const gs = groupRows([a, row('b', { tags: ['t-urgent'] })], by('tags'), ctx);
    expect(table(gs)).toEqual([
      ['t-urgent', 'Urgent', ['a', 'b']],
      ['t-callback', 'Callback', ['a']],
    ]);
  });
  const rows = [
    row('a', { stage: 's-wait' }),
    row('b', { stage: 's-done' }),
    row('c', { stage: 's-doing' }),
    row('d', { stage: 's-new' }),
  ];
  it('groups status by option, in option order', () => {
    const gs = groupRows(rows, by('stage'), ctx);
    expect(labels(gs)).toEqual(['Not started', 'In progress', 'Waiting on parts', 'Done']);
    expect(gs[0]?.collapsedKey).toBe('stage:option:s-new');
  });
  it('groups status by To-do, In progress and Complete', () => {
    const gs = groupRows(rows, by('stage', { statusBy: 'group' }), ctx, {
      includeEmptyGroups: true,
    });
    expect(gs.map((g) => [g.key, g.label, g.color, ids(g)])).toEqual([
      [EMPTY_GROUP, 'No value', undefined, []],
      ['todo', 'To-do', 'gray', ['d']],
      ['in_progress', 'In progress', 'blue', ['a', 'c']],
      ['complete', 'Complete', 'green', ['b']],
    ]);
    expect(gs[2]?.collapsedKey).toBe('stage:group:in_progress');
    expect(STATUS_GROUP_LABELS.todo).toBe('To-do');
    const az = by('stage', { statusBy: 'group', sort: 'asc' });
    expect(labels(groupRows(rows, az, ctx))).toEqual(['Complete', 'In progress', 'To-do']);
  });
  it('groups checkboxes Unchecked first, with no "No value"', () => {
    const boxes = [row('a', { done: true }), row('b'), row('c', { done: false })];
    expect(table(groupRows(boxes, by('done'), ctx, { includeEmptyGroups: true }))).toEqual([
      ['false', 'Unchecked', ['b', 'c']],
      ['true', 'Checked', ['a']],
    ]);
    expect(labels(groupRows(boxes, by('done', { sort: 'desc' }), ctx))).toEqual([
      'Checked',
      'Unchecked',
    ]);
  });
});

describe('groupRows: text', () => {
  const note = (id: string, text: string) => row(id, { notes: fromPlainText(text) });
  it('groups by exact value, A to Z in natural order ignoring case', () => {
    const rows = [
      note('a', 'Job 10'),
      note('b', 'job 2'),
      note('c', 'Job 1'),
      note('d', 'job 2'),
      row('e'),
    ];
    expect(table(groupRows(rows, by('notes'), ctx))).toEqual([
      [EMPTY_GROUP, 'No value', ['e']],
      ['Job 1', 'Job 1', ['c']],
      ['job 2', 'job 2', ['b', 'd']],
      ['Job 10', 'Job 10', ['a']],
    ]);
    const za = labels(groupRows(rows, by('notes', { sort: 'desc' }), ctx));
    expect(za).toEqual(['No value', 'Job 10', 'job 2', 'Job 1']);
  });
  it('groups by first letter, without accents, with "#" for anything else', () => {
    const rows = [
      note('a', 'ángel'),
      note('b', '  avery'),
      note('c', '42 Elm St'),
      note('d', 'blue pine'),
    ];
    const gs = groupRows(rows, by('notes', { textBy: 'alphabetical' }), ctx);
    expect(table(gs)).toEqual([
      ['#', '#', ['c']],
      ['A', 'A', ['a', 'b']],
      ['B', 'B', ['d']],
    ]);
    expect(gs[1]?.collapsedKey).toBe('notes:alphabetical:A');
  });
  it('groups links, emails and phones by value', () => {
    const rows = [row('a', { site: 'https://bluepine.example' }), row('b')];
    expect(keys(groupRows(rows, by('site'), ctx))).toEqual([
      EMPTY_GROUP,
      'https://bluepine.example',
    ]);
  });
});

describe('groupRows: numbers', () => {
  const amounts = (...values: string[]) => values.map((v, i) => row(`r${i}`, { amount: v }));
  const range = (start: number, end: number, step: number): Grouping =>
    by('amount', { numberRange: { start, end, step } });
  it('groups exact values in number order, shown in the property format', () => {
    const gs = groupRows(amounts('1234.5', '-3', '20', '1234.5'), by('amount'), ctx);
    expect(table(gs)).toEqual([
      ['-3', '-3', ['r1']],
      ['20', '20', ['r2']],
      ['1234.5', '1,234.5', ['r0', 'r3']],
    ]);
    expect(labels(groupRows([row('p', { price: '12' })], by('price'), ctx))).toEqual(['$12.00']);
  });
  it('compares exact decimals exactly', () => {
    const gs = groupRows(
      amounts('999999999999999.0000000002', '999999999999999.0000000001'),
      by('amount'),
      ctx,
    );
    expect(keys(gs)).toEqual(['999999999999999.0000000001', '999999999999999.0000000002']);
  });
  it('groups ranges of `step` from `start` to `end`, the last one including the end', () => {
    const gs = groupRows(
      amounts('5', '10', '100', '-0.5', '100.01', '99.99'),
      range(0, 100, 10),
      ctx,
    );
    expect(table(gs)).toEqual([
      ['below', '< 0', ['r3']],
      ['0', '0–10', ['r0']],
      ['10', '10–20', ['r1']],
      ['90', '90–100', ['r2', 'r5']],
      ['above', '> 100', ['r4']],
    ]);
    expect(gs[1]?.collapsedKey).toBe('amount:range:0');
    expect(
      keys(groupRows(amounts('5', '-1'), { ...range(0, 100, 10), sort: 'desc' }, ctx)),
    ).toEqual(['0', 'below']);
  });
  it('lists empty ranges for boards, up to 100 of them', () => {
    const all = { includeEmptyGroups: true };
    expect(labels(groupRows(amounts('12'), range(0, 25, 10), ctx, all))).toEqual([
      'No value',
      '0–10',
      '10–20',
      '20–25',
    ]);
    expect(labels(groupRows(amounts('12'), range(0, 1000, 1), ctx, all))).toEqual([
      'No value',
      '12–13',
    ]);
  });
  it('works with decimal steps, and falls back to exact values for an unusable range', () => {
    expect(table(groupRows(amounts('0.3'), range(0, 1, 0.25), ctx))).toEqual([
      ['0.25', '0.25–0.5', ['r0']],
    ]);
    expect(keys(groupRows(amounts('5'), range(0, 10, 0), ctx))).toEqual(['5']);
    expect(keys(groupRows(amounts('5'), range(10, 0, 1), ctx))).toEqual(['5']);
  });
});

describe('groupRows: relative dates', () => {
  const days: [string, string][] = [
    ['2026-12-01', 'Later'],
    ['2026-11-25', 'Later'],
    ['2026-11-24', 'Next 30 days'],
    ['2026-11-02', 'Next 30 days'],
    ['2026-11-01', 'Next 7 days'],
    ['2026-10-28', 'Next 7 days'],
    ['2026-10-27', 'Tomorrow'],
    ['2026-10-26', 'Today'],
    ['2026-10-25', 'Yesterday'],
    ['2026-10-24', 'Past 7 days'],
    ['2026-10-20', 'Past 7 days'],
    ['2026-10-19', 'Past 30 days'],
    ['2026-09-27', 'Past 30 days'],
    ['2026-09-26', 'Older'],
  ];
  it.each(days)('puts %s in %s', (day, label) => {
    expect(labels(groupRows([row('a', { due: date(day) })], by('due'), ctx))).toEqual([label]);
  });
  const rows = [...days.map(([day], i) => row(`r${i}`, { due: date(day) })), row('none')];
  const newest = ['Later', 'Next 30 days', 'Next 7 days', 'Tomorrow', 'Today'].concat([
    'Yesterday',
    'Past 7 days',
    'Past 30 days',
    'Older',
  ]);
  it('lists groups newest first when unset, and oldest first A to Z', () => {
    const gs = groupRows(rows, by('due'), ctx);
    expect(labels(gs)).toEqual(['No value', ...newest]);
    expect(keys(gs)).toEqual([
      EMPTY_GROUP,
      'later',
      'next_30_days',
      'next_7_days',
      'tomorrow',
      'today',
      'yesterday',
      'past_7_days',
      'past_30_days',
      'older',
    ]);
    expect(gs[5]?.collapsedKey).toBe('due:relative:today');
    const g = (sort: NonNullable<Grouping['sort']>) =>
      labels(groupRows(rows, by('due', { dateBucket: 'relative', sort }), ctx));
    expect(g('desc')).toEqual(['No value', ...newest]);
    expect(g('option')).toEqual(['No value', ...newest]);
    expect(g('asc')).toEqual(['No value', ...[...newest].reverse()]);
  });
  it("takes today from the given moment in the viewer's time zone (DB-04)", () => {
    // 11:30 PM on Oct 26 in Denver; 5:30 AM on Oct 27 in London.
    const late = { now: new Date('2026-10-27T05:30:00Z') };
    const due = row('a', { due: date('2026-10-27') });
    expect(groupKeysOf(due, by('due'), context(late))).toEqual(['tomorrow']);
    expect(groupKeysOf(due, by('due'), context({ ...late, timeZone: 'Europe/London' }))).toEqual([
      'today',
    ]);
  });
  it("puts a time on the viewer's own day, and a range on its start", () => {
    const timed = row('a', { due: date('2026-10-27T05:30:00.000Z') });
    expect(groupKeysOf(timed, by('due'), ctx)).toEqual(['today']);
    expect(groupKeysOf(timed, by('due'), context({ timeZone: 'Europe/London' }))).toEqual([
      'tomorrow',
    ]);
    expect(
      groupKeysOf(row('b', { due: date('2026-10-25', '2026-10-28') }), by('due'), ctx),
    ).toEqual(['yesterday']);
  });
  it('gives "No value" instead of failing for an unknown time zone', () => {
    const odd = context({ timeZone: 'Nowhere/Atlantis' });
    expect(groupKeysOf(row('a', { due: date('2026-10-26') }), by('due'), odd)).toEqual([
      EMPTY_GROUP,
    ]);
  });
});

describe('groupRows: dates by day, week, month and year', () => {
  const rows = [
    row('a', { due: date('2026-10-26') }),
    row('b', { due: date('2026-11-03T16:00:00.000Z') }),
    row('c', { due: date('2025-12-31') }),
    row('d', { due: date('2026-10-31') }),
  ];
  const bucket = (dateBucket: NonNullable<Grouping['dateBucket']>, more: Partial<Grouping> = {}) =>
    groupRows(rows, by('due', { dateBucket, ...more }), ctx);
  it('groups by day, oldest first unless Z to A', () => {
    expect(bucket('day').map((g) => [g.key, g.label])).toEqual([
      ['2025-12-31', 'Dec 31, 2025'],
      ['2026-10-26', 'Oct 26, 2026'],
      ['2026-10-31', 'Oct 31, 2026'],
      ['2026-11-03', 'Nov 3, 2026'],
    ]);
    expect(keys(bucket('day', { sort: 'desc' }))[0]).toBe('2026-11-03');
  });
  it("groups by week from the viewer's first day of the week", () => {
    expect(table(bucket('week')).slice(1, 2)).toEqual([
      ['2026-10-25', 'Week of Oct 25, 2026', ['a', 'd']],
    ]);
    const monday = context({ weekStart: 1 });
    expect(
      groupKeysOf(row('a', { due: date('2026-10-25') }), by('due', { dateBucket: 'week' }), monday),
    ).toEqual(['2026-10-19']);
  });
  it('groups by month and by year', () => {
    expect(table(bucket('month'))).toEqual([
      ['2025-12', 'December 2025', ['c']],
      ['2026-10', 'October 2026', ['a', 'd']],
      ['2026-11', 'November 2026', ['b']],
    ]);
    expect(table(bucket('year'))).toEqual([
      ['2025', '2025', ['c']],
      ['2026', '2026', ['a', 'b', 'd']],
    ]);
  });
  it("groups created time by the viewer's day", () => {
    const r = row('a', {}, { createdAt: '2026-10-27T05:30:00.000Z' });
    const g = by('created', { dateBucket: 'day' });
    expect(groupKeysOf(r, g, ctx)).toEqual(['2026-10-26']);
    expect(groupKeysOf(r, g, context({ timeZone: 'Europe/London' }))).toEqual(['2026-10-27']);
  });
});

describe('groupRows: people and relations', () => {
  it('puts a row in each person’s group, A to Z by name, removed people marked', () => {
    const rows = [
      row('a', { owner: ['u-jordan', 'u-avery'] }),
      row('b', { owner: ['u-sam'] }),
      row('c', { owner: ['u-unknown'] }),
      row('d'),
    ];
    expect(table(groupRows(rows, by('owner'), ctx))).toEqual([
      [EMPTY_GROUP, 'No value', ['c', 'd']],
      ['u-avery', 'Avery Lin', ['a']],
      ['u-jordan', 'Jordan Park', ['a']],
      ['u-sam', 'Sam Ortiz (removed)', ['b']],
    ]);
    expect(labels(groupRows(rows, by('owner', { sort: 'desc' }), ctx))).toEqual([
      'No value',
      'Sam Ortiz (removed)',
      'Jordan Park',
      'Avery Lin',
    ]);
  });
  it('groups Created by and Edited by, with anonymous responses under "Anonymous"', () => {
    const anonymous = row('x', {}, { createdBy: null, editedBy: null });
    const all = { includeEmptyGroups: true };
    expect(table(groupRows([row('a'), anonymous], by('creator'), ctx, all))).toEqual([
      [EMPTY_GROUP, 'Anonymous', ['x']],
      ['u-avery', 'Avery Lin', ['a']],
    ]);
    expect(labels(groupRows([row('a')], by('editor'), ctx, all))).toEqual(['Jordan Park']);
  });
  const linked = [
    row('a', { jobs: ['r-pine', 'r-secret'] }),
    row('b', { jobs: ['r-secret', 'r-hidden'] }),
    row('c', { jobs: ['r-blank'] }),
    row('d', { jobs: ['r-intake'] }),
  ];
  it("makes a group per related row, and one for all rows the viewer can't open", () => {
    const gs = groupRows(linked, by('jobs'), ctx);
    expect(table(gs)).toEqual([
      ['r-pine', 'Blue Pine Plumbing', ['a']],
      ['r-intake', 'Intake call', ['d']],
      ['r-blank', 'Untitled', ['c']],
      [NO_ACCESS_GROUP, "Rows you can't open", ['a', 'b']],
    ]);
    expect(keys(gs).filter((k) => k === 'r-secret' || k === 'r-hidden')).toEqual([]);
    expect(labels(groupRows(linked, by('jobs', { sort: 'desc' }), ctx))).toEqual([
      'Untitled',
      'Intake call',
      'Blue Pine Plumbing',
      "Rows you can't open",
    ]);
  });
  it('treats every link as one the viewer can’t open when titles aren’t given', () => {
    expect(groupKeysOf(row('a', { jobs: ['r-pine'] }), by('jobs'), context({}, false))).toEqual([
      NO_ACCESS_GROUP,
    ]);
  });
});

describe('groupRows: formula and rollup results', () => {
  it('groups a number result in the formula’s format; errors have no value', () => {
    const rows = [
      row('a', { score: { kind: 'number', value: 0.45 } }),
      row('b', { score: { kind: 'error', message: 'Division by zero' } }),
    ];
    expect(table(groupRows(rows, by('score'), ctx))).toEqual([
      [EMPTY_GROUP, 'No value', ['b']],
      ['0.45', '45%', ['a']],
    ]);
  });
  it('groups each item of a list by its kind', () => {
    const value: ComputedValue = {
      kind: 'list',
      value: [
        { kind: 'text', value: 'Leak' },
        { kind: 'boolean', value: true },
        { kind: 'person', value: 'u-avery' },
        { kind: 'page', value: 'r-pine' },
        { kind: 'page', value: 'r-secret' },
        { kind: 'date', value: date('2026-10-26') },
        { kind: 'number', value: 3 },
        { kind: 'empty' },
      ],
    };
    expect(groupKeysOf(row('a', { items: value }), by('items'), ctx)).toEqual([
      'Leak',
      'true',
      'u-avery',
      'r-pine',
      NO_ACCESS_GROUP,
      'today',
      '3',
    ]);
  });
  it('groups a rollup by its result, in ranges too', () => {
    const rows = [
      row('a', { hours: { kind: 'number', value: 12 } }),
      row('b', { hours: { kind: 'number', value: 3 } }),
    ];
    const g = by('hours', { numberRange: { start: 0, end: 20, step: 10 } });
    expect(table(groupRows(rows, g, ctx))).toEqual([
      ['0', '0–10', ['b']],
      ['10', '10–20', ['a']],
    ]);
  });
  it('makes sub-groups by grouping each group again', () => {
    const rows = [
      row('a', { trade: 'o-hvac', done: true }),
      row('b', { trade: 'o-hvac' }),
      row('c', { trade: 'o-plumbing', done: true }),
    ];
    const lanes = groupRows(rows, by('trade'), ctx).map((g) => [
      g.label,
      table(groupRows(g.rows, by('done'), ctx)),
    ]);
    expect(lanes).toEqual([
      [
        'HVAC',
        [
          ['false', 'Unchecked', ['b']],
          ['true', 'Checked', ['a']],
        ],
      ],
      ['Plumbing', [['true', 'Checked', ['c']]]],
    ]);
  });
});

describe('groupMovePatch', () => {
  const move = (r: Row, g: Grouping | string, from: string, to: string) =>
    groupMovePatch(r, typeof g === 'string' ? by(g) : g, from, to, ctx);
  it('sets Select and Status, and clears on "No value"', () => {
    const r = row('a', { trade: 'o-hvac', stage: 's-new' });
    expect(move(r, 'trade', 'o-hvac', 'o-plumbing')).toEqual({
      propertyId: 'trade',
      value: 'o-plumbing',
    });
    expect(move(r, 'trade', 'o-hvac', EMPTY_GROUP)).toEqual({ propertyId: 'trade', value: null });
    expect(move(r, 'trade', 'o-hvac', 'o-deleted')).toBeNull();
    expect(move(r, 'trade', 'o-hvac', 'o-hvac')).toBeNull();
    expect(move(r, 'stage', 's-new', 's-done')).toEqual({ propertyId: 'stage', value: 's-done' });
  });
  it('moves between status groups to the default option if it is in the group, else the first', () => {
    const g = by('stage', { statusBy: 'group' });
    const r = row('a', { stage: 's-done' });
    expect(move(r, g, 'complete', 'todo')).toEqual({ propertyId: 'stage', value: 's-triage' });
    expect(move(r, g, 'complete', 'in_progress')).toEqual({
      propertyId: 'stage',
      value: 's-doing',
    });
    expect(move(row('b', { stage: 's-wait' }), g, 'todo', 'in_progress')).toBeNull();
  });
  it('ticks and unticks a checkbox', () => {
    expect(move(row('a'), 'done', 'false', 'true')).toEqual({ propertyId: 'done', value: true });
    expect(move(row('a', { done: true }), 'done', 'true', 'false')).toEqual({
      propertyId: 'done',
      value: false,
    });
    expect(move(row('a'), 'done', 'false', EMPTY_GROUP)).toBeNull();
  });
  it('replaces the multi-select value it was dragged from and keeps the others', () => {
    const r = row('a', { tags: ['t-urgent', 't-deleted', 't-callback'] });
    expect(move(r, 'tags', 't-urgent', 't-warranty')).toEqual({
      propertyId: 'tags',
      value: ['t-warranty', 't-callback'],
    });
    expect(move(r, 'tags', 't-urgent', 't-callback')).toEqual({
      propertyId: 'tags',
      value: ['t-callback'],
    });
    expect(move(row('b'), 'tags', EMPTY_GROUP, 't-urgent')).toEqual({
      propertyId: 'tags',
      value: ['t-urgent'],
    });
    expect(move(r, 'tags', 't-urgent', EMPTY_GROUP)).toEqual({ propertyId: 'tags', value: null });
    expect(move(r, 'tags', 't-urgent', 't-deleted')).toBeNull();
  });
  it('replaces the person dragged from, or sets a one-person property', () => {
    const r = row('a', { owner: ['u-avery', 'u-jordan'], lead: ['u-avery'] });
    expect(move(r, 'owner', 'u-avery', 'u-sam')).toEqual({
      propertyId: 'owner',
      value: ['u-sam', 'u-jordan'],
    });
    expect(move(r, 'lead', 'u-avery', 'u-jordan')).toEqual({
      propertyId: 'lead',
      value: ['u-jordan'],
    });
    expect(move(r, 'owner', 'u-avery', EMPTY_GROUP)).toEqual({ propertyId: 'owner', value: null });
  });
  it("keeps links the viewer can't open, and never moves into or out of their group", () => {
    const r = row('a', { jobs: ['r-secret', 'r-pine'] });
    expect(move(r, 'jobs', 'r-pine', 'r-intake')).toEqual({
      propertyId: 'jobs',
      value: ['r-secret', 'r-intake'],
    });
    expect(move(r, 'jobs', NO_ACCESS_GROUP, 'r-intake')).toBeNull();
    expect(move(r, 'jobs', 'r-pine', NO_ACCESS_GROUP)).toBeNull();
    expect(move(row('b', { job: ['r-pine'] }), 'job', 'r-pine', 'r-intake')).toEqual({
      propertyId: 'job',
      value: ['r-intake'],
    });
  });
  it('refuses a move past the 500-link limit', () => {
    const links = Array.from({ length: 500 }, (_, i) => `r-${i}`);
    expect(move(row('a', { jobs: links }), 'jobs', EMPTY_GROUP, 'r-pine')).toBeNull();
    expect(move(row('a', { jobs: links }), 'jobs', 'r-0', 'r-pine')).toMatchObject({
      propertyId: 'jobs',
    });
  });
  it('sets exact text and numbers', () => {
    expect(move(row('a'), 'notes', EMPTY_GROUP, 'Job 2')).toEqual({
      propertyId: 'notes',
      value: fromPlainText('Job 2'),
    });
    const site = 'https://bluepine.example';
    expect(move(row('a'), 'site', EMPTY_GROUP, site)).toEqual({ propertyId: 'site', value: site });
    expect(move(row('a', { amount: '5' }), 'amount', '5', '12.5')).toEqual({
      propertyId: 'amount',
      value: '12.5',
    });
    expect(move(row('a', { amount: '5' }), 'amount', '5', EMPTY_GROUP)).toEqual({
      propertyId: 'amount',
      value: null,
    });
    expect(move(row('a', { amount: '5' }), 'amount', '5', 'lots')).toBeNull();
  });
  it("can't move date, letter, range, automatic or computed groups", () => {
    const r = row('a', { due: date('2026-10-26'), notes: fromPlainText('Avery'), amount: '5' });
    expect(move(r, 'due', 'today', 'tomorrow')).toBeNull();
    expect(move(r, by('due', { dateBucket: 'day' }), '2026-10-26', '2026-10-27')).toBeNull();
    expect(move(r, by('notes', { textBy: 'alphabetical' }), 'A', 'B')).toBeNull();
    expect(
      move(r, by('amount', { numberRange: { start: 0, end: 10, step: 5 } }), '5', '0'),
    ).toBeNull();
    expect(move(r, 'creator', 'u-avery', 'u-jordan')).toBeNull();
    expect(move(r, 'score', '1', '2')).toBeNull();
    expect(move(r, 'gone', 'a', 'b')).toBeNull();
  });
});

describe('valueForGroup', () => {
  const value = (g: Grouping | string, key: string) =>
    valueForGroup(typeof g === 'string' ? by(g) : g, key, ctx);
  const day = (start: string) => ({
    propertyId: 'due',
    value: { start, end: null, hasTime: false },
  });
  it("fills in the group's option, person, row or checkbox", () => {
    expect(value('trade', 'o-hvac')).toEqual({ propertyId: 'trade', value: 'o-hvac' });
    expect(value('trade', 'o-deleted')).toBeNull();
    expect(value('tags', 't-urgent')).toEqual({ propertyId: 'tags', value: ['t-urgent'] });
    expect(value('stage', 's-wait')).toEqual({ propertyId: 'stage', value: 's-wait' });
    expect(value(by('stage', { statusBy: 'group' }), 'complete')).toEqual({
      propertyId: 'stage',
      value: 's-done',
    });
    expect(value(by('stage', { statusBy: 'group' }), 'todo')).toEqual({
      propertyId: 'stage',
      value: 's-triage',
    });
    expect(value('owner', 'u-jordan')).toEqual({ propertyId: 'owner', value: ['u-jordan'] });
    expect(value('jobs', 'r-pine')).toEqual({ propertyId: 'jobs', value: ['r-pine'] });
    expect(value('jobs', NO_ACCESS_GROUP)).toBeNull();
    expect(value('done', 'true')).toEqual({ propertyId: 'done', value: true });
  });
  it('fills in exact text and numbers, not letters or ranges', () => {
    expect(value('notes', 'Leak')).toEqual({ propertyId: 'notes', value: fromPlainText('Leak') });
    expect(value(by('notes', { textBy: 'alphabetical' }), 'L')).toBeNull();
    expect(value('amount', '12.5')).toEqual({ propertyId: 'amount', value: '12.5' });
    expect(value(by('amount', { numberRange: { start: 0, end: 10, step: 5 } }), '5')).toBeNull();
  });
  it('fills in the first day of a date group, and Today, Tomorrow or Yesterday', () => {
    expect(value(by('due', { dateBucket: 'day' }), '2026-10-30')).toEqual(day('2026-10-30'));
    expect(value(by('due', { dateBucket: 'week' }), '2026-10-25')).toEqual(day('2026-10-25'));
    expect(value(by('due', { dateBucket: 'month' }), '2026-11')).toEqual(day('2026-11-01'));
    expect(value(by('due', { dateBucket: 'year' }), '2027')).toEqual(day('2027-01-01'));
    expect(value('due', 'today')).toEqual(day('2026-10-26'));
    expect(value('due', 'tomorrow')).toEqual(day('2026-10-27'));
    expect(value('due', 'yesterday')).toEqual(day('2026-10-25'));
    expect(value('due', 'next_7_days')).toBeNull();
    expect(value('due', 'later')).toBeNull();
    expect(value(by('due', { dateBucket: 'day' }), 'soon')).toBeNull();
  });
  it('clears on "No value" only where a value can be cleared', () => {
    expect(value('trade', EMPTY_GROUP)).toEqual({ propertyId: 'trade', value: null });
    expect(value('due', EMPTY_GROUP)).toEqual({ propertyId: 'due', value: null });
    expect(value('done', EMPTY_GROUP)).toBeNull();
    expect(value('creator', EMPTY_GROUP)).toBeNull();
    expect(value('score', EMPTY_GROUP)).toBeNull();
    expect(value('creator', 'u-avery')).toBeNull();
    expect(value('gone', 'x')).toBeNull();
  });
});
