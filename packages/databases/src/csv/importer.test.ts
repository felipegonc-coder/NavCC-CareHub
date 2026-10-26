import { describe, expect, it } from 'vitest';
import { defaultConfig, newProperty } from '../schema';
import type { Property } from '../types';
import {
  buildImport,
  importSummary,
  MAX_LISTED_PROBLEMS,
  problemsCsv,
  type ImportProblem,
} from './importer';
import { matchColumns, splitTable, type ColumnPlan, type NewPropertyType } from './plan';
import type { ImportContext } from './read';

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

/** The plan the import preview starts with. */
function startPlan(table: string[][], properties: readonly Property[]): ColumnPlan[] {
  const sheet = splitTable(table);
  return matchColumns(sheet.headers, properties, sheet.rows);
}

describe('buildImport', () => {
  const name = newProperty('Name', defaultConfig('title'));
  const status = newProperty('Status', defaultConfig('status'));
  const amount = newProperty('Amount', defaultConfig('number'));
  const properties = [name, status, amount];
  const [notStarted, , complete] = status.config.options;

  it('reads every cell into the property its column fills', () => {
    const table = [
      ['Name', 'Status', 'Amount'],
      ['Avery Lin', 'Done', '$12.50'],
      ['Jordan Park', 'not started', '-3'],
    ];
    expect(buildImport(table, startPlan(table, properties), properties, ctx)).toEqual({
      rows: [
        {
          rowNumber: 2,
          title: 'Avery Lin',
          values: { [status.id]: complete?.id, [amount.id]: '12.5' },
        },
        {
          rowNumber: 3,
          title: 'Jordan Park',
          values: { [status.id]: notStarted?.id, [amount.id]: '-3' },
        },
      ],
      newProperties: [],
      newOptions: {},
      problems: [],
      problemCount: 0,
    });
  });

  it('lists values it cannot read, leaves them empty and still imports the row', () => {
    const table = [
      ['Name', 'Amount'],
      ['Avery Lin', 'twelve'],
      ['Jordan Park', '5'],
    ];
    const result = buildImport(table, startPlan(table, properties), properties, ctx);
    expect(result.rows).toEqual([
      { rowNumber: 2, title: 'Avery Lin', values: {} },
      { rowNumber: 3, title: 'Jordan Park', values: { [amount.id]: '5' } },
    ]);
    expect(result.problems).toEqual([
      { row: 2, column: 'Amount', value: 'twelve', reason: "This isn't a number." },
    ]);
    expect(result.problemCount).toBe(1);
  });

  it('makes each missing option once and adds it to the existing property', () => {
    const table = [
      ['Name', 'Status'],
      ['Avery Lin', 'Blocked'],
      ['Jordan Park', 'blocked'],
      ['Blue Pine Plumbing', 'Waiting'],
    ];
    const result = buildImport(table, startPlan(table, properties), properties, ctx);
    const made = result.newOptions[status.id] ?? [];
    expect(made).toMatchObject([
      { name: 'Blocked', color: 'blue', group: 'todo' },
      { name: 'Waiting', color: 'purple', group: 'todo' },
    ]);
    expect(result.rows.map((r) => r.values[status.id])).toEqual([
      made[0]?.id,
      made[0]?.id,
      made[1]?.id,
    ]);
    // The caller's property is left as it was.
    expect(status.config.options).toHaveLength(3);
  });

  it('skips empty rows but keeps the row numbers of the file', () => {
    const table = [['Name', 'Amount'], ['Avery Lin', '1'], [''], [' ', ''], ['', '2']];
    expect(buildImport(table, startPlan(table, properties), properties, ctx).rows).toEqual([
      { rowNumber: 2, title: 'Avery Lin', values: { [amount.id]: '1' } },
      { rowNumber: 5, title: '', values: { [amount.id]: '2' } },
    ]);
  });

  it('numbers rows from 1 when the first row is not headers', () => {
    const table = [
      ['Avery Lin', '1'],
      ['Jordan Park', '2'],
    ];
    const sheet = splitTable(table, false);
    const plan = matchColumns(sheet.headers, properties, sheet.rows);
    const result = buildImport(table, plan, properties, ctx, { firstRowIsHeaders: false });
    const id = result.newProperties[0]?.id ?? '';
    expect(result.rows).toEqual([
      { rowNumber: 1, title: 'Avery Lin', values: { [id]: '1' } },
      { rowNumber: 2, title: 'Jordan Park', values: { [id]: '2' } },
    ]);
  });

  it("ignores skipped columns and targets that are gone, can't be filled or are filled already", () => {
    const files = newProperty('Files', defaultConfig('files'));
    const table = [
      ['Name', 'A', 'B', 'C', 'D', 'E'],
      ['Avery Lin', '1', '2', 'report.pdf', 'x', 'y'],
    ];
    const plan: ColumnPlan[] = [
      { index: 0, header: 'Name', target: { kind: 'existing', propertyId: name.id } },
      { index: 1, header: 'A', target: { kind: 'existing', propertyId: amount.id } },
      { index: 2, header: 'B', target: { kind: 'existing', propertyId: amount.id } },
      { index: 3, header: 'C', target: { kind: 'existing', propertyId: files.id } },
      { index: 4, header: 'D', target: { kind: 'existing', propertyId: 'deleted' } },
      { index: 5, header: 'E', target: { kind: 'skip' } },
    ];
    const result = buildImport(table, plan, [...properties, files], ctx);
    expect(result.rows).toEqual([
      { rowNumber: 2, title: 'Avery Lin', values: { [amount.id]: '1' } },
    ]);
    expect(result.problemCount).toBe(0);
  });

  it('keeps the first 10,000 problems and counts them all', () => {
    const table = [
      ['Name', 'Amount'],
      ...Array.from({ length: MAX_LISTED_PROBLEMS + 5 }, (_, i) => [`Row ${i + 1}`, 'n/a']),
    ];
    const result = buildImport(table, startPlan(table, properties), properties, ctx);
    expect(result.rows).toHaveLength(MAX_LISTED_PROBLEMS + 5);
    expect(result.problems).toHaveLength(MAX_LISTED_PROBLEMS);
    expect(result.problems.at(-1)?.row).toBe(MAX_LISTED_PROBLEMS + 1);
    expect(result.problemCount).toBe(MAX_LISTED_PROBLEMS + 5);
  });
});

describe('buildImport: new properties', () => {
  const name = newProperty('Name', defaultConfig('title'));

  /** Imports one column as a new property of `type`: the property made and the values read. */
  function importColumn(type: NewPropertyType, values: string[]) {
    const table = [['Name', 'Column'], ...values.map((v, i) => [`Row ${i + 1}`, v])];
    const plan: ColumnPlan[] = [
      { index: 0, header: 'Name', target: { kind: 'existing', propertyId: name.id } },
      { index: 1, header: 'Column', target: { kind: 'new', name: ' Column ', type } },
    ];
    const result = buildImport(table, plan, [name], ctx);
    const prop = result.newProperties[0];
    return { prop, values: result.rows.map((r) => r.values[prop?.id ?? '']), result };
  }

  it('makes the property with the name given and default settings', () => {
    expect(importColumn('text', ['a']).prop).toMatchObject({
      name: 'Column',
      config: { type: 'text' },
    });
  });

  it.each([
    'multi_select',
    'status',
    'checkbox',
    'url',
    'email',
    'phone',
    'person',
    'checklist',
  ] as const)('makes %s properties', (type) => {
    const config = importColumn(type, []).prop?.config;
    expect(config?.type).toBe(type);
    // Status gets new option ids each time.
    if (type !== 'status') expect(config).toEqual(defaultConfig(type));
  });

  it.each([
    [['$12.00', '-$1,234.50', ''], { format: 'currency', currency: 'USD' }],
    [['\u20ac12.00', '(\u20ac3.00)'], { format: 'currency', currency: 'EUR' }],
    [['CA$5.00'], { format: 'currency', currency: 'CAD' }],
    [['CHF\u00a012.00', 'CHF 3.50'], { format: 'currency', currency: 'CHF' }],
    [['45%', '12.5%'], { format: 'percent' }],
    [['1,234', '12'], { format: 'number_commas' }],
    [['12', '3.5'], { format: 'number' }],
  ])('sets the number format from values like %j', (values: string[], display: object) => {
    expect(importColumn('number', values).prop?.config).toMatchObject({
      type: 'number',
      ...display,
    });
  });

  it('reads the values with the settings it made', () => {
    expect(importColumn('number', ['45%', '12.5%']).values).toEqual(['0.45', '0.125']);
    expect(importColumn('number', ['$12.00', '-$1,234.50']).values).toEqual(['12', '-1234.5']);
  });

  it.each([
    [['2026-10-26', '2026-10-27 3:30 PM'], 'ymd'],
    [['10/26/2026', '01/02/2026'], 'mdy'],
    [['26/10/2026', '01/02/2026'], 'dmy'],
    [['Oct 26, 2026', '2026-10-27'], 'full'],
  ])('sets the date format from values like %j', (values: string[], format: string) => {
    expect(importColumn('date', values).prop?.config).toEqual({
      type: 'date',
      format,
      timeFormat: 'viewer',
    });
  });

  it('reads day-first dates in a new Day/Month/Year property', () => {
    expect(importColumn('date', ['26/10/2026', '01/02/2026']).values).toEqual([
      { start: '2026-10-26', end: null, hasTime: false },
      { start: '2026-02-01', end: null, hasTime: false },
    ]);
  });

  it('puts the options it makes in the new property, not in newOptions', () => {
    const { prop, values, result } = importColumn('select', ['High', 'Low', 'high']);
    expect(prop?.config).toMatchObject({
      type: 'select',
      options: [
        { name: 'High', color: 'gray' },
        { name: 'Low', color: 'brown' },
      ],
    });
    const ids = prop?.config.type === 'select' ? prop.config.options.map((o) => o.id) : [];
    expect(values).toEqual([ids[0], ids[1], ids[0]]);
    expect(result.newOptions).toEqual({});
  });
});

describe('problemsCsv', () => {
  it('writes Row, Column, Value and Reason, protecting the values', () => {
    const problems: ImportProblem[] = [
      { row: 3, column: 'Amount', value: '=1+2', reason: "This isn't a number." },
      {
        row: 7,
        column: 'Vendor',
        value: 'Blue Pine, Inc',
        reason: 'No row is called "Blue Pine".',
      },
    ];
    expect(problemsCsv(problems)).toBe(
      '\uFEFFRow,Column,Value,Reason\r\n' +
        "3,Amount,'=1+2,This isn't a number.\r\n" +
        '7,Vendor,"Blue Pine, Inc","No row is called ""Blue Pine""."\r\n',
    );
  });

  it('writes just the header row when there are no problems', () => {
    expect(problemsCsv([])).toBe('\uFEFFRow,Column,Value,Reason\r\n');
  });
});

describe('importSummary', () => {
  const problem: ImportProblem = {
    row: 2,
    column: 'Amount',
    value: 'x',
    reason: "This isn't a number.",
  };

  it('counts rows and the values that could not be read', () => {
    expect(importSummary(412, 3)).toBe("Imported 412 rows. 3 values couldn't be read.");
    expect(importSummary(2, [problem])).toBe("Imported 2 rows. 1 value couldn't be read.");
    expect(importSummary(12_000, 10_001)).toBe(
      "Imported 12,000 rows. 10,001 values couldn't be read.",
    );
  });

  it('leaves out problems when there are none', () => {
    expect(importSummary(1, 0)).toBe('Imported 1 row.');
    expect(importSummary(0, [])).toBe('Imported 0 rows.');
  });
});
