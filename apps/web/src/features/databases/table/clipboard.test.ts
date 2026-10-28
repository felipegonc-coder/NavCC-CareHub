import { describe, expect, it } from 'vitest';
import type { EvalContext, Property } from '@carehub/databases';
import { jobsProperties, PROPS, testViewer } from '../fixtures';
import {
  boxOf,
  copyText,
  fromTsv,
  inBox,
  pastedValues,
  personFinder,
  titleFinder,
  toTsv,
} from './clipboard';

const properties = jobsProperties();
const prop = (id: string): Property => {
  const found = properties.find((p) => p.id === id);
  if (!found) throw new Error(`No property ${id}`);
  return found;
};
const ctx: EvalContext = { properties, viewer: testViewer(), userName: () => undefined };

describe('toTsv and fromTsv', () => {
  it('writes tabs and line breaks, quoting values that need it', () => {
    const text = toTsv([
      ['Fix kitchen sink leak', 'High'],
      ['Two\nlines', 'a\tb'],
      ['"Quoted" first', 'say "hi"'],
    ]);
    expect(text).toBe(
      'Fix kitchen sink leak\tHigh\n"Two\nlines"\t"a\tb"\n"""Quoted"" first"\tsay "hi"',
    );
    expect(fromTsv(text)).toEqual([
      ['Fix kitchen sink leak', 'High'],
      ['Two\nlines', 'a\tb'],
      ['"Quoted" first', 'say "hi"'],
    ]);
  });

  it('reads blocks from spreadsheets (CRLF, a line break at the end)', () => {
    expect(fromTsv('a\tb\r\nc\t\r\n')).toEqual([
      ['a', 'b'],
      ['c', ''],
    ]);
    expect(fromTsv('')).toEqual([]);
  });
});

describe('blocks of cells', () => {
  it('makes a block from two corners, either way', () => {
    const box = boxOf({ row: 3, column: 1 }, { row: 1, column: 2 });
    expect(box).toEqual({ top: 1, bottom: 3, left: 1, right: 2 });
    expect(inBox(box, 2, 2)).toBe(true);
    expect(inBox(box, 0, 1)).toBe(false);
    expect(inBox(null, 0, 0)).toBe(false);
  });

  it('places a pasted block from its top left cell', () => {
    expect(pastedValues([['a', 'b'], ['c']], 2, 1)).toEqual([
      { row: 2, column: 1, text: 'a' },
      { row: 2, column: 2, text: 'b' },
      { row: 3, column: 1, text: 'c' },
    ]);
  });

  it('fills a block with a single value', () => {
    const fill = { top: 0, bottom: 1, left: 2, right: 3 };
    expect(pastedValues([['Low']], 0, 2, fill).map((v) => [v.row, v.column, v.text])).toEqual([
      [0, 2, 'Low'],
      [0, 3, 'Low'],
      [1, 2, 'Low'],
      [1, 3, 'Low'],
    ]);
    expect(pastedValues([['a', 'b']], 0, 2, fill)).toHaveLength(2);
  });
});

describe('copyText', () => {
  it('copies values as CSV export writes them', () => {
    expect(copyText(prop(PROPS.cost), { value: '180' }, ctx)).toBe('$180.00');
    expect(copyText(prop(PROPS.paid), { value: true }, ctx)).toBe('Yes');
    expect(copyText(prop(PROPS.priority), { value: 'opt-high' }, ctx)).toBe('High');
    expect(copyText(prop(PROPS.name), { value: '' }, ctx)).toBe('');
  });

  it('puts an apostrophe before text a spreadsheet would run, but not before numbers', () => {
    expect(copyText(prop(PROPS.notes), { value: [{ text: '=SUM(A1)' }] }, ctx)).toBe("'=SUM(A1)");
    expect(copyText(prop(PROPS.cost), { value: '-12' }, ctx)).toBe('-$12.00');
  });

  it('copies formula results', () => {
    const formula: Property = {
      id: 'prop-total',
      name: 'Total',
      description: '',
      rowPage: 'always',
      config: {
        type: 'formula',
        expression: 'prop("prop-paid")',
        resultKind: 'text',
        number: null,
      },
    };
    expect(copyText(formula, { value: null, computed: { kind: 'text', value: 'Paid' } }, ctx)).toBe(
      'Paid',
    );
  });
});

describe('titleFinder', () => {
  it("finds this table's rows and the rows they link to by title", () => {
    const relation: Property = {
      id: 'prop-customer',
      name: 'Customer',
      description: '',
      rowPage: 'always',
      config: {
        type: 'relation',
        targetDatabaseId: 'db-customers',
        single: false,
        twoWayPropertyId: null,
      },
    };
    const find = titleFinder({
      databaseId: 'db-jobs',
      properties: [...properties, relation],
      rows: [
        { id: 'row-sink', title: 'Fix kitchen sink leak', values: { 'prop-customer': ['c-1'] } },
        { id: 'row-heater', title: 'Replace water heater', values: { 'prop-customer': ['c-2'] } },
      ],
      rowTitles: { 'c-1': 'Harbor Cafe', 'c-2': 'Elm Street Clinic' },
    });
    expect(find('db-jobs', 'Replace water heater')).toEqual(['row-heater']);
    expect(find('db-customers', 'Harbor Cafe')).toEqual(['c-1']);
    expect(find('db-customers', 'Fix kitchen sink leak')).toEqual([]);
    expect(find('db-other', 'Harbor Cafe')).toEqual([]);
  });
});

describe('personFinder', () => {
  const find = personFinder([
    { id: 'user-avery', name: 'Avery Lin', email: 'avery.lin@bluepine.example' },
    { id: 'user-jordan', name: 'Jordan Park' },
    { id: 'user-sam-1', name: 'Sam Reyes' },
    { id: 'user-sam-2', name: 'Sam Reyes' },
    // The answer names Avery too.
    { id: 'user-avery', name: 'Avery Lin' },
  ]);

  it('finds people by exact name or email, ignoring case', () => {
    expect(find('Avery Lin')).toBe('user-avery');
    expect(find(' jordan park ')).toBe('user-jordan');
    expect(find('AVERY.LIN@bluepine.example')).toBe('user-avery');
  });

  it('finds no one for part of a name, or a name two people share', () => {
    expect(find('Avery')).toBeUndefined();
    expect(find('Sam Reyes')).toBeUndefined();
    expect(find('')).toBeUndefined();
  });
});
