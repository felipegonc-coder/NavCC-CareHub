import { describe, expect, it } from 'vitest';
import { fromPlainText } from './richtext';
import { defaultConfig } from './schema';
import { matchesSearch, rowSearchText, searchWords, textHasWords } from './search';
import type {
  ComputedValue,
  EvalContext,
  Property,
  PropertyConfig,
  Row,
  SelectOption,
  Viewer,
} from './types';

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

const name = prop('p-name', 'Name', { type: 'title' });
const notes = prop('p-notes', 'Notes', { type: 'text' });
const site = prop('p-site', 'Website', { type: 'url' });
const email = prop('p-email', 'Email', { type: 'email' });
const phone = prop('p-phone', 'Phone', { type: 'phone' });
const trade = prop('p-trade', 'Trade', {
  type: 'select',
  options: [opt('o-plumb', 'Plumbing'), opt('o-elec', 'Electrical')],
});
const stage = prop('p-stage', 'Stage', {
  type: 'status',
  defaultOptionId: 's-new',
  options: [
    { ...opt('s-new', 'Not started'), group: 'todo' },
    { ...opt('s-doing', 'In progress'), group: 'in_progress' },
  ],
});
const tags = prop('p-tags', 'Tags', {
  type: 'multi_select',
  options: [opt('t-urgent', 'Urgent'), opt('t-cafe', 'Café')],
});
const owner = prop('p-owner', 'Owner', defaultConfig('person'));
const creator = prop('p-creator', 'Created by', { type: 'created_by' });
const editor = prop('p-editor', 'Edited by', { type: 'edited_by' });
const ticket = prop('p-id', 'Ticket', { type: 'unique_id', prefix: 'QA' });
const cost = prop('p-cost', 'Cost', defaultConfig('number'));
const due = prop('p-due', 'Due', defaultConfig('date'));
const vendor = prop('p-vendor', 'Vendor', {
  type: 'relation',
  targetDatabaseId: 'db-vendors',
  single: false,
  twoWayPropertyId: null,
});
const label = prop('f-text', 'Label', {
  type: 'formula',
  expression: 'prop("p-name")',
  resultKind: 'text',
  number: null,
});
const PROPS: Property[] = [
  name,
  notes,
  site,
  email,
  phone,
  trade,
  stage,
  tags,
  owner,
  creator,
  editor,
  ticket,
  cost,
  due,
  vendor,
  label,
];

const people: Record<string, string> = {
  'u-avery': 'Avery Lin',
  'u-jordan': 'Jordan Park',
  'u-sam': 'Sam Rivera',
};
const context = (properties: readonly Property[]): EvalContext => ({
  properties,
  viewer,
  userName: (id) => people[id],
  rowTitle: (id) => (id === 'c-cedar' ? 'Cedar Electric' : undefined),
  computed: (r, id) => (r.values[id] as ComputedValue | undefined) ?? { kind: 'empty' },
});
const ctx = context(PROPS);

const row = (values: Row['values'] = {}, extra: Partial<Row> = {}): Row => ({
  id: 'row-1',
  title: 'Fix kitchen leak',
  values,
  createdAt: '2026-10-20T15:00:00.000Z',
  createdBy: 'u-avery',
  editedAt: '2026-10-26T17:00:00.000Z',
  editedBy: 'u-jordan',
  uniqueNumber: 12,
  ...extra,
});
const job = row({
  'p-notes': fromPlainText('Use the Café entrance'),
  'p-site': 'https://bluepine.example',
  'p-email': 'office@bluepine.example',
  'p-phone': '555-0142',
  'p-trade': 'o-plumb',
  'p-stage': 's-doing',
  'p-tags': ['t-urgent', 't-gone'],
  'p-owner': ['u-sam', 'u-unknown'],
  'p-cost': '4200',
  'p-due': { start: '2026-10-30', end: null, hasTime: false },
  'p-vendor': ['c-cedar'],
  'f-text': { kind: 'text', value: 'Overdue soon' },
});

describe('rowSearchText', () => {
  it('collects the title, text values, option names, names and the ID, folded', () => {
    expect(rowSearchText(job, ctx)).toBe(
      [
        'fix kitchen leak',
        'use the cafe entrance',
        'https://bluepine.example',
        'office@bluepine.example',
        '555-0142',
        'plumbing',
        'in progress',
        'urgent',
        'sam rivera',
        'avery lin',
        'jordan park',
        'qa-12',
      ].join('\n'),
    );
  });

  it('leaves out properties that are missing from the context, but never the title', () => {
    expect(rowSearchText(job, context([name, ticket]))).toBe('fix kitchen leak\nqa-12');
    expect(rowSearchText(job, context([]))).toBe('fix kitchen leak');
  });

  it('shows an ID without a prefix as its number, and nothing before it has one', () => {
    const plain = prop('p-id', 'Ticket', { type: 'unique_id', prefix: null });
    expect(rowSearchText(row({}, { title: '' }), context([plain]))).toBe('12');
    expect(rowSearchText(row({}, { title: '', uniqueNumber: null }), context([ticket]))).toBe('');
  });

  it('names an anonymous form response "Anonymous"', () => {
    const anonymous = row({}, { title: '', createdBy: null, editedBy: null });
    expect(rowSearchText(anonymous, context([creator, owner]))).toBe('anonymous');
    expect(rowSearchText(row({}, { title: '' }), context([owner]))).toBe('');
  });
});

describe('matchesSearch', () => {
  it('ignores case and accents ("cafe" finds "Café")', () => {
    expect(matchesSearch(job, 'cafe', ctx)).toBe(true);
    expect(matchesSearch(job, 'CAFÉ', ctx)).toBe(true);
    expect(matchesSearch(row({}, { title: 'Cafe visit' }), 'café', ctx)).toBe(true);
    expect(matchesSearch(job, 'KITCHEN', ctx)).toBe(true);
  });

  it('finds rows by title, text, option name and person name (DB-23)', () => {
    expect(matchesSearch(job, 'leak', ctx)).toBe(true);
    expect(matchesSearch(job, 'entrance', ctx)).toBe(true);
    expect(matchesSearch(job, 'plumbing', ctx)).toBe(true);
    expect(matchesSearch(job, 'progress', ctx)).toBe(true);
    expect(matchesSearch(job, 'urgent', ctx)).toBe(true);
    expect(matchesSearch(job, 'Sam Rivera', ctx)).toBe(true);
    expect(matchesSearch(job, 'jordan', ctx)).toBe(true);
    expect(matchesSearch(job, 'avery', ctx)).toBe(true);
  });

  it('finds link, email and phone values', () => {
    expect(matchesSearch(job, 'bluepine.example', ctx)).toBe(true);
    expect(matchesSearch(job, 'office@', ctx)).toBe(true);
    expect(matchesSearch(job, '555-0142', ctx)).toBe(true);
  });

  it('finds a row by its ID with or without the prefix ("QA-12" and "12")', () => {
    expect(matchesSearch(job, 'QA-12', ctx)).toBe(true);
    expect(matchesSearch(job, 'qa-12', ctx)).toBe(true);
    expect(matchesSearch(job, '12', ctx)).toBe(true);
    expect(matchesSearch(job, 'QA-5', ctx)).toBe(false);
  });

  it('needs every word, in any value', () => {
    expect(matchesSearch(job, 'kitchen sam', ctx)).toBe(true);
    expect(matchesSearch(job, '  leak   urgent ', ctx)).toBe(true);
    expect(matchesSearch(job, 'kitchen cedar', ctx)).toBe(false);
  });

  it("doesn't search numbers, dates, relations or formula results", () => {
    expect(matchesSearch(job, '4200', ctx)).toBe(false);
    expect(matchesSearch(job, '2026-10-30', ctx)).toBe(false);
    expect(matchesSearch(job, 'cedar', ctx)).toBe(false);
    expect(matchesSearch(job, 'overdue', ctx)).toBe(false);
  });

  it("doesn't find option or people ids, or names it doesn't know", () => {
    expect(matchesSearch(job, 'o-plumb', ctx)).toBe(false);
    expect(matchesSearch(job, 't-gone', ctx)).toBe(false);
    expect(matchesSearch(job, 'u-unknown', ctx)).toBe(false);
  });

  it("doesn't search properties the viewer can't see", () => {
    const hidden = context(PROPS.filter((p) => p.id !== 'p-notes' && p.id !== 'p-owner'));
    expect(matchesSearch(job, 'entrance', hidden)).toBe(false);
    expect(matchesSearch(job, 'sam', hidden)).toBe(false);
    expect(matchesSearch(job, 'leak', hidden)).toBe(true);
  });

  it('matches every row for a blank query', () => {
    expect(matchesSearch(job, '', ctx)).toBe(true);
    expect(matchesSearch(job, '   ', ctx)).toBe(true);
    expect(matchesSearch(row({}, { title: '' }), '', context([]))).toBe(true);
  });
});

describe('searchWords and textHasWords', () => {
  it('splits a query into folded words', () => {
    expect(searchWords('  Café   VISIT\tnow ')).toEqual(['cafe', 'visit', 'now']);
    expect(searchWords('QA-12')).toEqual(['qa-12']);
    expect(searchWords('   ')).toEqual([]);
  });

  it('checks prepared search text for every word', () => {
    const text = rowSearchText(job, ctx);
    expect(textHasWords(text, searchWords('leak Plumbing'))).toBe(true);
    expect(textHasWords(text, ['sink'])).toBe(false);
    expect(textHasWords(text, [])).toBe(true);
  });
});
