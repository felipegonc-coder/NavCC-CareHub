import { describe, expect, it } from 'vitest';
import {
  countConditions,
  filterBarMode,
  filterOpLabel,
  filterOpsFor,
  filterPredicate,
  filterValueKind,
  matchesFilter,
  prefillFromFilter,
  pruneFilter,
  validateFilter,
} from './filter';
import { fromPlainText } from './richtext';
import { defaultConfig } from './schema';
import {
  LIMITS,
  ME,
  type Aggregate,
  type ComputedKind,
  type ComputedValue,
  type EvalContext,
  type FilterCondition,
  type FilterGroup,
  type FilterNode,
  type FilterOp,
  type FilterValue,
  type Property,
  type PropertyConfig,
  type Row,
  type SelectOption,
  type Viewer,
} from './types';

// Oct 26, 2026 is a Monday on Mountain Daylight Time (UTC−6): 18:00 UTC is noon in Denver.
const viewer: Viewer = {
  userId: 'u-avery',
  timeZone: 'America/Denver',
  weekStart: 0,
  hour12: true,
  now: new Date('2026-10-26T18:00:00.000Z'),
};

const prop = (id: string, name: string, config: PropertyConfig): Property => ({
  id,
  name,
  description: '',
  config,
  rowPage: 'always',
});
const opt = (id: string, name: string): SelectOption => ({ id, name, color: 'default' });
const formula = (id: string, name: string, resultKind: ComputedKind | null): Property =>
  prop(id, name, { type: 'formula', expression: 'prop("p-cost")', resultKind, number: null });
const rollup = (id: string, name: string, aggregate: Aggregate): Property =>
  prop(id, name, {
    type: 'rollup',
    relationPropertyId: 'p-vendor',
    targetPropertyId: 'v-name',
    aggregate,
    number: null,
  });

const name = prop('p-name', 'Name', { type: 'title' });
const notes = prop('p-notes', 'Notes', { type: 'text' });
const cost = prop('p-cost', 'Cost', defaultConfig('number'));
const trade = prop('p-trade', 'Trade', {
  type: 'select',
  options: [opt('o-plumb', 'Plumbing'), opt('o-elec', 'Electrical')],
});
const tags = prop('p-tags', 'Tags', {
  type: 'multi_select',
  options: [opt('t-urgent', 'Urgent'), opt('t-outdoor', 'Outdoor'), opt('t-cafe', 'Café')],
});
const stage = prop('p-stage', 'Stage', {
  type: 'status',
  defaultOptionId: 's-new',
  options: [
    { ...opt('s-new', 'Not started'), group: 'todo' },
    { ...opt('s-doing', 'In progress'), group: 'in_progress' },
    { ...opt('s-done', 'Done'), group: 'complete' },
  ],
});
const due = prop('p-due', 'Due', defaultConfig('date'));
const paid = prop('p-paid', 'Paid', { type: 'checkbox' });
const site = prop('p-site', 'Website', { type: 'url' });
const email = prop('p-email', 'Email', { type: 'email' });
const phone = prop('p-phone', 'Phone', { type: 'phone' });
const owner = prop('p-owner', 'Owner', defaultConfig('person'));
const photos = prop('p-photos', 'Photos', { type: 'files' });
const vendor = prop('p-vendor', 'Vendor', {
  type: 'relation',
  targetDatabaseId: 'db-vendors',
  single: false,
  twoWayPropertyId: null,
});
const steps = prop('p-steps', 'Steps', { type: 'checklist' });
const created = prop('p-created', 'Created', defaultConfig('created_time'));
const edited = prop('p-edited', 'Edited', defaultConfig('edited_time'));
const creator = prop('p-creator', 'Created by', { type: 'created_by' });
const editor = prop('p-editor', 'Edited by', { type: 'edited_by' });
const label = formula('f-text', 'Label', 'text');
const total = formula('f-num', 'Total', 'number');
const overdue = formula('f-bool', 'Overdue', 'boolean');
const nextVisit = formula('f-date', 'Next visit', 'date');
const lead = formula('f-person', 'Lead', 'person');
const mainVendor = formula('f-page', 'Main vendor', 'page');
const helpers = formula('f-list', 'Helpers', 'list');
const broken = formula('f-broken', 'Broken', null);
const vendorCost = rollup('r-sum', 'Vendor cost', 'sum');
const vendorNames = rollup('r-list', 'Vendor names', 'show_original');
const firstVisit = rollup('r-earliest', 'First visit', 'earliest');
const ticket = prop('p-id', 'Ticket', { type: 'unique_id', prefix: 'QA' });
const notify = prop('p-button', 'Notify', defaultConfig('button'));

const PROPS: Property[] = [
  name,
  notes,
  cost,
  trade,
  tags,
  stage,
  due,
  paid,
  site,
  email,
  phone,
  owner,
  photos,
  vendor,
  steps,
  created,
  edited,
  creator,
  editor,
  label,
  total,
  overdue,
  nextVisit,
  lead,
  mainVendor,
  helpers,
  broken,
  vendorCost,
  vendorNames,
  firstVisit,
  ticket,
  notify,
];

const people: Record<string, string> = {
  'u-avery': 'Avery Lin',
  'u-jordan': 'Jordan Park',
  'u-sam': 'Sam Rivera',
};
// Rows the viewer can open; "c-hidden" is a related row they can't.
const titles: Record<string, string> = {
  'c-blue': 'Blue Pine Plumbing',
  'c-cedar': 'Cedar Electric',
};
const userName = (id: string): string | undefined => people[id];
// Test rows keep formula and rollup results under the property id.
const computed = (r: Row, id: string): ComputedValue =>
  (r.values[id] as ComputedValue | undefined) ?? { kind: 'empty' };
const ctx: EvalContext = {
  properties: PROPS,
  viewer,
  userName,
  rowTitle: (id) => titles[id],
  computed,
};
const withViewer = (changes: Partial<Viewer>): EvalContext => ({
  ...ctx,
  viewer: { ...viewer, ...changes },
});

const row = (values: Row['values'] = {}, extra: Partial<Row> = {}): Row => ({
  id: 'row-1',
  title: '',
  values,
  // Oct 20 at 9 AM and Oct 26 at 11 AM in Denver.
  createdAt: '2026-10-20T15:00:00.000Z',
  createdBy: 'u-avery',
  editedAt: '2026-10-26T17:00:00.000Z',
  editedBy: 'u-jordan',
  uniqueNumber: 12,
  ...extra,
});
const titled = (title: string, values: Row['values'] = {}): Row => row(values, { title });

let seq = 0;
const cond = (propertyId: string, op: FilterOp, value?: unknown): FilterCondition =>
  value === undefined
    ? { kind: 'condition', id: `c${++seq}`, propertyId, op }
    : { kind: 'condition', id: `c${++seq}`, propertyId, op, value: value as FilterValue };
const allOf = (...children: FilterNode[]): FilterGroup => ({
  kind: 'group',
  id: `g${++seq}`,
  combinator: 'and',
  children,
});
const anyOf = (...children: FilterNode[]): FilterGroup => ({
  kind: 'group',
  id: `g${++seq}`,
  combinator: 'or',
  children,
});
/** True if the row matches every condition, for the default viewer. */
const hit = (r: Row, ...nodes: FilterNode[]): boolean => matchesFilter(r, allOf(...nodes), ctx);

describe('filterOpsFor', () => {
  const TEXT = [
    'is',
    'is_not',
    'contains',
    'does_not_contain',
    'starts_with',
    'ends_with',
    'is_empty',
    'is_not_empty',
  ];
  const NUMBER = ['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'is_empty', 'is_not_empty'];
  const PEOPLE = ['contains_any', 'does_not_contain', 'is_empty', 'is_not_empty'];
  const DATE = [
    'is',
    'before',
    'after',
    'on_or_before',
    'on_or_after',
    'between',
    'within',
    'is_empty',
    'is_not_empty',
  ];
  const cases: [Property, string[]][] = [
    [name, TEXT],
    [notes, TEXT],
    [site, TEXT],
    [email, TEXT],
    [phone, TEXT],
    [label, TEXT],
    [cost, NUMBER],
    [total, NUMBER],
    [vendorCost, NUMBER],
    [ticket, ['eq', 'neq', 'gt', 'lt', 'gte', 'lte']],
    [trade, ['is', 'is_not', 'is_empty', 'is_not_empty']],
    [stage, ['is', 'is_not', 'group_is', 'is_empty', 'is_not_empty']],
    [tags, ['contains_any', 'contains_all', 'does_not_contain', 'is_empty', 'is_not_empty']],
    [owner, PEOPLE],
    [creator, PEOPLE],
    [editor, PEOPLE],
    [lead, PEOPLE],
    [vendor, PEOPLE],
    [mainVendor, PEOPLE],
    [due, DATE],
    [created, DATE],
    [edited, DATE],
    [nextVisit, DATE],
    [firstVisit, DATE],
    [paid, ['is_checked', 'is_not_checked']],
    [overdue, ['is_checked', 'is_not_checked']],
    [steps, ['all_done', 'not_all_done', 'is_empty', 'is_not_empty']],
    [photos, ['is_empty', 'is_not_empty']],
    [helpers, ['contains', 'does_not_contain', 'is_empty', 'is_not_empty']],
    [vendorNames, ['contains', 'does_not_contain', 'is_empty', 'is_not_empty']],
    [notify, []],
    [broken, []],
  ];
  for (const [p, ops] of cases) {
    it(`${p.name} (${p.config.type}) offers ${ops.join(', ') || 'nothing'}`, () => {
      expect(filterOpsFor(p)).toEqual(ops);
    });
  }

  it('gives a new list each time', () => {
    filterOpsFor(paid).push('is_empty');
    expect(filterOpsFor(paid)).toEqual(['is_checked', 'is_not_checked']);
  });
});

describe('filterOpLabel', () => {
  it("uses the spec's words for every condition", () => {
    const labels: Record<FilterOp, string> = {
      is: 'Is',
      is_not: 'Is not',
      contains: 'Contains',
      does_not_contain: 'Does not contain',
      starts_with: 'Starts with',
      ends_with: 'Ends with',
      eq: 'Equals',
      neq: 'Not equal',
      gt: 'Greater than',
      lt: 'Less than',
      gte: 'At least',
      lte: 'At most',
      group_is: 'Group is',
      contains_any: 'Contains any of',
      contains_all: 'Contains all of',
      before: 'Is before',
      after: 'Is after',
      on_or_before: 'Is on or before',
      on_or_after: 'Is on or after',
      between: 'Is between',
      within: 'Is within',
      is_checked: 'Is ticked',
      is_not_checked: 'Is not ticked',
      all_done: 'All done',
      not_all_done: 'Not all done',
      is_empty: 'Is empty',
      is_not_empty: 'Is not empty',
    };
    for (const [op, text] of Object.entries(labels)) {
      expect(filterOpLabel(op as FilterOp)).toBe(text);
    }
  });

  it('labels every condition a property offers', () => {
    for (const p of PROPS) {
      for (const op of filterOpsFor(p)) expect(filterOpLabel(op)).toMatch(/^[A-Z][a-z ]+$/);
    }
  });
});

describe('filterValueKind', () => {
  it('names the input each condition needs', () => {
    expect(filterValueKind(notes, 'contains')).toBe('text');
    expect(filterValueKind(vendorNames, 'contains')).toBe('text');
    expect(filterValueKind(cost, 'gte')).toBe('number');
    expect(filterValueKind(ticket, 'gt')).toBe('number');
    expect(filterValueKind(total, 'eq')).toBe('number');
    expect(filterValueKind(trade, 'is')).toBe('options');
    expect(filterValueKind(tags, 'contains_all')).toBe('options');
    expect(filterValueKind(stage, 'is_not')).toBe('options');
    expect(filterValueKind(stage, 'group_is')).toBe('status_groups');
    expect(filterValueKind(owner, 'contains_any')).toBe('people');
    expect(filterValueKind(lead, 'does_not_contain')).toBe('people');
    expect(filterValueKind(vendor, 'contains_any')).toBe('rows');
    expect(filterValueKind(mainVendor, 'contains_any')).toBe('rows');
    expect(filterValueKind(due, 'on_or_after')).toBe('date');
    expect(filterValueKind(created, 'between')).toBe('date_range');
    expect(filterValueKind(nextVisit, 'within')).toBe('date_window');
  });

  it('needs no value for ticks, checklists and emptiness', () => {
    expect(filterValueKind(paid, 'is_checked')).toBe('none');
    expect(filterValueKind(overdue, 'is_not_checked')).toBe('none');
    expect(filterValueKind(steps, 'all_done')).toBe('none');
    expect(filterValueKind(notes, 'is_empty')).toBe('none');
    expect(filterValueKind(due, 'is_not_empty')).toBe('none');
    expect(filterValueKind(notify, 'is')).toBe('none');
    expect(filterValueKind(broken, 'contains')).toBe('none');
  });
});

describe('matching text', () => {
  const leak = titled('Fix kitchen LEAK', {
    'p-notes': fromPlainText('Café visit before noon'),
    'p-email': 'avery@bluepine.example',
    'p-site': 'https://bluepine.example/jobs',
    'p-phone': '+1 555 0142',
  });
  const blank = row();

  it('ignores case and accents', () => {
    expect(hit(leak, cond('p-name', 'contains', 'leak'))).toBe(true);
    expect(hit(leak, cond('p-name', 'is', 'fix kitchen leak'))).toBe(true);
    expect(hit(leak, cond('p-notes', 'contains', 'CAFE'))).toBe(true);
    expect(hit(leak, cond('p-notes', 'starts_with', 'café visit'))).toBe(true);
    expect(hit(leak, cond('p-notes', 'ends_with', 'NOON'))).toBe(true);
    expect(hit(leak, cond('p-email', 'ends_with', '@BluePine.example'))).toBe(true);
    expect(hit(leak, cond('p-site', 'starts_with', 'https://bluepine'))).toBe(true);
    expect(hit(leak, cond('p-phone', 'contains', '555'))).toBe(true);
  });

  it('checks the whole value for "is" and its ends for "starts with" and "ends with"', () => {
    expect(hit(leak, cond('p-name', 'is', 'kitchen'))).toBe(false);
    expect(hit(leak, cond('p-name', 'is_not', 'kitchen'))).toBe(true);
    expect(hit(leak, cond('p-name', 'is_not', 'Fix Kitchen Leak'))).toBe(false);
    expect(hit(leak, cond('p-name', 'does_not_contain', 'Leak'))).toBe(false);
    expect(hit(leak, cond('p-name', 'does_not_contain', 'sink'))).toBe(true);
    expect(hit(leak, cond('p-notes', 'starts_with', 'visit'))).toBe(false);
    expect(hit(leak, cond('p-notes', 'ends_with', 'visit'))).toBe(false);
  });

  it('matches empty values with "is not" and "does not contain" only', () => {
    expect(hit(blank, cond('p-site', 'is_not', 'x'))).toBe(true);
    expect(hit(blank, cond('p-notes', 'does_not_contain', 'x'))).toBe(true);
    for (const op of ['is', 'contains', 'starts_with', 'ends_with'] as const) {
      expect(hit(blank, cond('p-site', op, 'x'))).toBe(false);
      expect(hit(blank, cond('p-notes', op, 'x'))).toBe(false);
    }
  });

  it('treats text with no characters as empty', () => {
    const nothing = row({ 'p-notes': [{ text: '' }] });
    expect(hit(nothing, cond('p-notes', 'is_empty'))).toBe(true);
    expect(hit(nothing, cond('p-notes', 'is_not_empty'))).toBe(false);
    expect(hit(leak, cond('p-notes', 'is_not_empty'))).toBe(true);
    expect(hit(blank, cond('p-name', 'is_empty'))).toBe(true);
    expect(hit(leak, cond('p-name', 'is_empty'))).toBe(false);
  });

  it('filters formula text like text, and a formula error matches no value condition', () => {
    const ok = row({ 'f-text': { kind: 'text', value: 'Blue Pine' } });
    const err = row({ 'f-text': { kind: 'error', message: 'Division by zero' } });
    expect(hit(ok, cond('f-text', 'contains', 'pine'))).toBe(true);
    expect(hit(row(), cond('f-text', 'is_empty'))).toBe(true);
    expect(hit(row(), cond('f-text', 'does_not_contain', 'pine'))).toBe(true);
    expect(hit(row({ 'f-text': { kind: 'text', value: '' } }), cond('f-text', 'is_empty'))).toBe(
      true,
    );
    for (const op of ['is', 'is_not', 'contains', 'does_not_contain'] as const) {
      expect(hit(err, cond('f-text', op, 'pine'))).toBe(false);
    }
    expect(hit(err, cond('f-text', 'is_empty'))).toBe(false);
    expect(hit(err, cond('f-text', 'is_not_empty'))).toBe(true);
  });
});

describe('matching numbers', () => {
  const costs = (value: string): Row => row({ 'p-cost': value });

  it('compares exact decimals', () => {
    expect(hit(costs('12.5'), cond('p-cost', 'eq', '12.50'))).toBe(true);
    expect(hit(costs('12.5'), cond('p-cost', 'neq', '12.5'))).toBe(false);
    expect(hit(costs('12.5'), cond('p-cost', 'gt', '9'))).toBe(true);
    expect(hit(costs('12.5'), cond('p-cost', 'lt', '9'))).toBe(false);
    expect(hit(costs('12.5'), cond('p-cost', 'gte', '12.5'))).toBe(true);
    expect(hit(costs('12.5'), cond('p-cost', 'lte', '12.4'))).toBe(false);
    expect(hit(costs('-3'), cond('p-cost', 'lt', '0'))).toBe(true);
    expect(hit(costs('1000'), cond('p-cost', 'eq', '1e3'))).toBe(true);
    // A percent property stores 45% as 0.45.
    expect(hit(costs('0.45'), cond('p-cost', 'eq', '.45'))).toBe(true);
    // Too close for floating point numbers to tell apart.
    const big = costs('123456789012345.0000000001');
    expect(hit(big, cond('p-cost', 'gt', '123456789012345'))).toBe(true);
    expect(hit(big, cond('p-cost', 'eq', '123456789012345'))).toBe(false);
  });

  it('matches empty numbers with "≠" only', () => {
    const blank = row();
    expect(hit(blank, cond('p-cost', 'neq', '5'))).toBe(true);
    for (const op of ['eq', 'gt', 'lt', 'gte', 'lte'] as const) {
      expect(hit(blank, cond('p-cost', op, '5'))).toBe(false);
    }
    expect(hit(blank, cond('p-cost', 'is_empty'))).toBe(true);
    expect(hit(costs('0'), cond('p-cost', 'is_empty'))).toBe(false);
    expect(hit(costs('0'), cond('p-cost', 'is_not_empty'))).toBe(true);
  });

  it('compares formula and rollup number results', () => {
    const seven = row({ 'f-num': { kind: 'number', value: 7 } });
    expect(hit(seven, cond('f-num', 'gte', '7'))).toBe(true);
    expect(hit(seven, cond('f-num', 'lt', '7'))).toBe(false);
    expect(hit(seven, cond('f-num', 'eq', '7.0'))).toBe(true);
    expect(
      hit(row({ 'r-sum': { kind: 'number', value: 1250.5 } }), cond('r-sum', 'gt', '1000')),
    ).toBe(true);
    expect(hit(row(), cond('f-num', 'neq', '7'))).toBe(true);
    const nan = row({ 'f-num': { kind: 'number', value: Number.NaN } });
    expect(hit(nan, cond('f-num', 'eq', '7'))).toBe(false);
    expect(hit(nan, cond('f-num', 'neq', '7'))).toBe(false);
    const err = row({ 'f-num': { kind: 'error', message: 'Not a number' } });
    expect(hit(err, cond('f-num', 'neq', '7'))).toBe(false);
    expect(hit(err, cond('f-num', 'is_empty'))).toBe(false);
    expect(hit(err, cond('f-num', 'is_not_empty'))).toBe(true);
  });

  it('compares an ID by its number, not its text (12 > 9)', () => {
    expect(hit(row({}, { uniqueNumber: 12 }), cond('p-id', 'gt', '9'))).toBe(true);
    expect(hit(row({}, { uniqueNumber: 12 }), cond('p-id', 'lte', '9'))).toBe(false);
    expect(hit(row({}, { uniqueNumber: 12 }), cond('p-id', 'eq', '12'))).toBe(true);
    expect(hit(row({}, { uniqueNumber: 9 }), cond('p-id', 'lt', '12'))).toBe(true);
    expect(hit(row({}, { uniqueNumber: 9 }), cond('p-id', 'neq', '12'))).toBe(true);
  });
});

describe('matching select and status', () => {
  const plumbing = row({ 'p-trade': 'o-plumb', 'p-stage': 's-done' });
  const blank = row();

  it('matches "Is any of" and "Is none of"', () => {
    expect(hit(plumbing, cond('p-trade', 'is', ['o-elec', 'o-plumb']))).toBe(true);
    expect(hit(plumbing, cond('p-trade', 'is', ['o-elec']))).toBe(false);
    expect(hit(plumbing, cond('p-trade', 'is_not', ['o-plumb']))).toBe(false);
    expect(hit(plumbing, cond('p-trade', 'is_not', ['o-elec']))).toBe(true);
    expect(hit(blank, cond('p-trade', 'is', ['o-plumb']))).toBe(false);
    expect(hit(blank, cond('p-trade', 'is_not', ['o-plumb']))).toBe(true);
    expect(hit(blank, cond('p-trade', 'is_empty'))).toBe(true);
    expect(hit(plumbing, cond('p-trade', 'is_not_empty'))).toBe(true);
    expect(hit(plumbing, cond('p-stage', 'is', ['s-doing', 's-done']))).toBe(true);
  });

  it('matches a status group', () => {
    expect(hit(plumbing, cond('p-stage', 'group_is', ['complete']))).toBe(true);
    expect(hit(plumbing, cond('p-stage', 'group_is', ['todo', 'in_progress']))).toBe(false);
    expect(hit(row({ 'p-stage': 's-doing' }), cond('p-stage', 'group_is', ['in_progress']))).toBe(
      true,
    );
    expect(hit(row({ 'p-stage': 's-gone' }), cond('p-stage', 'group_is', ['todo']))).toBe(false);
    expect(hit(blank, cond('p-stage', 'group_is', ['todo']))).toBe(false);
  });
});

describe('matching multi-select, people and relations', () => {
  const both = row({ 'p-tags': ['t-urgent', 't-outdoor'] });
  const outdoor = row({ 'p-tags': ['t-outdoor'] });
  const blank = row();

  it('matches multi-select "contains any of", "contains all of" and "does not contain"', () => {
    expect(hit(outdoor, cond('p-tags', 'contains_any', ['t-urgent', 't-outdoor']))).toBe(true);
    expect(hit(outdoor, cond('p-tags', 'contains_all', ['t-urgent', 't-outdoor']))).toBe(false);
    expect(hit(both, cond('p-tags', 'contains_all', ['t-urgent', 't-outdoor']))).toBe(true);
    expect(hit(outdoor, cond('p-tags', 'does_not_contain', ['t-urgent']))).toBe(true);
    expect(hit(both, cond('p-tags', 'does_not_contain', ['t-urgent', 't-cafe']))).toBe(false);
    expect(hit(blank, cond('p-tags', 'does_not_contain', ['t-urgent']))).toBe(true);
    expect(hit(blank, cond('p-tags', 'contains_any', ['t-urgent']))).toBe(false);
    expect(hit(blank, cond('p-tags', 'is_empty'))).toBe(true);
    expect(hit(both, cond('p-tags', 'is_not_empty'))).toBe(true);
  });

  it('reads "Me" as whoever is looking', () => {
    const avery = row({ 'p-owner': ['u-jordan', 'u-avery'] });
    const sam = row({ 'p-owner': ['u-sam'] });
    const mine = allOf(cond('p-owner', 'contains_any', [ME]));
    expect(matchesFilter(avery, mine, ctx)).toBe(true);
    expect(matchesFilter(sam, mine, ctx)).toBe(false);
    expect(matchesFilter(sam, mine, withViewer({ userId: 'u-sam' }))).toBe(true);
    expect(hit(sam, cond('p-owner', 'does_not_contain', [ME]))).toBe(true);
    expect(hit(avery, cond('p-owner', 'does_not_contain', [ME]))).toBe(false);
    expect(hit(sam, cond('p-owner', 'contains_any', ['u-jordan', 'u-sam']))).toBe(true);
    expect(hit(blank, cond('p-owner', 'does_not_contain', ['u-sam']))).toBe(true);
  });

  it('matches who created and last edited a row', () => {
    expect(hit(row(), cond('p-creator', 'contains_any', [ME]))).toBe(true);
    expect(hit(row(), cond('p-editor', 'contains_any', ['u-jordan']))).toBe(true);
    expect(hit(row(), cond('p-editor', 'contains_any', [ME]))).toBe(false);
    // An anonymous form response has no creator.
    const anonymous = row({}, { createdBy: null, editedBy: null });
    expect(hit(anonymous, cond('p-creator', 'is_empty'))).toBe(true);
    expect(hit(anonymous, cond('p-creator', 'does_not_contain', [ME]))).toBe(true);
    expect(hit(anonymous, cond('p-editor', 'contains_any', [ME]))).toBe(false);
  });

  it('matches people and pages from formulas', () => {
    expect(
      hit(
        row({ 'f-person': { kind: 'person', value: 'u-avery' } }),
        cond('f-person', 'contains_any', [ME]),
      ),
    ).toBe(true);
    expect(
      hit(
        row({ 'f-page': { kind: 'page', value: 'c-blue' } }),
        cond('f-page', 'contains_any', ['c-blue']),
      ),
    ).toBe(true);
    expect(hit(row(), cond('f-page', 'does_not_contain', ['c-blue']))).toBe(true);
    const err = row({ 'f-page': { kind: 'error', message: 'No such row' } });
    expect(hit(err, cond('f-page', 'does_not_contain', ['c-blue']))).toBe(false);
  });

  it("never counts related rows the viewer can't open", () => {
    const linked = row({ 'p-vendor': ['c-blue', 'c-hidden'] });
    const hiddenOnly = row({ 'p-vendor': ['c-hidden'] });
    expect(hit(linked, cond('p-vendor', 'contains_any', ['c-blue']))).toBe(true);
    expect(hit(linked, cond('p-vendor', 'contains_any', ['c-hidden']))).toBe(false);
    expect(hit(hiddenOnly, cond('p-vendor', 'does_not_contain', ['c-hidden']))).toBe(true);
    expect(hit(linked, cond('p-vendor', 'does_not_contain', ['c-blue']))).toBe(false);
    // The cell still shows that something is linked.
    expect(hit(hiddenOnly, cond('p-vendor', 'is_not_empty'))).toBe(true);
    expect(
      hit(
        row({ 'f-page': { kind: 'page', value: 'c-hidden' } }),
        cond('f-page', 'contains_any', ['c-hidden']),
      ),
    ).toBe(false);
  });

  it('counts every related row when there are no titles to check', () => {
    const noTitles: EvalContext = { properties: PROPS, viewer, userName, computed };
    const f = allOf(cond('p-vendor', 'contains_any', ['c-hidden']));
    expect(matchesFilter(row({ 'p-vendor': ['c-hidden'] }), f, noTitles)).toBe(true);
  });
});

describe('matching dates', () => {
  const on = (start: string, end: string | null = null): Row =>
    row({ 'p-due': { start, end, hasTime: false } });
  const at = (start: string): Row => row({ 'p-due': { start, end: null, hasTime: true } });
  const today = on('2026-10-26');

  it('compares days with relative and exact dates', () => {
    expect(hit(today, cond('p-due', 'is', { relative: 'today' }))).toBe(true);
    expect(hit(today, cond('p-due', 'is', { exact: '2026-10-26' }))).toBe(true);
    expect(hit(today, cond('p-due', 'is', { relative: 'tomorrow' }))).toBe(false);
    expect(hit(today, cond('p-due', 'before', { relative: 'tomorrow' }))).toBe(true);
    expect(hit(today, cond('p-due', 'before', { relative: 'today' }))).toBe(false);
    expect(hit(today, cond('p-due', 'after', { relative: 'yesterday' }))).toBe(true);
    expect(hit(today, cond('p-due', 'after', { relative: 'today' }))).toBe(false);
    expect(hit(today, cond('p-due', 'on_or_before', { relative: 'today' }))).toBe(true);
    expect(hit(today, cond('p-due', 'on_or_after', { relative: 'today' }))).toBe(true);
    expect(hit(today, cond('p-due', 'on_or_after', { exact: '2026-10-27' }))).toBe(false);
    expect(hit(on('2026-10-19'), cond('p-due', 'is', { relative: 'one_week_ago' }))).toBe(true);
    expect(hit(on('2026-11-02'), cond('p-due', 'is', { relative: 'one_week_from_now' }))).toBe(
      true,
    );
    expect(hit(on('2026-09-26'), cond('p-due', 'is', { relative: 'one_month_ago' }))).toBe(true);
    expect(hit(on('2026-11-26'), cond('p-due', 'is', { relative: 'one_month_from_now' }))).toBe(
      true,
    );
  });

  it('includes both ends of "is between", in either order', () => {
    const week = { start: { exact: '2026-10-20' }, end: { exact: '2026-10-26' } };
    expect(hit(today, cond('p-due', 'between', week))).toBe(true);
    expect(hit(on('2026-10-20'), cond('p-due', 'between', week))).toBe(true);
    expect(hit(on('2026-10-19'), cond('p-due', 'between', week))).toBe(false);
    expect(hit(on('2026-10-27'), cond('p-due', 'between', week))).toBe(false);
    expect(
      hit(on('2026-10-22'), cond('p-due', 'between', { start: week.end, end: week.start })),
    ).toBe(true);
    const relative = { start: { relative: 'one_week_ago' }, end: { relative: 'yesterday' } };
    expect(hit(on('2026-10-22'), cond('p-due', 'between', relative))).toBe(true);
    expect(hit(today, cond('p-due', 'between', relative))).toBe(false);
  });

  it('treats "is within the next 7 days" as today and the 6 days after it (DB-04)', () => {
    const next7 = cond('p-due', 'within', 'next_7_days');
    expect(hit(on('2026-10-25'), next7)).toBe(false);
    expect(hit(today, next7)).toBe(true);
    expect(hit(on('2026-11-01'), next7)).toBe(true);
    expect(hit(on('2026-11-02'), next7)).toBe(false);
    expect(hit(row(), next7)).toBe(false);
  });

  it('matches the other windows', () => {
    expect(hit(on('2026-10-20'), cond('p-due', 'within', 'past_7_days'))).toBe(true);
    expect(hit(on('2026-10-19'), cond('p-due', 'within', 'past_7_days'))).toBe(false);
    expect(hit(on('2026-11-24'), cond('p-due', 'within', 'next_30_days'))).toBe(true);
    expect(hit(on('2026-10-01'), cond('p-due', 'within', 'this_month'))).toBe(true);
    expect(hit(on('2026-09-30'), cond('p-due', 'within', 'last_month'))).toBe(true);
    expect(hit(on('2027-01-01'), cond('p-due', 'within', 'next_year'))).toBe(true);
    const twoWeeks = { direction: 'next', count: 2, unit: 'week' };
    expect(hit(on('2026-11-08'), cond('p-due', 'within', twoWeeks))).toBe(true);
    expect(hit(on('2026-11-09'), cond('p-due', 'within', twoWeeks))).toBe(false);
    const threeDays = { direction: 'past', count: 3, unit: 'day' };
    expect(hit(on('2026-10-24'), cond('p-due', 'within', threeDays))).toBe(true);
    expect(hit(on('2026-10-23'), cond('p-due', 'within', threeDays))).toBe(false);
  });

  it("starts weeks on the viewer's week start", () => {
    const thisWeek = allOf(cond('p-due', 'within', 'this_week'));
    const monday = withViewer({ weekStart: 1 });
    // Sunday Oct 25 and Sunday Nov 1.
    expect(matchesFilter(on('2026-10-25'), thisWeek, ctx)).toBe(true);
    expect(matchesFilter(on('2026-11-01'), thisWeek, ctx)).toBe(false);
    expect(matchesFilter(on('2026-10-25'), thisWeek, monday)).toBe(false);
    expect(matchesFilter(on('2026-11-01'), thisWeek, monday)).toBe(true);
    expect(matchesFilter(on('2026-10-24'), allOf(cond('p-due', 'within', 'last_week')), ctx)).toBe(
      true,
    );
  });

  it('matches a date with an end by any of its days for between and within, by its start otherwise', () => {
    const trip = on('2026-10-20', '2026-10-28');
    const later = { start: { exact: '2026-10-27' }, end: { exact: '2026-10-30' } };
    expect(hit(trip, cond('p-due', 'between', later))).toBe(true);
    expect(hit(trip, cond('p-due', 'within', 'next_7_days'))).toBe(true);
    expect(hit(trip, cond('p-due', 'within', 'next_month'))).toBe(false);
    expect(hit(trip, cond('p-due', 'is', { exact: '2026-10-20' }))).toBe(true);
    expect(hit(trip, cond('p-due', 'is', { exact: '2026-10-27' }))).toBe(false);
    expect(hit(trip, cond('p-due', 'after', { relative: 'today' }))).toBe(false);
  });

  it("uses the viewer's time zone for today and for dates with a time", () => {
    // 05:30 UTC on Oct 27 is still Oct 26 in Denver (11:30 PM) but Oct 27 in London (GMT again).
    const now = new Date('2026-10-27T05:30:00.000Z');
    const denver = withViewer({ now });
    const london = withViewer({ now, timeZone: 'Europe/London' });
    const isToday = allOf(cond('p-due', 'is', { relative: 'today' }));
    expect(matchesFilter(on('2026-10-27'), isToday, denver)).toBe(false);
    expect(matchesFilter(on('2026-10-27'), isToday, london)).toBe(true);
    // 23:00 UTC on Oct 26 is 5 PM in Denver and 11 PM in London: Oct 26 in both.
    const evening = at('2026-10-26T23:00:00.000Z');
    expect(matchesFilter(evening, isToday, denver)).toBe(true);
    expect(matchesFilter(evening, isToday, london)).toBe(false);
    expect(
      matchesFilter(evening, allOf(cond('p-due', 'is', { relative: 'yesterday' })), london),
    ).toBe(true);
    // 03:00 UTC on Oct 27 is 9 PM on Oct 26 in Denver.
    const oct26 = allOf(cond('p-due', 'is', { exact: '2026-10-26' }));
    expect(matchesFilter(at('2026-10-27T03:00:00.000Z'), oct26, denver)).toBe(true);
    expect(matchesFilter(at('2026-10-27T03:00:00.000Z'), oct26, london)).toBe(false);
  });

  it('matches created and edited times, formula dates and rollup dates', () => {
    expect(hit(row(), cond('p-created', 'on_or_after', { exact: '2026-10-20' }))).toBe(true);
    expect(hit(row(), cond('p-created', 'before', { exact: '2026-10-20' }))).toBe(false);
    expect(hit(row(), cond('p-edited', 'is', { relative: 'today' }))).toBe(true);
    expect(hit(row(), cond('p-created', 'is_empty'))).toBe(false);
    const visit = row({
      'f-date': { kind: 'date', value: { start: '2026-10-30', end: null, hasTime: false } },
    });
    expect(hit(visit, cond('f-date', 'within', 'next_7_days'))).toBe(true);
    const first = row({
      'r-earliest': { kind: 'date', value: { start: '2026-10-01', end: null, hasTime: false } },
    });
    expect(hit(first, cond('r-earliest', 'before', { relative: 'today' }))).toBe(true);
    const err = row({ 'f-date': { kind: 'error', message: 'Bad date' } });
    expect(hit(err, cond('f-date', 'before', { relative: 'today' }))).toBe(false);
    expect(hit(err, cond('f-date', 'is_not_empty'))).toBe(true);
    expect(hit(row(), cond('f-date', 'is_empty'))).toBe(true);
  });

  it('matches empty dates with "is empty" only', () => {
    for (const op of ['is', 'before', 'after', 'on_or_before', 'on_or_after'] as const) {
      expect(hit(row(), cond('p-due', op, { relative: 'today' }))).toBe(false);
    }
    expect(hit(row(), cond('p-due', 'is_empty'))).toBe(true);
    expect(hit(today, cond('p-due', 'is_empty'))).toBe(false);
    expect(hit(today, cond('p-due', 'is_not_empty'))).toBe(true);
  });
});

describe('matching checkboxes, checklists and files', () => {
  it('treats an unticked box like one never ticked', () => {
    expect(hit(row({ 'p-paid': true }), cond('p-paid', 'is_checked'))).toBe(true);
    expect(hit(row({ 'p-paid': true }), cond('p-paid', 'is_not_checked'))).toBe(false);
    expect(hit(row({ 'p-paid': false }), cond('p-paid', 'is_checked'))).toBe(false);
    expect(hit(row(), cond('p-paid', 'is_not_checked'))).toBe(true);
  });

  it('matches yes/no formula results', () => {
    expect(
      hit(row({ 'f-bool': { kind: 'boolean', value: true } }), cond('f-bool', 'is_checked')),
    ).toBe(true);
    expect(
      hit(row({ 'f-bool': { kind: 'boolean', value: false } }), cond('f-bool', 'is_not_checked')),
    ).toBe(true);
    expect(hit(row(), cond('f-bool', 'is_not_checked'))).toBe(true);
    const err = row({ 'f-bool': { kind: 'error', message: 'Not a yes/no' } });
    expect(hit(err, cond('f-bool', 'is_checked'))).toBe(false);
    expect(hit(err, cond('f-bool', 'is_not_checked'))).toBe(false);
  });

  it('needs at least one item for "all done" and "not all done"', () => {
    const item = (id: string, done: boolean) => ({ id, text: `Step ${id}`, done });
    const done = row({ 'p-steps': [item('1', true), item('2', true)] });
    const half = row({ 'p-steps': [item('1', true), item('2', false)] });
    expect(hit(done, cond('p-steps', 'all_done'))).toBe(true);
    expect(hit(done, cond('p-steps', 'not_all_done'))).toBe(false);
    expect(hit(half, cond('p-steps', 'all_done'))).toBe(false);
    expect(hit(half, cond('p-steps', 'not_all_done'))).toBe(true);
    expect(hit(row(), cond('p-steps', 'all_done'))).toBe(false);
    expect(hit(row(), cond('p-steps', 'not_all_done'))).toBe(false);
    expect(hit(row(), cond('p-steps', 'is_empty'))).toBe(true);
    expect(hit(half, cond('p-steps', 'is_not_empty'))).toBe(true);
  });

  it('matches files by whether there are any', () => {
    const photo = row({
      'p-photos': [{ id: 'f-1', name: 'leak.jpg', size: 2048, mime: 'image/jpeg' }],
    });
    expect(hit(photo, cond('p-photos', 'is_not_empty'))).toBe(true);
    expect(hit(photo, cond('p-photos', 'is_empty'))).toBe(false);
    expect(hit(row(), cond('p-photos', 'is_empty'))).toBe(true);
  });
});

describe('matching lists (rollups that show values, list formulas)', () => {
  const list = (...value: ComputedValue[]): ComputedValue => ({ kind: 'list', value });
  const vendors = row({
    'r-list': list({ kind: 'text', value: 'Blue Pine Plumbing' }, { kind: 'number', value: 3 }),
  });

  it("matches any item's text, ignoring case and accents", () => {
    expect(hit(vendors, cond('r-list', 'contains', 'pine'))).toBe(true);
    expect(hit(vendors, cond('r-list', 'contains', '3'))).toBe(true);
    expect(hit(vendors, cond('r-list', 'contains', 'cedar'))).toBe(false);
    expect(hit(vendors, cond('r-list', 'does_not_contain', 'cedar'))).toBe(true);
    expect(hit(vendors, cond('r-list', 'does_not_contain', 'PINE'))).toBe(false);
    const cafe = row({ 'r-list': list({ kind: 'text', value: 'Café Rivera' }) });
    expect(hit(cafe, cond('r-list', 'contains', 'cafe'))).toBe(true);
  });

  it('reads people by name, rows by title, dates as shown and yes/no as true or false', () => {
    const mixed = row({
      'f-list': list(
        { kind: 'person', value: 'u-sam' },
        { kind: 'page', value: 'c-blue' },
        { kind: 'page', value: 'c-hidden' },
        { kind: 'date', value: { start: '2026-10-30', end: null, hasTime: false } },
        list({ kind: 'boolean', value: true }, { kind: 'error', message: 'Bad item' }),
      ),
    });
    expect(hit(mixed, cond('f-list', 'contains', 'sam rivera'))).toBe(true);
    expect(hit(mixed, cond('f-list', 'contains', 'blue pine'))).toBe(true);
    expect(hit(mixed, cond('f-list', 'contains', 'Oct 30, 2026'))).toBe(true);
    expect(hit(mixed, cond('f-list', 'contains', 'true'))).toBe(true);
    expect(hit(mixed, cond('f-list', 'contains', 'c-hidden'))).toBe(false);
    expect(hit(mixed, cond('f-list', 'contains', 'bad item'))).toBe(false);
  });

  it('handles empty lists and errors', () => {
    const none = row({ 'r-list': list() });
    expect(hit(none, cond('r-list', 'is_empty'))).toBe(true);
    expect(hit(none, cond('r-list', 'does_not_contain', 'pine'))).toBe(true);
    expect(hit(none, cond('r-list', 'contains', 'pine'))).toBe(false);
    expect(hit(vendors, cond('r-list', 'is_not_empty'))).toBe(true);
    const err = row({ 'r-list': { kind: 'error', message: 'Rollup failed' } });
    expect(hit(err, cond('r-list', 'contains', 'pine'))).toBe(false);
    expect(hit(err, cond('r-list', 'does_not_contain', 'pine'))).toBe(false);
  });
});

describe("conditions that don't filter yet", () => {
  const leak = titled('Fix kitchen leak');
  const fence = titled('Paint fence');

  it('skips conditions with no value', () => {
    for (const value of [undefined, null, '', []]) {
      expect(hit(fence, cond('p-name', 'contains', value))).toBe(true);
    }
    expect(hit(fence, cond('p-trade', 'is', []))).toBe(true);
    expect(hit(fence, cond('p-due', 'before'))).toBe(true);
    expect(hit(fence, cond('p-cost', 'gt', ''))).toBe(true);
  });

  it('never lets every row through "Any of" because of a condition with no value', () => {
    const f = anyOf(cond('p-name', 'contains', 'leak'), cond('p-notes', 'contains', ''));
    expect(matchesFilter(leak, f, ctx)).toBe(true);
    expect(matchesFilter(fence, f, ctx)).toBe(false);
    const nested = anyOf(
      cond('p-name', 'contains', 'leak'),
      allOf(cond('p-notes', 'contains', '')),
    );
    expect(matchesFilter(fence, nested, ctx)).toBe(false);
  });

  it("skips deleted properties, operators the property doesn't offer, formulas with errors and values that don't fit", () => {
    expect(hit(fence, cond('p-gone', 'contains', 'leak'))).toBe(true);
    expect(hit(fence, cond('p-paid', 'contains', 'leak'))).toBe(true);
    expect(hit(fence, cond('p-id', 'is_empty'))).toBe(true);
    expect(hit(fence, cond('p-button', 'is_empty'))).toBe(true);
    expect(hit(fence, cond('f-broken', 'contains', 'leak'))).toBe(true);
    expect(hit(fence, cond('p-cost', 'gt', 'lots'))).toBe(true);
    expect(hit(fence, cond('p-cost', 'gt', 5))).toBe(true);
    expect(hit(fence, cond('p-due', 'within', 'next_8_days'))).toBe(true);
    expect(hit(fence, cond('p-trade', 'is', 'o-plumb'))).toBe(true);
  });

  it('combines nested groups', () => {
    const f = allOf(
      cond('p-name', 'contains', 'fix'),
      anyOf(cond('p-trade', 'is', ['o-plumb']), cond('p-paid', 'is_checked')),
    );
    expect(matchesFilter(titled('Fix sink', { 'p-trade': 'o-plumb' }), f, ctx)).toBe(true);
    expect(matchesFilter(titled('Fix gate', { 'p-paid': true }), f, ctx)).toBe(true);
    expect(matchesFilter(titled('Fix light', { 'p-trade': 'o-elec' }), f, ctx)).toBe(false);
    expect(matchesFilter(titled('Paint fence', { 'p-trade': 'o-plumb' }), f, ctx)).toBe(false);
  });

  it('matches every row with no filter or an empty one', () => {
    expect(matchesFilter(fence, null, ctx)).toBe(true);
    expect(matchesFilter(fence, allOf(), ctx)).toBe(true);
    expect(matchesFilter(fence, anyOf(), ctx)).toBe(true);
    expect(matchesFilter(fence, anyOf(allOf(), anyOf()), ctx)).toBe(true);
  });

  it('prepares a filter once for many rows with filterPredicate', () => {
    const rows = [leak, fence, titled('Leak under the sink')];
    const test = filterPredicate(allOf(cond('p-name', 'contains', 'leak')), ctx);
    expect(rows.filter(test).map((r) => r.title)).toEqual([
      'Fix kitchen leak',
      'Leak under the sink',
    ]);
    expect(rows.filter(filterPredicate(null, ctx))).toHaveLength(3);
  });
});

describe('validateFilter', () => {
  const check = (...nodes: FilterNode[]): string | null => validateFilter(allOf(...nodes), PROPS);
  const INVALID = "This filter isn't valid.";
  const misfit = (propName: string): string =>
    `The filter on "${propName}" has a value that doesn't fit.`;

  it('accepts good filters, conditions with no value yet, and no filter', () => {
    expect(validateFilter(null, PROPS)).toBeNull();
    expect(check()).toBeNull();
    expect(
      check(
        cond('p-name', 'contains', 'leak'),
        anyOf(
          cond('p-cost', 'gte', '1e3'),
          cond('p-due', 'within', { direction: 'past', count: 1000, unit: 'day' }),
        ),
        cond('p-stage', 'group_is', ['todo', 'complete']),
        cond('p-owner', 'contains_any', [ME, 'u-sam']),
        cond('p-due', 'between', { start: { relative: 'today' }, end: { exact: '2026-12-31' } }),
        cond('p-due', 'within', 'next_7_days'),
        cond('p-id', 'gt', '9'),
        cond('r-list', 'contains', 'pine'),
        cond('p-notes', 'contains', ''),
        cond('p-trade', 'is', []),
        cond('p-due', 'before'),
        cond('p-paid', 'is_checked', 'ignored'),
        cond('f-broken', 'contains', 'anything'),
      ),
    ).toBeNull();
  });

  it("rejects things that aren't a filter", () => {
    const bad = (f: unknown): string | null => validateFilter(f as FilterGroup, PROPS);
    const node = (n: unknown): FilterNode => n as FilterNode;
    expect(bad('leak')).toBe(INVALID);
    expect(bad([])).toBe(INVALID);
    expect(bad(cond('p-name', 'contains', 'leak'))).toBe(INVALID);
    expect(bad({ kind: 'group', id: 'g', combinator: 'xor', children: [] })).toBe(INVALID);
    expect(bad({ kind: 'group', id: 'g', combinator: 'and' })).toBe(INVALID);
    expect(bad({ kind: 'group', combinator: 'and', children: [] })).toBe(INVALID);
    expect(bad(allOf(node(null)))).toBe(INVALID);
    expect(bad(allOf(node({ kind: 'note', id: 'n' })))).toBe(INVALID);
    expect(bad(allOf(node({ kind: 'condition', id: 'c', op: 'contains', value: 'x' })))).toBe(
      INVALID,
    );
    expect(
      bad(allOf(node({ kind: 'condition', id: 'c', propertyId: 'p-name', op: 'resembles' }))),
    ).toBe(INVALID);
    expect(bad(allOf(node({ kind: 'condition', propertyId: 'p-name', op: 'is_empty' })))).toBe(
      INVALID,
    );
  });

  it('allows up to 3 layers', () => {
    const leaf = (): FilterCondition => cond('p-name', 'contains', 'a');
    expect(check(anyOf(allOf(leaf())))).toBeNull();
    expect(check(anyOf(allOf(anyOf(leaf()))))).toBe('Filters can have up to 3 layers.');
    expect(check(anyOf(allOf(anyOf())))).toBe('Filters can have up to 3 layers.');
  });

  it('allows up to 50 conditions', () => {
    const many = (n: number): FilterCondition[] =>
      Array.from({ length: n }, () => cond('p-name', 'contains', 'a'));
    expect(check(...many(50))).toBeNull();
    expect(check(...many(25), anyOf(...many(25)))).toBeNull();
    expect(check(...many(25), anyOf(...many(26)))).toBe('Filters can have up to 50 conditions.');
  });

  it('names a deleted property or an operator the property no longer offers', () => {
    expect(check(cond('p-gone', 'contains', 'a'))).toBe(
      'A filter uses a property that was deleted.',
    );
    expect(check(cond('p-paid', 'contains', 'a'))).toBe(
      `"Paid" can't be filtered with "Contains".`,
    );
    expect(check(cond('p-notes', 'gt', '5'))).toBe(
      `"Notes" can't be filtered with "Greater than".`,
    );
    expect(check(cond('p-trade', 'contains_any', ['o-plumb']))).toBe(
      `"Trade" can't be filtered with "Contains any of".`,
    );
    expect(check(cond('p-trade', 'group_is', ['todo']))).toBe(
      `"Trade" can't be filtered with "Group is".`,
    );
    expect(check(cond('p-id', 'is_empty'))).toBe(`"Ticket" can't be filtered with "Is empty".`);
    expect(check(cond('p-owner', 'contains_all', ['u-sam']))).toBe(
      `"Owner" can't be filtered with "Contains all of".`,
    );
    expect(check(cond('p-button', 'is_empty'))).toBe(`"Notify" can't be filtered with "Is empty".`);
  });

  it("says when a value doesn't fit", () => {
    expect(check(cond('p-cost', 'gt', 'lots'))).toBe(misfit('Cost'));
    expect(check(cond('p-cost', 'gt', 5))).toBe(misfit('Cost'));
    expect(check(cond('p-id', 'eq', 'QA-12'))).toBe(misfit('Ticket'));
    expect(check(cond('p-name', 'contains', 'x'.repeat(LIMITS.text)))).toBeNull();
    expect(check(cond('p-name', 'contains', 'x'.repeat(LIMITS.text + 1)))).toBe(misfit('Name'));
    expect(check(cond('p-name', 'contains', ['leak']))).toBe(misfit('Name'));
    expect(check(cond('p-trade', 'is', 'o-plumb'))).toBe(misfit('Trade'));
    expect(check(cond('p-tags', 'contains_any', ['t-urgent', 7]))).toBe(misfit('Tags'));
    expect(check(cond('p-tags', 'contains_any', ['t-urgent', '']))).toBe(misfit('Tags'));
    const links = Array.from({ length: LIMITS.relationLinks + 1 }, (_, i) => `c-${i}`);
    expect(check(cond('p-vendor', 'contains_any', links.slice(1)))).toBeNull();
    expect(check(cond('p-vendor', 'contains_any', links))).toBe(misfit('Vendor'));
    expect(check(cond('p-stage', 'group_is', ['archived']))).toBe(misfit('Stage'));
    expect(check(cond('p-due', 'is', { exact: '2026-02-30' }))).toBe(misfit('Due'));
    expect(check(cond('p-due', 'is', { relative: 'someday' }))).toBe(misfit('Due'));
    expect(check(cond('p-due', 'is', '2026-10-26'))).toBe(misfit('Due'));
    expect(check(cond('p-due', 'between', { start: { relative: 'today' } }))).toBe(misfit('Due'));
    expect(check(cond('p-due', 'within', 'next_8_days'))).toBe(misfit('Due'));
    for (const count of [0, 1001, 1.5, '2']) {
      expect(check(cond('p-due', 'within', { direction: 'past', count, unit: 'day' }))).toBe(
        misfit('Due'),
      );
    }
    expect(check(cond('p-due', 'within', { direction: 'later', count: 2, unit: 'week' }))).toBe(
      misfit('Due'),
    );
    expect(check(cond('p-due', 'within', { direction: 'next', count: 2, unit: 'fortnight' }))).toBe(
      misfit('Due'),
    );
  });

  it('reports the first problem it finds', () => {
    expect(check(cond('p-gone', 'is_empty'), cond('p-cost', 'gt', 'lots'))).toBe(
      'A filter uses a property that was deleted.',
    );
  });
});

describe('pruneFilter', () => {
  it('returns the same filter when everything still fits', () => {
    const f = allOf(
      cond('p-name', 'contains', 'leak'),
      anyOf(),
      cond('p-notes', 'contains', ''),
      anyOf(cond('p-paid', 'is_checked'), cond('p-due', 'within', 'next_7_days')),
      cond('f-broken', 'is', 'waiting for a fix'),
    );
    expect(pruneFilter(f, PROPS)).toBe(f);
    expect(pruneFilter(null, PROPS)).toBeNull();
  });

  it('drops conditions on deleted properties, and groups that leaves empty', () => {
    const keep = cond('p-name', 'contains', 'leak');
    const kept = anyOf(cond('p-paid', 'is_checked'));
    const f = allOf(keep, anyOf(cond('p-gone', 'contains', 'x')), kept, cond('p-gone', 'is_empty'));
    expect(pruneFilter(f, PROPS)).toEqual({ ...f, children: [keep, kept] });
    expect(pruneFilter(allOf(cond('p-gone', 'is_empty')), PROPS)).toBeNull();
    expect(pruneFilter(allOf(anyOf(allOf(cond('p-gone', 'is_empty')))), PROPS)).toBeNull();
  });

  it('drops conditions that no longer fit after a type change', () => {
    // Cost became text and Trade became a date.
    const changed = PROPS.map((p): Property =>
      p.id === 'p-cost'
        ? { ...p, config: { type: 'text' } }
        : p.id === 'p-trade'
          ? { ...p, config: defaultConfig('date') }
          : p,
    );
    const contains = cond('p-cost', 'contains', '12');
    const empty = cond('p-trade', 'is_empty');
    const f = allOf(cond('p-cost', 'gt', '5'), contains, cond('p-trade', 'is', ['o-plumb']), empty);
    expect(pruneFilter(f, changed)).toEqual({ ...f, children: [contains, empty] });
  });

  it("doesn't change the filter it's given", () => {
    const f = allOf(cond('p-gone', 'is_empty'), anyOf(cond('p-name', 'contains', 'a')));
    const before = JSON.stringify(f);
    const after = pruneFilter(f, PROPS);
    expect(JSON.stringify(f)).toBe(before);
    expect(after?.children).toHaveLength(1);
    expect(after?.children[0]).toBe(f.children[1]);
  });
});

describe('countConditions', () => {
  it('counts conditions in nested groups', () => {
    expect(countConditions(null)).toBe(0);
    expect(countConditions(allOf())).toBe(0);
    expect(countConditions(cond('p-name', 'is_empty'))).toBe(1);
    expect(
      countConditions(
        allOf(
          cond('p-name', 'is_empty'),
          anyOf(cond('p-paid', 'is_checked'), allOf(cond('p-cost', 'gt', '1'))),
          anyOf(),
        ),
      ),
    ).toBe(3);
  });
});

describe('filterBarMode', () => {
  it('shows an "All of" filter of plain conditions as chips', () => {
    expect(filterBarMode(allOf(cond('p-name', 'contains', 'leak')))).toBe('chips');
    expect(filterBarMode(allOf(cond('p-trade', 'is', ['o-plumb']), cond('p-due', 'before')))).toBe(
      'chips',
    );
  });

  it('shows "Any of" and nested groups as the "Advanced filter" chip', () => {
    expect(filterBarMode(anyOf(cond('p-name', 'contains', 'leak')))).toBe('advanced');
    expect(
      filterBarMode(anyOf(cond('p-name', 'contains', 'a'), cond('p-paid', 'is_checked'))),
    ).toBe('advanced');
    expect(
      filterBarMode(allOf(cond('p-name', 'contains', 'a'), anyOf(cond('p-paid', 'is_checked')))),
    ).toBe('advanced');
    expect(filterBarMode(allOf(anyOf()))).toBe('advanced');
  });

  it('shows nothing without a filter', () => {
    expect(filterBarMode(null)).toBe('none');
    expect(filterBarMode(allOf())).toBe('none');
    expect(filterBarMode(anyOf())).toBe('none');
  });
});

describe('prefillFromFilter', () => {
  const prefill = (
    f: FilterGroup | null,
    who: Pick<Viewer, 'userId' | 'now' | 'timeZone'> = viewer,
  ): Record<string, unknown> => prefillFromFilter(f, PROPS, who);

  it('fills in values that make a new row match simple conditions', () => {
    expect(
      prefill(
        allOf(
          cond('p-name', 'is', 'Kitchen leak'),
          cond('p-notes', 'contains', 'Call first'),
          cond('p-site', 'is', 'https://bluepine.example'),
          cond('p-email', 'is', 'avery@bluepine.example'),
          cond('p-phone', 'is', '555-0142'),
          cond('p-cost', 'eq', '12.50'),
          cond('p-trade', 'is', ['o-gone', 'o-elec', 'o-plumb']),
          cond('p-stage', 'is', ['s-doing']),
          cond('p-tags', 'contains_any', ['t-urgent', 't-outdoor']),
          cond('p-due', 'is', { relative: 'tomorrow' }),
          cond('p-paid', 'is_checked'),
          cond('p-owner', 'contains_any', ['u-jordan', ME]),
        ),
      ),
    ).toEqual({
      'p-name': 'Kitchen leak',
      'p-notes': fromPlainText('Call first'),
      'p-site': 'https://bluepine.example',
      'p-email': 'avery@bluepine.example',
      'p-phone': '555-0142',
      'p-cost': '12.5',
      'p-trade': 'o-elec',
      'p-stage': 's-doing',
      'p-tags': ['t-urgent'],
      'p-due': { start: '2026-10-27', end: null, hasTime: false },
      'p-paid': true,
      'p-owner': ['u-avery'],
    });
  });

  it('adds up multi-select options and otherwise keeps the first condition on a property', () => {
    expect(
      prefill(
        allOf(
          cond('p-tags', 'contains_all', ['t-urgent', 't-outdoor']),
          cond('p-tags', 'contains_any', ['t-cafe', 't-urgent']),
          cond('p-name', 'is', 'First'),
          cond('p-name', 'contains', 'Second'),
          cond('p-owner', 'contains_any', ['u-avery']),
        ),
      ),
    ).toEqual({
      'p-tags': ['t-urgent', 't-outdoor', 't-cafe'],
      'p-name': 'First',
      'p-owner': ['u-avery'],
    });
  });

  it('skips conditions no single value can promise', () => {
    expect(
      prefill(
        allOf(
          cond('p-name', 'is_not', 'Leak'),
          cond('p-name', 'contains', ''),
          cond('p-notes', 'does_not_contain', 'x'),
          cond('p-site', 'contains', 'bluepine'),
          cond('p-cost', 'gt', '5'),
          cond('p-cost', 'eq', '1e20'),
          cond('p-trade', 'is_not', ['o-plumb']),
          cond('p-trade', 'is', ['o-gone']),
          cond('p-stage', 'group_is', ['complete']),
          cond('p-tags', 'does_not_contain', ['t-urgent']),
          cond('p-due', 'after', { relative: 'today' }),
          cond('p-due', 'within', 'next_7_days'),
          cond('p-paid', 'is_not_checked'),
          cond('p-owner', 'contains_any', ['u-jordan']),
          cond('p-owner', 'does_not_contain', [ME]),
          cond('p-creator', 'contains_any', [ME]),
          cond('p-vendor', 'contains_any', ['c-blue']),
          cond('f-text', 'is', 'Blue Pine'),
          cond('p-gone', 'is', 'x'),
          anyOf(cond('p-email', 'is', 'avery@bluepine.example')),
        ),
      ),
    ).toEqual({});
  });

  it('only uses an "All of" filter, or a filter with one condition', () => {
    expect(prefill(anyOf(cond('p-name', 'is', 'Leak')))).toEqual({ 'p-name': 'Leak' });
    expect(prefill(anyOf(cond('p-name', 'is', 'Leak'), cond('p-paid', 'is_checked')))).toEqual({});
    expect(prefill(null)).toEqual({});
  });

  it("uses the viewer's today for relative dates", () => {
    const now = new Date('2026-10-27T05:30:00.000Z');
    const f = allOf(cond('p-due', 'is', { relative: 'today' }));
    expect(prefill(f, { ...viewer, now })).toEqual({
      'p-due': { start: '2026-10-26', end: null, hasTime: false },
    });
    expect(prefill(f, { ...viewer, now, timeZone: 'Europe/London' })).toEqual({
      'p-due': { start: '2026-10-27', end: null, hasTime: false },
    });
    expect(prefill(allOf(cond('p-due', 'is', { exact: '2026-12-01' })))).toEqual({
      'p-due': { start: '2026-12-01', end: null, hasTime: false },
    });
  });
});
