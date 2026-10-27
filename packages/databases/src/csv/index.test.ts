/** Round trips through the public entry: values as cells show them, and export then import. */
import { describe, expect, it } from 'vitest';
import { formatDateValue } from '../dates';
import { formatDecimal } from '../decimal';
import { plainText } from '../richtext';
import { defaultConfig, newProperty, relationConfig } from '../schema';
import {
  CURRENCIES,
  type ChecklistItem,
  type ConfigOf,
  type DateValue,
  type FileRef,
  type NumberDecimals,
  type NumberFormat,
  type Property,
  type RichText,
  type Row,
} from '../types';
import {
  buildImport,
  exportColumns,
  exportTable,
  matchColumns,
  readCell,
  readCsvFile,
  splitTable,
  validatePlan,
  writeCsv,
  type ColumnPlan,
  type ImportContext,
  type NewPropertyType,
} from './index';

const viewer = { timeZone: 'America/Denver', now: new Date('2026-10-26T18:00:00Z') };
const NAMES: Record<string, string> = { 'u-avery': 'Avery Lin', 'u-jordan': 'Jordan Park' };
const VENDORS: Record<string, string> = {
  'r-llc': 'Blue Pine Plumbing, LLC',
  'r-lp': 'Lin & Park',
};
const ctx: ImportContext = {
  viewer,
  findUser: (text) => Object.keys(NAMES).find((id) => NAMES[id] === text),
  findRows: (db, title) =>
    db === 'db-vendors' ? Object.keys(VENDORS).filter((id) => VENDORS[id] === title) : [],
};

/** The stored value; fails the test when the text can't be read. */
function read(prop: Property, text: string): unknown {
  const r = readCell(prop, text, ctx);
  if (!r.ok) throw new Error(`"${text}" couldn't be read: ${r.reason}`);
  return r.value;
}

/** The plan the import preview starts with. */
function startPlan(table: string[][], properties: readonly Property[]): ColumnPlan[] {
  const sheet = splitTable(table);
  return matchColumns(sheet.headers, properties, sheet.rows);
}

const day = (start: string, end: string | null = null): DateValue => ({
  start,
  end,
  hasTime: false,
});

describe('readCell reads back what cells show', () => {
  const numbers = ['0', '1234.5', '-1234.5', '0.45', '1000000', '0.0001234', '-0.5'];
  const displays: [NumberFormat, NumberDecimals][] = [
    ['number', 'auto'],
    ['number_commas', 'auto'],
    ['percent', 'auto'],
  ];

  it.each(displays)('%s numbers', (format: NumberFormat, decimals: NumberDecimals) => {
    const prop = newProperty('Amount', { ...defaultConfig('number'), format, decimals });
    for (const d of numbers) expect(read(prop, formatDecimal(d, { format, decimals }))).toBe(d);
  });

  it('numbers with fixed decimals', () => {
    const prop = newProperty('Amount', { ...defaultConfig('number'), decimals: 2 as const });
    expect(read(prop, formatDecimal('1234.5', { format: 'number_commas', decimals: 2 }))).toBe(
      '1234.5',
    );
  });

  it.each(CURRENCIES.map((c) => [c]))('%s amounts', (currency: string) => {
    const prop = newProperty('Amount', {
      ...defaultConfig('number'),
      format: 'currency' as const,
      currency,
    });
    for (const d of ['0', '1234', '-1234', '1000000']) {
      const shown = formatDecimal(d, { format: 'currency', currency, decimals: 'auto' });
      expect(read(prop, shown)).toBe(d);
    }
  });

  it('amounts with cents', () => {
    const plain = newProperty('Amount', defaultConfig('number'));
    for (const currency of ['USD', 'EUR', 'GBP', 'CAD', 'CHF', 'BRL', 'INR']) {
      for (const d of ['1234.5', '-0.05', '12.34']) {
        const shown = formatDecimal(d, { format: 'currency', currency, decimals: 'auto' });
        expect(read(plain, shown)).toBe(d);
      }
    }
  });

  const dates: DateValue[] = [
    day('2026-10-26'),
    day('2026-02-01', '2026-02-03'),
    { start: '2026-10-26T21:30:00.000Z', end: null, hasTime: true },
    { start: '2026-10-26T21:30:00.000Z', end: '2026-10-26T22:00:00.000Z', hasTime: true },
    { start: '2026-10-26T21:30:00.000Z', end: '2026-10-28T15:00:00.000Z', hasTime: true },
    { start: '2026-11-02T16:00:00.000Z', end: null, hasTime: true },
  ];

  it.each(['full', 'mdy', 'dmy', 'ymd', 'relative'] as const)('%s dates', (format) => {
    const prop = newProperty('Due', { ...defaultConfig('date'), format });
    for (const hour12 of [true, false]) {
      for (const v of dates) {
        const shown = formatDateValue(v, { format, viewer: { ...viewer, hour12 } });
        expect(read(prop, shown)).toEqual(v);
      }
    }
  });
});

describe('export, then import', () => {
  const exportViewer = { ...viewer, hour12: true };
  const name = newProperty('Name', defaultConfig('title'));
  const notes = newProperty('Notes', defaultConfig('text'));
  const amount = newProperty('Amount', { ...defaultConfig('number'), format: 'currency' as const });
  const share = newProperty('Share', { ...defaultConfig('number'), format: 'percent' as const });
  const priorityConfig: ConfigOf<'select'> = {
    type: 'select',
    options: [
      { id: 'o-high', name: 'High', color: 'red' },
      { id: 'o-low', name: 'Low', color: 'gray' },
    ],
  };
  const priority = newProperty('Priority', priorityConfig);
  const tagsConfig: ConfigOf<'multi_select'> = {
    type: 'multi_select',
    options: [
      { id: 'o-billing', name: 'Billing', color: 'blue' },
      { id: 'o-urgent', name: 'Urgent', color: 'red' },
    ],
  };
  const tags = newProperty('Tags', tagsConfig);
  const status = newProperty('Status', defaultConfig('status'));
  const due = newProperty('Due', defaultConfig('date'));
  const done = newProperty('Done', defaultConfig('checkbox'));
  const site = newProperty('Website', defaultConfig('url'));
  const email = newProperty('Email', defaultConfig('email'));
  const phone = newProperty('Phone', defaultConfig('phone'));
  const owner = newProperty('Owner', defaultConfig('person'));
  const vendor = newProperty('Vendor', relationConfig('db-vendors'));
  const steps = newProperty('Steps', defaultConfig('checklist'));
  const files = newProperty('Files', defaultConfig('files'));
  const created = newProperty('Created', defaultConfig('created_time'));
  const uid = newProperty('ID', { type: 'unique_id' as const, prefix: 'SL' });
  const button = newProperty('Send reminder', defaultConfig('button'));
  const properties: Property[] = [
    name,
    notes,
    amount,
    share,
    priority,
    tags,
    status,
    due,
    done,
    site,
    email,
    phone,
    owner,
    vendor,
    steps,
    files,
    created,
    uid,
    button,
  ];
  const [notStarted, inProgress, complete] = status.config.options;

  const row = (n: number, title: string, values: Row['values']): Row => ({
    id: `r${n}`,
    title,
    values,
    createdAt: '2026-10-26T15:00:00.000Z',
    createdBy: 'u-avery',
    editedAt: '2026-10-26T15:00:00.000Z',
    editedBy: 'u-avery',
    uniqueNumber: n,
  });
  const due1: DateValue = { start: '2026-10-26T21:30:00.000Z', end: null, hasTime: true };
  const due2: DateValue = { start: '2026-10-26', end: '2026-10-28', hasTime: false };
  const rows: Row[] = [
    row(1, 'Avery Lin', {
      [notes.id]: [{ text: 'Called, left message' }],
      [amount.id]: '-1234.5',
      [share.id]: '0.45',
      [priority.id]: 'o-high',
      [tags.id]: ['o-billing', 'o-urgent'],
      [status.id]: complete?.id,
      [due.id]: due1,
      [done.id]: true,
      [site.id]: 'https://example.com/a?b=1',
      [email.id]: 'avery@example.com',
      [phone.id]: '+1 (555) 010-2030',
      [owner.id]: ['u-avery', 'u-jordan'],
      [vendor.id]: ['r-llc', 'r-lp'],
      [steps.id]: [
        { id: 'c1', text: 'Call Avery', done: true },
        { id: 'c2', text: 'Email Jordan', done: false },
      ],
      [files.id]: [{ id: 'f1', name: 'report.pdf', size: 1200, mime: 'application/pdf' }],
    }),
    row(2, '=Jordan Park', {
      [notes.id]: [{ text: 'Line 1\nLine 2' }],
      [amount.id]: '12',
      [status.id]: notStarted?.id,
      [due.id]: due2,
      [done.id]: false,
    }),
    row(3, 'Blue Pine Plumbing', {
      [amount.id]: '0',
      [priority.id]: 'o-high',
      [status.id]: inProgress?.id,
      [done.id]: false,
    }),
  ];

  const list = (v: unknown, label: (id: string) => string | undefined): string =>
    Array.isArray(v) ? v.map((id) => label(String(id)) ?? '').join(', ') : '';

  /** What an export writes for a cell (a stand-in for values.ts formatValue with forExport). */
  function cellText(r: Row, prop: Property): string {
    const v = r.values[prop.id];
    const c = prop.config;
    switch (c.type) {
      case 'title':
        return r.title;
      case 'text':
        return plainText(v as RichText | undefined);
      case 'number':
        return typeof v === 'string' ? formatDecimal(v, c) : '';
      case 'select':
      case 'status':
        return c.options.find((o) => o.id === v)?.name ?? '';
      case 'multi_select':
        return list(v, (id) => c.options.find((o) => o.id === id)?.name);
      case 'date':
        return v ? formatDateValue(v as DateValue, { ...c, viewer: exportViewer }) : '';
      case 'checkbox':
        return v === true ? 'Yes' : 'No';
      case 'url':
      case 'email':
      case 'phone':
        return typeof v === 'string' ? v : '';
      case 'person':
        return list(v, (id) => NAMES[id]);
      case 'relation':
        return list(v, (id) => VENDORS[id]);
      case 'checklist':
        return ((v ?? []) as ChecklistItem[])
          .map((i) => `[${i.done ? 'x' : ' '}] ${i.text}`)
          .join('; ');
      case 'files':
        return ((v ?? []) as FileRef[]).map((f) => f.name).join(', ');
      case 'created_time':
        return formatDateValue(
          { start: r.createdAt, end: null, hasTime: true },
          { ...c, viewer: exportViewer },
        );
      case 'unique_id':
        return `${c.prefix ? `${c.prefix}-` : ''}${r.uniqueNumber ?? ''}`;
      default:
        return '';
    }
  }

  /** Export Everything, then read the file as the import does. */
  function exportedTable(): string[][] {
    const table = exportTable(exportColumns(properties, null), rows, cellText);
    const file = readCsvFile(new TextEncoder().encode(writeCsv(table)));
    if (!file.ok) throw new Error(file.error);
    return file.table;
  }

  /** Values without checklist item ids (an import makes new ones). */
  const withoutItemIds = (values: Partial<Record<string, unknown>>) =>
    Object.fromEntries(
      Object.entries(values).map(([k, v]) => [
        k,
        Array.isArray(v) && k === steps.id
          ? v.map((i: ChecklistItem) => ({ text: i.text, done: i.done }))
          : v,
      ]),
    );

  it('writes every property but buttons, Name first, as cells show them', () => {
    const [headers, first, second] = exportedTable();
    expect(headers).toEqual([
      'Name',
      'Notes',
      'Amount',
      'Share',
      'Priority',
      'Tags',
      'Status',
      'Due',
      'Done',
      'Website',
      'Email',
      'Phone',
      'Owner',
      'Vendor',
      'Steps',
      'Files',
      'Created',
      'ID',
    ]);
    expect(first).toEqual([
      'Avery Lin',
      'Called, left message',
      '-$1,234.50',
      '45%',
      'High',
      'Billing, Urgent',
      'Done',
      'Oct 26, 2026 3:30 PM',
      'Yes',
      'https://example.com/a?b=1',
      'avery@example.com',
      "'+1 (555) 010-2030",
      'Avery Lin, Jordan Park',
      'Blue Pine Plumbing, LLC, Lin & Park',
      '[x] Call Avery; [ ] Email Jordan',
      'report.pdf',
      'Oct 26, 2026 9:00 AM',
      'SL-1',
    ]);
    expect(second?.slice(0, 3)).toEqual(["'=Jordan Park", 'Line 1\nLine 2', '$12.00']);
  });

  it('reads the same values back into the same database', () => {
    const table = exportedTable();
    const plan = startPlan(table, properties);
    expect(validatePlan(plan, properties)).toBeNull();
    expect(plan.filter((c) => c.target.kind === 'skip').map((c) => c.header)).toEqual([
      'Files',
      'Created',
      'ID',
    ]);
    const result = buildImport(table, plan, properties, ctx);
    expect(result.problems).toEqual([]);
    expect(result.newProperties).toEqual([]);
    expect(result.newOptions).toEqual({});
    expect(result.rows.map((r) => r.rowNumber)).toEqual([2, 3, 4]);
    expect(result.rows.map((r) => ({ title: r.title, values: withoutItemIds(r.values) }))).toEqual(
      rows.map((r) => {
        const values = Object.fromEntries(Object.entries(r.values).filter(([k]) => k !== files.id));
        return { title: r.title, values: withoutItemIds(values) };
      }),
    );
  });

  it('guesses types for a new database and reads the same values', () => {
    const fresh = [newProperty('Name', defaultConfig('title'))];
    const table = exportedTable();
    const plan = startPlan(table, fresh);
    expect(
      plan.map((c) =>
        c.target.kind === 'new' ? `${c.target.name}: ${c.target.type}` : c.target.kind,
      ),
    ).toEqual([
      'existing',
      'Notes: text',
      'Amount: number',
      'Share: number',
      'Priority: select',
      'Tags: text',
      'Status: text',
      'Due: date',
      'Done: checkbox',
      'Website: url',
      'Email: email',
      'Phone: text',
      'Owner: text',
      'Vendor: text',
      'Steps: text',
      'Files: text',
      'Created: date',
      'ID: text',
    ]);
    const result = buildImport(table, plan, fresh, ctx);
    expect(result.problems).toEqual([]);
    const made = new Map(result.newProperties.map((p) => [p.name, p]));
    const column = (prop: string) => result.rows.map((r) => r.values[made.get(prop)?.id ?? '']);
    expect(made.get('Amount')?.config).toMatchObject({ format: 'currency', currency: 'USD' });
    expect(made.get('Share')?.config).toMatchObject({ format: 'percent' });
    expect(made.get('Due')?.config).toMatchObject({ format: 'full' });
    expect(result.rows.map((r) => r.title)).toEqual([
      'Avery Lin',
      '=Jordan Park',
      'Blue Pine Plumbing',
    ]);
    expect(column('Amount')).toEqual(['-1234.5', '12', '0']);
    expect(column('Share')).toEqual(['0.45', undefined, undefined]);
    expect(column('Due')).toEqual([due1, due2, undefined]);
    expect(column('Done')).toEqual([true, false, false]);
    expect(column('Website')).toEqual(['https://example.com/a?b=1', undefined, undefined]);
    expect(column('Email')).toEqual(['avery@example.com', undefined, undefined]);
    expect(column('Notes')).toEqual([
      [{ text: 'Called, left message' }],
      [{ text: 'Line 1\nLine 2' }],
      undefined,
    ]);
    expect(column('Phone')).toEqual([[{ text: '+1 (555) 010-2030' }], undefined, undefined]);
    const options = made.get('Priority')?.config;
    expect(options).toMatchObject({ type: 'select', options: [{ name: 'High' }] });
    expect(column('Priority')).toEqual([
      options?.type === 'select' ? options.options[0]?.id : 'missing',
      undefined,
      options?.type === 'select' ? options.options[0]?.id : 'missing',
    ]);
  });

  it('reads lists, people and checklists when the preview picks those types', () => {
    const fresh = [newProperty('Name', defaultConfig('title'))];
    const table = exportedTable();
    const picked: Record<string, NewPropertyType> = {
      Tags: 'multi_select',
      Status: 'status',
      Phone: 'phone',
      Owner: 'person',
      Steps: 'checklist',
    };
    const plan = startPlan(table, fresh).map((c): ColumnPlan => {
      const type = picked[c.header];
      return type && c.target.kind === 'new' ? { ...c, target: { ...c.target, type } } : c;
    });
    expect(validatePlan(plan, fresh)).toBeNull();
    const result = buildImport(table, plan, fresh, ctx);
    expect(result.problems).toEqual([]);
    const made = new Map(result.newProperties.map((p) => [p.name, p]));
    const column = (prop: string) => result.rows.map((r) => r.values[made.get(prop)?.id ?? '']);
    const optionIds = (prop: string) => {
      const c = made.get(prop)?.config;
      return c?.type === 'multi_select' || c?.type === 'status' ? c.options.map((o) => o.id) : [];
    };
    expect(made.get('Tags')?.config).toMatchObject({
      options: [{ name: 'Billing' }, { name: 'Urgent' }],
    });
    expect(column('Tags')).toEqual([optionIds('Tags'), undefined, undefined]);
    // Status keeps its three default options, which the exported names match.
    expect(optionIds('Status')).toHaveLength(3);
    expect(column('Status')).toEqual([
      optionIds('Status')[2],
      optionIds('Status')[0],
      optionIds('Status')[1],
    ]);
    expect(column('Phone')).toEqual(['+1 (555) 010-2030', undefined, undefined]);
    expect(column('Owner')).toEqual([['u-avery', 'u-jordan'], undefined, undefined]);
    expect(column('Steps')[0]).toMatchObject([
      { text: 'Call Avery', done: true },
      { text: 'Email Jordan', done: false },
    ]);
  });
});
