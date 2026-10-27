import { describe, expect, it } from 'vitest';
import {
  aggregateFamily,
  aggregateLabel,
  aggregateValues,
  aggregatesFor,
  formatAggregate,
  viewTotals,
} from './aggregate';
import type { ReadValue } from './row';
import { defaultConfig, newProperty, relationConfig } from './schema';
import type {
  Aggregate,
  ComputedKind,
  ComputedValue,
  DateValue,
  EvalContext,
  Property,
  Row,
  Viewer,
} from './types';

const viewer: Viewer = {
  userId: 'u-avery',
  timeZone: 'America/Denver',
  weekStart: 0,
  hour12: true,
  now: new Date('2026-10-26T18:00:00Z'),
};
const people: Record<string, string> = { 'u-avery': 'Avery Lin', 'u-jordan': 'Jordan Park' };
const titles: Record<string, string> = { 'r-blue': 'Blue Pine Plumbing', 'r-call': 'Call Avery' };

const name = newProperty('Name', defaultConfig('title'));
const hours = newProperty('Hours', defaultConfig('number'));
const amount = newProperty('Amount', { ...defaultConfig('number'), format: 'number_commas' });
const cost = newProperty('Cost', { ...defaultConfig('number'), format: 'currency', decimals: 2 });
const done = newProperty('Done', defaultConfig('checkbox'));
const due = newProperty('Due', defaultConfig('date'));
const dueMdy = newProperty('Due (US)', { ...defaultConfig('date'), format: 'mdy' });
const created = newProperty('Created', defaultConfig('created_time'));
const notes = newProperty('Notes', defaultConfig('text'));
const owner = newProperty('Owner', defaultConfig('person'));
const vendor = newProperty('Vendor', relationConfig('db-vendors'));
const files = newProperty('Files', defaultConfig('files'));
const steps = newProperty('Steps', defaultConfig('checklist'));
const qaId = newProperty('ID', { type: 'unique_id', prefix: 'QA' });
const plainId = newProperty('No.', defaultConfig('unique_id'));
const button = newProperty('Go', defaultConfig('button'));
const tags = newProperty('Tags', {
  type: 'multi_select',
  options: [
    { id: 'o-urgent', name: 'Urgent', color: 'red' },
    { id: 'o-billing', name: 'Billing', color: 'blue' },
  ],
});
const stage = newProperty('Stage', {
  type: 'select',
  options: [{ id: 'o-open', name: 'Open', color: 'green' }],
});
const formula = (kind: ComputedKind | null, number: Property['config'] | null = null) =>
  newProperty(`F ${kind}`, {
    type: 'formula',
    expression: '1',
    resultKind: kind,
    number: number?.type === 'number' ? number : null,
  });
const rollupOf = (aggregate: Aggregate) =>
  newProperty(`R ${aggregate}`, {
    type: 'rollup',
    relationPropertyId: vendor.id,
    targetPropertyId: 'p-x',
    aggregate,
    number: null,
  });

const ctx: EvalContext = {
  properties: [name, hours, amount, cost, done, due, tags, notes],
  viewer,
  userName: (id) => people[id],
  rowTitle: (id) => titles[id],
};

let seq = 0;
function row(values: Row['values'] = {}, title = ''): Row {
  seq += 1;
  const at = `2026-10-${String(seq % 28 || 1).padStart(2, '0')}T15:00:00.000Z`;
  return {
    id: `r${seq}`,
    title,
    values,
    createdAt: at,
    createdBy: 'u-avery',
    editedAt: at,
    editedBy: 'u-jordan',
    uniqueNumber: seq,
  };
}

const run = (values: readonly ReadValue[], agg: Aggregate, prop: Property, c = ctx) =>
  aggregateValues(values, agg, prop, c);
const num = (value: number): ComputedValue => ({ kind: 'number', value });
const text = (value: string): ComputedValue => ({ kind: 'text', value });
const day = (start: string, end: string | null = null): DateValue => ({
  start,
  end,
  hasTime: false,
});
const at = (start: string, end: string | null = null): DateValue => ({ start, end, hasTime: true });
const date = (value: DateValue): ComputedValue => ({ kind: 'date', value });

const COUNTS = ['count_all', 'count_values', 'count_unique', 'count_empty', 'count_not_empty'];
const PERCENTS = ['percent_empty', 'percent_not_empty'];
const NUMBERS = ['sum', 'average', 'median', 'min', 'max', 'range'];
const DATES = ['earliest', 'latest', 'date_range'];
const CHECKS = ['checked', 'unchecked', 'percent_checked', 'percent_unchecked'];

describe('aggregateLabel', () => {
  it.each([
    ['none', 'None'],
    ['show_original', 'Show original'],
    ['show_unique', 'Show unique values'],
    ['count_all', 'Count all'],
    ['count_values', 'Count values'],
    ['count_unique', 'Count unique values'],
    ['count_empty', 'Count empty'],
    ['count_not_empty', 'Count not empty'],
    ['percent_empty', 'Percent empty'],
    ['percent_not_empty', 'Percent not empty'],
    ['sum', 'Sum'],
    ['average', 'Average'],
    ['median', 'Median'],
    ['min', 'Min'],
    ['max', 'Max'],
    ['range', 'Range'],
    ['earliest', 'Earliest'],
    ['latest', 'Latest'],
    ['date_range', 'Date range'],
    ['checked', 'Checked'],
    ['unchecked', 'Unchecked'],
    ['percent_checked', 'Percent checked'],
    ['percent_unchecked', 'Percent unchecked'],
  ] as const)('%s is "%s"', (agg, label) => {
    expect(aggregateLabel(agg)).toBe(label);
  });

  it('says "Earliest date" and "Latest date" for rollups', () => {
    expect(aggregateLabel('earliest', { rollup: true })).toBe('Earliest date');
    expect(aggregateLabel('latest', { rollup: true })).toBe('Latest date');
    expect(aggregateLabel('date_range', { rollup: true })).toBe('Date range');
    expect(aggregateLabel('sum', { rollup: true })).toBe('Sum');
  });

  it('gives each calculation a family', () => {
    expect(aggregateFamily('show_unique')).toBe('list');
    expect(aggregateFamily('checked')).toBe('count');
    expect(aggregateFamily('percent_unchecked')).toBe('percent');
    expect(aggregateFamily('median')).toBe('number');
    expect(aggregateFamily('date_range')).toBe('date');
    expect(aggregateFamily('none')).toBe('none');
  });
});

describe('aggregatesFor', () => {
  it('offers None, the counts and percents, then number maths for numbers', () => {
    expect(aggregatesFor(hours)).toEqual(['none', ...COUNTS, ...PERCENTS, ...NUMBERS]);
  });

  it('offers dates and checkboxes their own', () => {
    expect(aggregatesFor(due)).toEqual(['none', ...COUNTS, ...PERCENTS, ...DATES]);
    expect(aggregatesFor(created)).toEqual(['none', ...COUNTS, ...PERCENTS, ...DATES]);
    expect(aggregatesFor(done)).toEqual(['none', ...COUNTS, ...PERCENTS, ...CHECKS]);
  });

  it('offers other properties the counts and percents only', () => {
    for (const p of [notes, tags, owner, vendor, files, steps, qaId]) {
      expect(aggregatesFor(p)).toEqual(['none', ...COUNTS, ...PERCENTS]);
    }
  });

  it('offers Name the counts only', () => {
    expect(aggregatesFor(name)).toEqual(['none', ...COUNTS]);
  });

  it('offers a Button only Count all', () => {
    expect(aggregatesFor(button)).toEqual(['none', 'count_all']);
    expect(aggregatesFor(button, { rollup: true })).toEqual(['count_all']);
  });

  it('offers Show original and Show unique values only for rollups, without None', () => {
    expect(aggregatesFor(hours, { rollup: true })).toEqual([
      'show_original',
      'show_unique',
      ...COUNTS,
      ...PERCENTS,
      ...NUMBERS,
    ]);
    expect(aggregatesFor(name, { rollup: true })).toEqual([
      'show_original',
      'show_unique',
      ...COUNTS,
      ...PERCENTS,
    ]);
  });

  it('follows the result kind of formulas and rollups', () => {
    expect(aggregatesFor(formula('number'))).toEqual(['none', ...COUNTS, ...PERCENTS, ...NUMBERS]);
    expect(aggregatesFor(formula('date'))).toEqual(['none', ...COUNTS, ...PERCENTS, ...DATES]);
    expect(aggregatesFor(formula('boolean'))).toEqual(['none', ...COUNTS, ...PERCENTS, ...CHECKS]);
    expect(aggregatesFor(formula('text'))).toEqual(['none', ...COUNTS, ...PERCENTS]);
    expect(aggregatesFor(formula(null))).toEqual(['none', ...COUNTS, ...PERCENTS]);
    expect(aggregatesFor(rollupOf('sum'))).toEqual(['none', ...COUNTS, ...PERCENTS, ...NUMBERS]);
    expect(aggregatesFor(rollupOf('latest'))).toEqual(['none', ...COUNTS, ...PERCENTS, ...DATES]);
    expect(aggregatesFor(rollupOf('show_original'))).toEqual(['none', ...COUNTS, ...PERCENTS]);
  });
});

describe('aggregateValues: counts and percents', () => {
  const cells: ReadValue[] = [['o-urgent', 'o-billing'], ['o-urgent'], null, ['o-gone']];

  it('counts rows, values and unique values; a deleted option is empty', () => {
    expect(run(cells, 'count_all', tags)).toEqual(num(4));
    expect(run(cells, 'count_values', tags)).toEqual(num(3));
    expect(run(cells, 'count_unique', tags)).toEqual(num(2));
    expect(run(cells, 'count_empty', tags)).toEqual(num(2));
    expect(run(cells, 'count_not_empty', tags)).toEqual(num(2));
  });

  it('gives percents as shares from 0 to 1, to a tenth of a percent', () => {
    expect(run(cells, 'percent_empty', tags)).toEqual(num(0.5));
    expect(run(['a', null, null], 'percent_not_empty', name)).toEqual(num(0.333));
    expect(run(['a', null, null], 'percent_empty', name)).toEqual(num(0.667));
    expect(run(['a', 'b', 'c', null], 'percent_empty', name)).toEqual(num(0.25));
  });

  it('gives 0 for counts and percents of no rows, and empty for None', () => {
    expect(run([], 'count_all', tags)).toEqual(num(0));
    expect(run([], 'count_unique', tags)).toEqual(num(0));
    expect(run([], 'percent_empty', tags)).toEqual(num(0));
    expect(run(cells, 'none', tags)).toEqual({ kind: 'empty' });
  });

  it('counts checkboxes: an unticked box is a value, never empty', () => {
    const boxes = [true, false, true, false];
    expect(run(boxes, 'checked', done)).toEqual(num(2));
    expect(run(boxes, 'unchecked', done)).toEqual(num(2));
    expect(run([true, false, false], 'percent_checked', done)).toEqual(num(0.333));
    expect(run([true, false, false], 'percent_unchecked', done)).toEqual(num(0.667));
    expect(run(boxes, 'count_empty', done)).toEqual(num(0));
    expect(run(boxes, 'count_values', done)).toEqual(num(4));
    expect(run(boxes, 'count_unique', done)).toEqual(num(2));
  });

  it('counts a formula error as empty (and unchecked)', () => {
    const flag = formula('boolean');
    const values: ReadValue[] = [
      { kind: 'boolean', value: true },
      { kind: 'error', message: 'Oops' },
      { kind: 'boolean', value: false },
    ];
    expect(run(values, 'checked', flag)).toEqual(num(1));
    expect(run(values, 'unchecked', flag)).toEqual(num(2));
    expect(run(values, 'count_empty', flag)).toEqual(num(1));
  });

  it('counts only relation links the viewer can open', () => {
    const links: ReadValue[] = [['r-blue', 'r-hidden'], ['r-hidden'], ['r-call', 'r-blue']];
    expect(run(links, 'count_values', vendor)).toEqual(num(3));
    expect(run(links, 'count_unique', vendor)).toEqual(num(2));
    expect(run(links, 'count_empty', vendor)).toEqual(num(1));
    const open: EvalContext = { properties: ctx.properties, viewer, userName: ctx.userName };
    expect(run(links, 'count_values', vendor, open)).toEqual(num(5));
  });

  it('counts people, files, text and IDs', () => {
    expect(run([['u-avery'], ['u-avery', 'u-jordan'], null], 'count_unique', owner)).toEqual(
      num(2),
    );
    const f = (n: string) => ({ id: n, name: n, size: 1, mime: 'text/plain' });
    expect(run([[f('a.pdf'), f('b.pdf')], null], 'count_values', files)).toEqual(num(2));
    expect(run([[{ text: '' }], [{ text: 'Call' }]], 'count_empty', notes)).toEqual(num(1));
    expect(run(['12', '12', '13'], 'count_unique', qaId)).toEqual(num(2));
    expect(run([null, null], 'count_all', button)).toEqual(num(2));
    expect(run([null, null], 'count_values', button)).toEqual(num(0));
  });
});

describe('aggregateValues: number maths', () => {
  it('adds exactly', () => {
    expect(run(['0.1', '0.2'], 'sum', hours)).toEqual(num(0.3));
    expect(run(['1.5', null, '2.25', '4'], 'sum', hours)).toEqual(num(7.75));
  });

  it('averages, takes the median, min, max and range', () => {
    expect(run(['1', '2', '4', null], 'average', hours)).toMatchObject({ kind: 'number' });
    const avg = run(['1', '2', '4'], 'average', hours);
    expect(avg.kind === 'number' ? avg.value : NaN).toBeCloseTo(7 / 3, 9);
    expect(run(['3', '1', '2'], 'median', hours)).toEqual(num(2));
    expect(run(['10', '1', '3', '2'], 'median', hours)).toEqual(num(2.5));
    expect(run(['-1.5', '10', '2'], 'min', hours)).toEqual(num(-1.5));
    expect(run(['-1.5', '10', '2'], 'max', hours)).toEqual(num(10));
    expect(run(['-1.5', '10', '2'], 'range', hours)).toEqual(num(11.5));
  });

  it('gives empty with no numbers', () => {
    for (const agg of NUMBERS) {
      expect(run([], agg as Aggregate, hours)).toEqual({ kind: 'empty' });
      expect(run([null, null], agg as Aggregate, hours)).toEqual({ kind: 'empty' });
    }
  });

  it('uses formula numbers, list items, checklist shares and plain IDs', () => {
    const total = formula('number');
    const values: ReadValue[] = [
      num(2),
      { kind: 'error', message: 'Oops' },
      { kind: 'list', value: [num(1), text('a'), { kind: 'empty' }] },
    ];
    expect(run(values, 'sum', total)).toEqual(num(3));
    const items = (...d: boolean[]) => d.map((x, i) => ({ id: `c${i}`, text: 'Step', done: x }));
    expect(run([items(true, false), items(true), [], null], 'average', steps)).toEqual(num(0.75));
    expect(run(['12', '3', null], 'max', plainId)).toEqual(num(12));
  });
});

describe('aggregateValues: dates', () => {
  const days = [
    day('2026-10-05'),
    day('2026-10-01', '2026-10-03'),
    day('2026-10-20', '2026-10-26'),
  ];

  it('takes the earliest start, the latest end, and the range between', () => {
    expect(run(days, 'earliest', due)).toEqual(date(day('2026-10-01')));
    expect(run(days, 'latest', due)).toEqual(date(day('2026-10-26')));
    expect(run(days, 'date_range', due)).toEqual(date(day('2026-10-01', '2026-10-26')));
  });

  it('gives a range of one date without an end, and empty with no dates', () => {
    expect(run([day('2026-10-05'), null], 'date_range', due)).toEqual(date(day('2026-10-05')));
    expect(run([null], 'earliest', due)).toEqual({ kind: 'empty' });
    expect(run([], 'date_range', due)).toEqual({ kind: 'empty' });
  });

  it('works on times', () => {
    const times = ['2026-10-02T15:00:00.000Z', '2026-10-01T15:00:00.000Z'].map((t) => at(t));
    expect(run(times, 'earliest', created)).toEqual(date(at('2026-10-01T15:00:00.000Z')));
    expect(run(times, 'date_range', created)).toEqual(
      date(at('2026-10-01T15:00:00.000Z', '2026-10-02T15:00:00.000Z')),
    );
  });

  it('counts dates without a time from the viewer’s midnight', () => {
    // Midnight Oct 1 in Denver is 06:00 UTC, so 05:00 UTC (Sep 30, 11 PM there) is earlier.
    const mixed = [day('2026-10-01'), at('2026-10-01T05:00:00.000Z')];
    expect(run(mixed, 'earliest', due)).toEqual(date(at('2026-10-01T05:00:00.000Z')));
    expect(run([day('2026-10-01'), at('2026-10-01T07:00:00.000Z')], 'earliest', due)).toEqual(
      date(day('2026-10-01')),
    );
  });

  it('gives a range mixing days and times as days in the viewer’s time zone', () => {
    const mixed = [day('2026-10-02'), at('2026-10-27T03:00:00.000Z')];
    expect(run(mixed, 'date_range', due)).toEqual(date(day('2026-10-02', '2026-10-26')));
  });
});

describe('aggregateValues: lists', () => {
  it('shows the original values and the unique ones', () => {
    const cells: ReadValue[] = [['o-urgent', 'o-billing'], ['o-urgent'], null];
    expect(run(cells, 'show_original', tags)).toEqual({
      kind: 'list',
      value: [text('Urgent'), text('Billing'), text('Urgent')],
    });
    expect(run(cells, 'show_unique', tags)).toEqual({
      kind: 'list',
      value: [text('Urgent'), text('Billing')],
    });
    expect(run(['o-open', null], 'show_original', stage)).toEqual({
      kind: 'list',
      value: [text('Open')],
    });
    expect(run([null], 'show_original', tags)).toEqual({ kind: 'empty' });
  });

  it('keeps people, pages, numbers, dates and styled text as they are', () => {
    expect(run([['u-jordan']], 'show_original', owner)).toEqual({
      kind: 'list',
      value: [{ kind: 'person', value: 'u-jordan' }],
    });
    expect(run([['r-blue', 'r-hidden']], 'show_original', vendor)).toEqual({
      kind: 'list',
      value: [{ kind: 'page', value: 'r-blue' }],
    });
    expect(run(['2.50', '2.5'], 'show_unique', hours)).toEqual({ kind: 'list', value: [num(2.5)] });
    expect(run([day('2026-10-01'), day('2026-10-01')], 'show_unique', due)).toEqual({
      kind: 'list',
      value: [date(day('2026-10-01'))],
    });
    const bold = [{ text: 'Call', marks: ['bold' as const] }];
    expect(run([bold, [{ text: 'Plain' }]], 'show_original', notes)).toEqual({
      kind: 'list',
      value: [{ kind: 'text', value: 'Call', rich: bold }, text('Plain')],
    });
    expect(run(['12'], 'show_original', qaId)).toEqual({ kind: 'list', value: [text('QA-12')] });
  });

  it('flattens formula lists and leaves out errors and empty text', () => {
    const list = formula('list');
    const values: ReadValue[] = [
      { kind: 'list', value: [text('a'), text(''), { kind: 'list', value: [num(1)] }] },
      { kind: 'error', message: 'Oops' },
      { kind: 'boolean', value: false },
    ];
    expect(run(values, 'show_original', list)).toEqual({
      kind: 'list',
      value: [text('a'), num(1), { kind: 'boolean', value: false }],
    });
  });
});

describe('formatAggregate', () => {
  const fmt = (result: ComputedValue, agg: Aggregate, prop: Property) =>
    formatAggregate(result, agg, prop, ctx);

  it('shows counts as whole numbers with commas', () => {
    expect(fmt(num(1234), 'count_all', name)).toBe('Count all 1,234');
    expect(fmt(num(0), 'count_empty', cost)).toBe('Count empty 0');
    expect(fmt(num(3), 'checked', done)).toBe('Checked 3');
  });

  it('shows percents with up to one decimal', () => {
    expect(fmt(num(0.25), 'percent_not_empty', notes)).toBe('Percent not empty 25%');
    expect(fmt(num(0.333), 'percent_empty', notes)).toBe('Percent empty 33.3%');
    expect(fmt(num(1 / 3), 'percent_checked', done)).toBe('Percent checked 33.3%');
    expect(fmt(num(1), 'percent_unchecked', done)).toBe('Percent unchecked 100%');
  });

  it('shows number maths in the property’s number format', () => {
    expect(fmt(num(12340), 'sum', amount)).toBe('Sum 12,340');
    expect(fmt(num(12340), 'sum', hours)).toBe('Sum 12340');
    expect(fmt(num(1234.5), 'sum', cost)).toBe('Sum $1,234.50');
    expect(fmt(num(2.5), 'average', hours)).toBe('Average 2.5');
    const share = formula('number', { ...defaultConfig('number'), format: 'percent' });
    expect(fmt(num(0.5), 'max', share)).toBe('Max 50%');
  });

  it('shows dates in the property’s date format, a range in one year without the first year', () => {
    expect(fmt(date(day('2026-10-01')), 'earliest', due)).toBe('Earliest Oct 1, 2026');
    expect(fmt(date(day('2026-10-26')), 'latest', due)).toBe('Latest Oct 26, 2026');
    expect(fmt(date(day('2026-10-01', '2026-10-26')), 'date_range', due)).toBe(
      'Date range Oct 1 → Oct 26, 2026',
    );
    expect(fmt(date(day('2025-12-30', '2026-01-02')), 'date_range', due)).toBe(
      'Date range Dec 30, 2025 → Jan 2, 2026',
    );
    expect(fmt(date(day('2026-10-01', '2026-10-26')), 'date_range', dueMdy)).toBe(
      'Date range 10/01/2026 → 10/26/2026',
    );
    expect(
      fmt(date(at('2026-10-01T15:00:00.000Z', '2026-10-26T23:00:00.000Z')), 'date_range', created),
    ).toBe('Date range Oct 1, 2026 9:00 AM → Oct 26, 2026 5:00 PM');
  });

  it('shows lists as text', () => {
    const list: ComputedValue = {
      kind: 'list',
      value: [
        text('Urgent'),
        { kind: 'person', value: 'u-avery' },
        { kind: 'page', value: 'r-blue' },
        { kind: 'boolean', value: true },
      ],
    };
    expect(fmt(list, 'show_original', tags)).toBe(
      'Show original Urgent, Avery Lin, Blue Pine Plumbing, Yes',
    );
  });

  it('shows just the label when there is nothing to show, and nothing for None', () => {
    expect(fmt({ kind: 'empty' }, 'sum', hours)).toBe('Sum');
    expect(fmt({ kind: 'empty' }, 'earliest', due)).toBe('Earliest');
    expect(fmt(num(5), 'none', hours)).toBe('');
  });
});

describe('viewTotals', () => {
  const rows = [
    row(
      { [hours.id]: '1.5', [cost.id]: '1000.25', [done.id]: true, [due.id]: day('2026-10-05') },
      'Avery Lin',
    ),
    row({ [hours.id]: '2.25', [cost.id]: '234.25', [due.id]: day('2026-10-01') }, 'Jordan Park'),
    row({ [hours.id]: '4', [done.id]: true }, 'Blue Pine Plumbing'),
    row({}, ''),
  ];

  it('works out every calculation over the rows given', () => {
    const totals = viewTotals(
      rows,
      {
        [name.id]: 'count_all',
        [hours.id]: 'sum',
        [cost.id]: 'sum',
        [done.id]: 'percent_checked',
        [due.id]: 'earliest',
        [notes.id]: 'count_empty',
      },
      ctx,
    );
    expect(totals).toEqual({
      [name.id]: { value: num(4), text: 'Count all 4' },
      [hours.id]: { value: num(7.75), text: 'Sum 7.75' },
      [cost.id]: { value: num(1234.5), text: 'Sum $1,234.50' },
      [done.id]: { value: num(0.5), text: 'Percent checked 50%' },
      [due.id]: { value: date(day('2026-10-01')), text: 'Earliest Oct 1, 2026' },
      [notes.id]: { value: num(4), text: 'Count empty 4' },
    });
  });

  it('works per group: any list of rows', () => {
    const calc = { [hours.id]: 'average' as const, [done.id]: 'checked' as const };
    expect(viewTotals(rows.slice(0, 2), calc, ctx)).toEqual({
      [hours.id]: { value: num(1.875), text: 'Average 1.875' },
      [done.id]: { value: num(1), text: 'Checked 1' },
    });
    expect(viewTotals(rows.slice(2), calc, ctx)).toEqual({
      [hours.id]: { value: num(4), text: 'Average 4' },
      [done.id]: { value: num(1), text: 'Checked 1' },
    });
    expect(viewTotals([], calc, ctx)).toEqual({
      [hours.id]: { value: { kind: 'empty' }, text: 'Average' },
      [done.id]: { value: num(0), text: 'Checked 0' },
    });
  });

  it('leaves out None, deleted properties and calculations a property no longer offers', () => {
    const totals = viewTotals(
      rows,
      { [hours.id]: 'none', 'p-deleted': 'sum', [tags.id]: 'sum', [name.id]: 'percent_empty' },
      ctx,
    );
    expect(totals).toEqual({});
  });

  it('keeps sums exact in the text, however large', () => {
    const big = [row({ [amount.id]: '9007199254740993' }), row({ [amount.id]: '1.05' })];
    const c = { ...ctx, properties: [amount] };
    expect(viewTotals(big, { [amount.id]: 'sum' }, c)[amount.id]?.text).toBe(
      'Sum 9,007,199,254,740,994.05',
    );
  });

  it('reads formulas through the context', () => {
    const total = formula('number');
    const c: EvalContext = {
      ...ctx,
      properties: [total],
      computed: (r) => num(r.id === rows[0]?.id ? 2 : 3),
    };
    expect(viewTotals(rows.slice(0, 2), { [total.id]: 'sum' }, c)).toEqual({
      [total.id]: { value: num(5), text: 'Sum 5' },
    });
  });
});
