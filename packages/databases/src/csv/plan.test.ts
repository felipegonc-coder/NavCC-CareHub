import { describe, expect, it } from 'vitest';
import { defaultConfig, newProperty, relationConfig } from '../schema';
import type { Property } from '../types';
import {
  canImportInto,
  columnValues,
  dateOrder,
  guessType,
  matchColumns,
  NEW_PROPERTY_TYPES,
  splitTable,
  validatePlan,
  type ColumnPlan,
  type ColumnTarget,
  type NewPropertyType,
} from './plan';

const name = newProperty('Name', defaultConfig('title'));
const status = newProperty('Status', defaultConfig('status'));
const due = newProperty('Due date', defaultConfig('date'));
const notes = newProperty('Notes', defaultConfig('text'));
const files = newProperty('Files', defaultConfig('files'));
const created = newProperty('Created', defaultConfig('created_time'));
const uid = newProperty('ID', defaultConfig('unique_id'));
const properties: Property[] = [name, status, due, notes, files, created, uid];

const existing = (p: Property): ColumnTarget => ({ kind: 'existing', propertyId: p.id });
const added = (newName: string, type: NewPropertyType): ColumnTarget => ({
  kind: 'new',
  name: newName,
  type,
});
const skip: ColumnTarget = { kind: 'skip' };

describe('splitTable', () => {
  it('takes trimmed column names from the first row, one per column of the widest row', () => {
    expect(
      splitTable([
        [' Name ', 'Status'],
        ['Avery Lin', 'Open', 'extra'],
      ]),
    ).toEqual({
      headers: ['Name', 'Status', ''],
      rows: [['Avery Lin', 'Open', 'extra']],
      firstRowNumber: 2,
    });
  });

  it('keeps every row as data when the first row is not headers', () => {
    expect(splitTable([['Avery Lin', 'Open']], false)).toEqual({
      headers: ['', ''],
      rows: [['Avery Lin', 'Open']],
      firstRowNumber: 1,
    });
  });

  it('splits an empty table', () => {
    expect(splitTable([])).toEqual({ headers: [], rows: [], firstRowNumber: 2 });
  });
});

describe('columnValues', () => {
  it('gives "" where a row is short', () => {
    expect(columnValues([['a', 'b'], ['c']], 1)).toEqual(['b', '']);
  });
});

describe('canImportInto', () => {
  it.each([
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
    'checklist',
  ] as const)('fills %s properties', (type) => {
    expect(canImportInto(newProperty('P', defaultConfig(type)))).toBe(true);
  });

  it('fills relations', () => {
    expect(canImportInto(newProperty('Vendor', relationConfig('db-vendors')))).toBe(true);
  });

  it.each([
    'files',
    'created_time',
    'edited_time',
    'created_by',
    'edited_by',
    'formula',
    'unique_id',
    'button',
  ] as const)("doesn't fill %s properties", (type) => {
    expect(canImportInto(newProperty('P', defaultConfig(type)))).toBe(false);
  });
});

describe('dateOrder', () => {
  it('tells month first from day first', () => {
    expect(dateOrder(['10/26/2026', '01/02/2026'])).toBe('month_first');
    expect(dateOrder(['26/10/2026', '01/02/2026'])).toBe('day_first');
    expect(dateOrder(['Oct 26, 2026', '2026-10-27'])).toBe('month_first');
  });

  it('gives null when the values are not all dates either way', () => {
    expect(dateOrder(['10/26/2026', '26/10/2026'])).toBeNull();
    expect(dateOrder(['soon'])).toBeNull();
  });
});

describe('guessType', () => {
  it.each([
    [['12', '$1,234.50', '45%', ''], 'number'],
    [['1', '0', '1'], 'number'],
    [['Oct 26, 2026', '2026-10-27', '10/28/2026 3:30 PM'], 'date'],
    [['26/10/2026', '27/10/2026'], 'date'],
    [['yes', 'No', 'x', '\u2713'], 'checkbox'],
    [['https://example.com', 'www.example.org/a'], 'url'],
    [['example.com'], 'text'],
    [['avery@example.com', 'mailto:jordan@example.com'], 'email'],
    [['Open', 'Done', 'open'], 'select'],
    [['Open', 'Done'], 'text'],
    [['High, urgent', 'High, urgent'], 'text'],
    [['12', 'twelve'], 'text'],
    [['', '  '], 'text'],
    [[], 'text'],
  ])('guesses %j as %s', (values: string[], type: string) => {
    expect(guessType(values)).toBe(type);
  });

  it('guesses Select for up to 50 different values that repeat', () => {
    const values = (n: number) => Array.from({ length: n * 2 }, (_, i) => `Option ${i % n}`);
    expect(guessType(values(50))).toBe('select');
    expect(guessType(values(51))).toBe('text');
  });

  it("doesn't guess Select for values too long to be option names", () => {
    expect(guessType(['a'.repeat(101), 'a'.repeat(101)])).toBe('text');
    expect(guessType(['a'.repeat(100), 'a'.repeat(100)])).toBe('select');
  });
});

describe('matchColumns', () => {
  it('fills properties with the same name, ignoring case and spaces', () => {
    expect(matchColumns(['Name', 'STATUS', 'duedate', ' notes '], properties)).toEqual([
      { index: 0, header: 'Name', target: existing(name) },
      { index: 1, header: 'STATUS', target: existing(status) },
      { index: 2, header: 'duedate', target: existing(due) },
      { index: 3, header: 'notes', target: existing(notes) },
    ]);
  });

  it('gives Name the first column when no column is named like it', () => {
    expect(matchColumns(['Client', 'Status'], properties)).toEqual([
      { index: 0, header: 'Client', target: existing(name) },
      { index: 1, header: 'Status', target: existing(status) },
    ]);
  });

  it('gives Name the column named like it, wherever it is', () => {
    expect(matchColumns(['Status', ' name '], properties)).toEqual([
      { index: 0, header: 'Status', target: existing(status) },
      { index: 1, header: 'name', target: existing(name) },
    ]);
  });

  it('skips columns for Files, created and edited properties and ID', () => {
    expect(matchColumns(['Name', 'Files', 'Created', 'ID'], properties)).toEqual([
      { index: 0, header: 'Name', target: existing(name) },
      { index: 1, header: 'Files', target: skip },
      { index: 2, header: 'Created', target: skip },
      { index: 3, header: 'ID', target: skip },
    ]);
  });

  it('makes other columns new properties, with unique names and guessed types', () => {
    const headers = ['Name', 'Amount', 'Notes', 'Notes', 'Priority', 'priority', 'name'];
    const rows = [
      ['Avery Lin', '$12', 'a', 'b', 'High', 'High', 'x'],
      ['Jordan Park', '-$5', 'c', 'd', 'Low', 'High', 'y'],
      ['Blue Pine Plumbing', '', 'e', 'f', 'High', 'Low', 'z'],
    ];
    expect(matchColumns(headers, properties, rows)).toEqual([
      { index: 0, header: 'Name', target: existing(name) },
      { index: 1, header: 'Amount', target: added('Amount', 'number') },
      { index: 2, header: 'Notes', target: existing(notes) },
      { index: 3, header: 'Notes', target: added('Notes 2', 'text') },
      { index: 4, header: 'Priority', target: added('Priority', 'select') },
      { index: 5, header: 'priority', target: added('priority 2', 'select') },
      { index: 6, header: 'name', target: added('name 2', 'text') },
    ]);
  });

  it('names columns without a header and skips those without values too', () => {
    const rows = [
      ['Avery Lin', 'x', ''],
      ['Jordan Park', 'y', '  '],
    ];
    expect(matchColumns(['Name', '', ''], properties, rows)).toEqual([
      { index: 0, header: 'Name', target: existing(name) },
      { index: 1, header: 'Column 2', target: added('Column 2', 'text') },
      { index: 2, header: 'Column 3', target: skip },
    ]);
  });

  it('collapses spaces in headers and cuts new names to 100 characters', () => {
    const long = 'a'.repeat(120);
    expect(matchColumns(['Name', 'Follow   up', long, long], properties)).toEqual([
      { index: 0, header: 'Name', target: existing(name) },
      { index: 1, header: 'Follow up', target: added('Follow up', 'text') },
      { index: 2, header: long, target: added('a'.repeat(100), 'text') },
      { index: 3, header: long, target: added(`${'a'.repeat(98)} 2`, 'text') },
    ]);
  });

  it('skips new columns when properties cannot be added (Lock structure)', () => {
    expect(
      matchColumns(['Name', 'Amount'], properties, [['Avery Lin', '1']], {
        canAddProperties: false,
      }),
    ).toEqual([
      { index: 0, header: 'Name', target: existing(name) },
      { index: 1, header: 'Amount', target: skip },
    ]);
  });

  it('matches a file without a header row by position', () => {
    const sheet = splitTable([['Avery Lin', '12']], false);
    expect(matchColumns(sheet.headers, properties, sheet.rows)).toEqual([
      { index: 0, header: 'Column 1', target: existing(name) },
      { index: 1, header: 'Column 2', target: added('Column 2', 'number') },
    ]);
  });
});

describe('validatePlan', () => {
  const plan = (...targets: ColumnTarget[]): ColumnPlan[] =>
    targets.map((target, index) => ({ index, header: `Column ${index + 1}`, target }));

  it('accepts the plan matchColumns makes', () => {
    const headers = ['Name', 'Status', 'Amount', 'Files'];
    expect(
      validatePlan(matchColumns(headers, properties, [['a', 'b', '1', 'c']]), properties),
    ).toBeNull();
  });

  it('accepts skipped columns and every type a new property can have', () => {
    const targets = NEW_PROPERTY_TYPES.map((type) => added(`New ${type}`, type));
    expect(validatePlan(plan(existing(name), skip, skip, ...targets), properties)).toBeNull();
  });

  it('refuses a property that was deleted', () => {
    expect(validatePlan(plan({ kind: 'existing', propertyId: 'deleted' }), properties)).toBe(
      'The property chosen for "Column 1" was deleted.',
    );
  });

  it("refuses a property that can't be filled", () => {
    expect(validatePlan(plan(existing(created)), properties)).toBe(
      `"Created" can't be filled from a CSV file.`,
    );
  });

  it('refuses two columns for one property', () => {
    expect(validatePlan(plan(existing(status), existing(status)), properties)).toBe(
      'Only one column can fill "Status".',
    );
  });

  it('checks the names of new properties', () => {
    expect(validatePlan(plan(added('  ', 'text')), properties)).toBe(
      'Enter a name for each new property.',
    );
    expect(validatePlan(plan(added('a'.repeat(101), 'text')), properties)).toBe(
      'Property names can be up to 100 characters.',
    );
    expect(validatePlan(plan(added('due DATE', 'text')), properties)).toBe(
      'A property named "due DATE" already exists.',
    );
    expect(validatePlan(plan(added('Score', 'number'), added('score', 'text')), properties)).toBe(
      'A property named "score" already exists.',
    );
  });

  it('refuses types a new property from a CSV file cannot have', () => {
    const type = 'relation' as string as NewPropertyType;
    expect(validatePlan(plan(added('Vendor', type)), properties)).toBe(
      `"Vendor" can't be made from a CSV file.`,
    );
  });

  it('allows up to 200 properties', () => {
    const many: Property[] = [
      name,
      ...Array.from({ length: 198 }, (_, i) => newProperty(`P${i}`, defaultConfig('text'))),
    ];
    expect(validatePlan(plan(added('A', 'text')), many)).toBeNull();
    expect(validatePlan(plan(added('A', 'text'), added('B', 'text')), many)).toBe(
      'A database can have up to 200 properties.',
    );
  });
});
