import { describe, expect, it } from 'vitest';
import { fromPlainText } from './richtext';
import type { ReadValue } from './row';
import { canSortBy, compareForSort, compareSortKeys, pruneSorts, sortRows } from './sort';
import type {
  ComputedValue,
  EvalContext,
  Property,
  PropertyConfig,
  Row,
  SelectOption,
  Sort,
  Viewer,
} from './types';

const prop = <C extends PropertyConfig>(id: string, config: C): Property<C> => ({
  id,
  name: id,
  description: '',
  config,
  rowPage: 'always',
});
const opt = (id: string, name: string): SelectOption => ({ id, name, color: 'gray' });
const NUMBER = {
  format: 'number',
  currency: 'USD',
  decimals: 'auto',
  showAs: 'number',
  color: 'blue',
  divideBy: null,
  showNumber: true,
} as const;

const properties: Property[] = [
  prop('name', { type: 'title' }),
  prop('notes', { type: 'text' }),
  prop('amount', { type: 'number', ...NUMBER }),
  // Option order: HVAC, Plumbing, Electrical (not A to Z).
  prop('trade', {
    type: 'select',
    options: [
      opt('o-hvac', 'HVAC'),
      opt('o-plumbing', 'Plumbing'),
      opt('o-electrical', 'Electrical'),
    ],
  }),
  prop('stage', {
    type: 'status',
    defaultOptionId: 's-new',
    options: [
      { ...opt('s-new', 'Not started'), group: 'todo' },
      { ...opt('s-done', 'Done'), group: 'complete' },
    ],
  }),
  prop('tags', {
    type: 'multi_select',
    options: [opt('t-urgent', 'Urgent'), opt('t-callback', 'Callback')],
  }),
  prop('due', { type: 'date', format: 'full', timeFormat: 'viewer' }),
  prop('done', { type: 'checkbox' }),
  prop('owner', { type: 'person', single: false, notify: true }),
  prop('steps', { type: 'checklist' }),
  prop('ticket', { type: 'unique_id', prefix: 'QA' }),
  prop('created', { type: 'created_time', format: 'full', timeFormat: 'viewer' }),
  prop('creator', { type: 'created_by' }),
  prop('score', { type: 'formula', expression: '', resultKind: 'number', number: null }),
  prop('files', { type: 'files' }),
  prop('jobs', {
    type: 'relation',
    targetDatabaseId: 'db-jobs',
    single: false,
    twoWayPropertyId: null,
  }),
  prop('button', { type: 'button', label: 'Call back', actions: [] }),
];
const p = (id: string): Property => {
  const found = properties.find((x) => x.id === id);
  if (!found) throw new Error(`No property ${id}`);
  return found;
};

const USERS: Record<string, string> = { 'u-avery': 'Avery Lin', 'u-jordan': 'Jordan Park' };
const TITLES: Record<string, string> = {
  'r-pine': 'Blue Pine Plumbing',
  'r-intake': 'Intake call',
};
const VIEWER: Viewer = {
  userId: 'u-avery',
  timeZone: 'America/Denver',
  weekStart: 0,
  hour12: true,
  now: new Date('2026-10-26T18:00:00Z'),
};
const context = (viewer: Partial<Viewer> = {}): EvalContext => ({
  properties,
  viewer: { ...VIEWER, ...viewer },
  userName: (id) => USERS[id],
  rowTitle: (id) => TITLES[id],
  computed: (row, id) => (row.values[id] as ComputedValue | undefined) ?? { kind: 'empty' },
});
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
const sign = (n: number): number => (n < 0 ? -1 : n > 0 ? 1 : 0);
const cmp = (id: string, a: unknown, b: unknown, direction: Sort['direction'] = 'asc', c = ctx) =>
  sign(compareForSort(p(id), a as ReadValue, b as ReadValue, c, direction));
const day = (start: string) => ({ start, end: null, hasTime: start.includes('T') });
const order = (rows: Row[], sorts: Sort[], manual?: string[]) =>
  sortRows(rows, sorts, ctx, manual).map((r) => r.id);

describe('canSortBy', () => {
  it('sorts every type but Files, Relation and Button', () => {
    const ok =
      'name notes amount trade stage tags due done owner steps ticket created creator score';
    for (const id of ok.split(' ')) expect(canSortBy(p(id))).toBe(true);
    for (const id of ['files', 'jobs', 'button']) expect(canSortBy(p(id))).toBe(false);
  });
});

describe('compareSortKeys', () => {
  it('puts empty keys last, then compares by rank and value', () => {
    expect(sign(compareSortKeys(null, { rank: 3, value: 'a' }))).toBe(1);
    expect(sign(compareSortKeys({ rank: 3, value: 'a' }, null))).toBe(-1);
    expect(compareSortKeys(null, null)).toBe(0);
    expect(sign(compareSortKeys({ rank: 1, value: 5 }, { rank: 3, value: 'a' }))).toBe(-1);
    expect(sign(compareSortKeys({ rank: 1, value: 10n }, { rank: 1, value: 9n }))).toBe(1);
    expect(sign(compareSortKeys({ rank: 3, value: 'Job 2' }, { rank: 3, value: 'job 10' }))).toBe(
      -1,
    );
  });
});

describe('compareForSort', () => {
  it('sorts text naturally, ignoring case and accents', () => {
    expect(cmp('name', 'Job 2', 'Job 10')).toBe(-1);
    expect(cmp('name', 'job 2', 'Job 10')).toBe(-1);
    expect(cmp('name', 'apple', 'Banana')).toBe(-1);
    expect(cmp('name', 'École', 'ecole')).toBe(0);
    expect(cmp('notes', fromPlainText('Item 10'), fromPlainText('item 9'))).toBe(1);
  });
  it('puts empty values last in both directions (DB-06)', () => {
    for (const direction of ['asc', 'desc'] as const) {
      expect(cmp('name', null, 'Avery', direction)).toBe(1);
      expect(cmp('name', 'Avery', null, direction)).toBe(-1);
      expect(cmp('amount', '5', null, direction)).toBe(-1);
      const error = { kind: 'error', message: 'Division by zero' };
      expect(cmp('score', error, { kind: 'number', value: 1 }, direction)).toBe(1);
    }
    expect(cmp('name', 'Avery', 'Jordan', 'desc')).toBe(1);
  });
  it('compares numbers exactly', () => {
    expect(cmp('amount', '999999999999999.0000000001', '999999999999999.0000000002')).toBe(-1);
    expect(cmp('amount', '-1', '0.5')).toBe(-1);
    expect(cmp('amount', '10', '9')).toBe(1);
  });
  it('sorts Select and Status by option order, Multi-select by its first known value', () => {
    expect(cmp('trade', 'o-hvac', 'o-electrical')).toBe(-1);
    expect(cmp('trade', 'o-deleted', 'o-electrical')).toBe(1);
    expect(cmp('stage', 's-done', 's-new')).toBe(1);
    expect(cmp('tags', ['t-deleted', 't-callback'], ['t-urgent'])).toBe(1);
  });
  it("sorts dates by their start, a date without a time from the viewer's midnight", () => {
    // 5 AM UTC is 11 PM the day before in Denver, and 5 AM the same day in London.
    const early = day('2026-10-26T05:00:00.000Z');
    expect(cmp('due', early, day('2026-10-26'))).toBe(-1);
    expect(
      cmp('due', day('2026-10-26'), early, 'asc', context({ timeZone: 'Europe/London' })),
    ).toBe(-1);
    const range = { start: '2026-10-20', end: '2026-10-30', hasTime: false };
    expect(cmp('due', range, day('2026-10-21'))).toBe(-1);
    expect(cmp('created', day('2026-10-26T15:00:00.000Z'), day('2026-10-26T14:00:00.000Z'))).toBe(
      1,
    );
  });
  it('puts unticked boxes first', () => {
    expect(cmp('done', false, true)).toBe(-1);
    expect(cmp('done', false, true, 'desc')).toBe(1);
  });
  it("sorts people by the first person's name", () => {
    expect(cmp('owner', ['u-unknown', 'u-jordan'], ['u-avery'])).toBe(1);
    expect(cmp('owner', ['u-unknown'], ['u-jordan'])).toBe(1);
    expect(cmp('creator', ['u-avery'], ['u-jordan'])).toBe(-1);
  });
  it('sorts checklists by the share done, and IDs by number', () => {
    const items = (...done: boolean[]) =>
      done.map((d, i) => ({ id: `i${i}`, text: 'Step', done: d }));
    expect(cmp('steps', items(true, false), items(true, true, false))).toBe(-1);
    expect(cmp('steps', null, items(false))).toBe(1);
    expect(cmp('ticket', '2', '10')).toBe(-1);
  });
  it('sorts formulas and rollups by their result, lists by their first item', () => {
    const v = (value: ComputedValue) => value;
    expect(cmp('score', v({ kind: 'number', value: 2 }), v({ kind: 'number', value: 10 }))).toBe(
      -1,
    );
    expect(
      cmp('score', v({ kind: 'text', value: 'Job 2' }), v({ kind: 'text', value: 'Job 10' })),
    ).toBe(-1);
    expect(
      cmp('score', v({ kind: 'boolean', value: false }), v({ kind: 'boolean', value: true })),
    ).toBe(-1);
    const date = (start: string) => v({ kind: 'date', value: day(start) });
    expect(cmp('score', date('2026-10-25'), date('2026-10-24'))).toBe(1);
    expect(
      cmp(
        'score',
        v({ kind: 'person', value: 'u-jordan' }),
        v({ kind: 'person', value: 'u-avery' }),
      ),
    ).toBe(1);
    const list = (...items: string[]) =>
      v({ kind: 'list', value: items.map((value) => ({ kind: 'text', value })) });
    expect(cmp('score', list('b', 'a'), list('c'))).toBe(-1);
    expect(cmp('score', list(), v({ kind: 'number', value: 1 }))).toBe(1);
  });
  it("sorts a page by its title, and one the viewer can't open as empty", () => {
    const page = (value: string) => ({ kind: 'page', value });
    expect(cmp('score', page('r-intake'), page('r-pine'))).toBe(1);
    expect(cmp('score', page('r-secret'), page('r-intake'))).toBe(1);
  });
});

describe('pruneSorts', () => {
  it('drops sorts on deleted or unsortable properties, and repeats', () => {
    const sorts: Sort[] = [
      { propertyId: 'amount', direction: 'desc' },
      { propertyId: 'gone', direction: 'asc' },
      { propertyId: 'files', direction: 'asc' },
      { propertyId: 'amount', direction: 'asc' },
      { propertyId: 'name', direction: 'asc' },
    ];
    expect(pruneSorts(sorts, properties)).toEqual([
      { propertyId: 'amount', direction: 'desc' },
      { propertyId: 'name', direction: 'asc' },
    ]);
  });
  it('keeps the first 10', () => {
    const many = Array.from({ length: 11 }, (_, i) => prop(`t${i}`, { type: 'text' }));
    const sorts = many.map((x): Sort => ({ propertyId: x.id, direction: 'asc' }));
    expect(pruneSorts(sorts, many).map((s) => s.propertyId)).toEqual(
      sorts.slice(0, 10).map((s) => s.propertyId),
    );
  });
});

describe('sortRows', () => {
  const rows = [
    row('a', { trade: 'o-plumbing', amount: '5' }),
    row('b', { trade: 'o-hvac' }),
    row('c', { amount: '7' }),
    row('d', { trade: 'o-plumbing', amount: '9' }),
    row('e', { trade: 'o-hvac', amount: '1' }),
  ];
  it('applies several sorts in turn, empty values last in both directions (DB-06)', () => {
    const by = (direction: Sort['direction']): Sort[] => [
      { propertyId: 'trade', direction: 'asc' },
      { propertyId: 'amount', direction },
    ];
    expect(order(rows, by('asc'))).toEqual(['e', 'b', 'a', 'd', 'c']);
    expect(order(rows, by('desc'))).toEqual(['e', 'b', 'd', 'a', 'c']);
    expect(order(rows, [{ propertyId: 'trade', direction: 'desc' }])).toEqual([
      'a',
      'd',
      'b',
      'e',
      'c',
    ]);
  });
  it('sorts by Name naturally, ignoring case ("Job 2" before "Job 10")', () => {
    const named = ['Job 10', 'job 2', 'Job 1', ''].map((title, i) => row(`r${i}`, {}, { title }));
    expect(order(named, [{ propertyId: 'name', direction: 'asc' }])).toEqual([
      'r2',
      'r1',
      'r0',
      'r3',
    ]);
    expect(order(named, [{ propertyId: 'name', direction: 'desc' }])).toEqual([
      'r0',
      'r1',
      'r2',
      'r3',
    ]);
  });
  it('breaks ties by manual order, then the oldest row, then the id', () => {
    const dated = [
      row('b', {}, { createdAt: '2026-10-02T00:00:00.000Z' }),
      row('a', {}, { createdAt: '2026-10-02T00:00:00.000Z' }),
      row('c', {}, { createdAt: '2026-10-01T00:00:00.000Z' }),
      row('m', {}, { createdAt: 'not a date' }),
    ];
    expect(order(dated, [])).toEqual(['c', 'a', 'b', 'm']);
    expect(order(dated, [], ['b', 'm', 'b'])).toEqual(['b', 'm', 'c', 'a']);
    expect(order(dated, [{ propertyId: 'done', direction: 'asc' }], ['a'])).toEqual([
      'a',
      'c',
      'b',
      'm',
    ]);
  });
  it('ignores sorts that can’t apply and leaves the input alone', () => {
    const two = [row('b'), row('a')];
    const sorts: Sort[] = [
      { propertyId: 'gone', direction: 'asc' },
      { propertyId: 'jobs', direction: 'asc' },
    ];
    expect(order(two, sorts)).toEqual(['a', 'b']);
    expect(two.map((r) => r.id)).toEqual(['b', 'a']);
  });
});
