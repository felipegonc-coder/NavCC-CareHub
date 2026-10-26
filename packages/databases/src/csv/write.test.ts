import { describe, expect, it } from 'vitest';
import { defaultConfig, newProperty } from '../schema';
import type { ConfigOf, Property, Row, ViewPropertySetting } from '../types';
import { readCsvFile } from './parse';
import {
  exportColumns,
  exportFileName,
  exportTable,
  protectCell,
  unprotectCell,
  writeCsv,
} from './write';

describe('writeCsv', () => {
  it('writes a byte order mark, commas and CRLF after every line', () => {
    expect(
      writeCsv([
        ['Name', 'Status'],
        ['Avery Lin', 'Open'],
      ]),
    ).toBe('\uFEFFName,Status\r\nAvery Lin,Open\r\n');
  });

  it('quotes values with separators, quotes, line breaks or spaces at either end', () => {
    const row = [
      'Blue Pine Plumbing, LLC',
      'a;b',
      'a\tb',
      'He said "hi"',
      'Line 1\nLine 2',
      'a\rb',
      ' padded',
      'end ',
      'in between',
    ];
    expect(writeCsv([row])).toBe(
      '\uFEFF"Blue Pine Plumbing, LLC","a;b","a\tb","He said ""hi""","Line 1\nLine 2","a\rb"," padded","end ",in between\r\n',
    );
  });

  it('writes empty values and empty tables', () => {
    expect(writeCsv([['', 'x', '']])).toBe('\uFEFF,x,\r\n');
    expect(writeCsv([])).toBe('\uFEFF');
  });

  it('reads back as the same table', () => {
    const table = [
      ['Name', 'Notes', 'Amount', 'Tags'],
      ['Avery Lin', 'Called, left message', '-$1,234.50', 'Billing, Urgent'],
      ["'=Jordan Park", 'He said "hi"\nthen left', '45%', ''],
      ['Blue Pine Plumbing', ' padded ', '1;2', 'Caf\u00e9 \u2713 \u{1F600}\ttab'],
      ['', '', '', ''],
      ['Last', 'row', '', 'x'],
    ];
    expect(readCsvFile(new TextEncoder().encode(writeCsv(table)))).toEqual({
      ok: true,
      separator: ',',
      table,
    });
  });
});

describe('protectCell', () => {
  it.each([
    ['=SUM(A1:A3)', "'=SUM(A1:A3)"],
    ['+1 555 0100', "'+1 555 0100"],
    ['-call back', "'-call back"],
    ['@Avery Lin', "'@Avery Lin"],
    ['\t=1', "'\t=1"],
    ['\r=1', "'\r=1"],
    ['-12', "'-12"],
    ["'=SUM(1)", "''=SUM(1)"],
  ])('protects %j', (text: string, expected: string) => {
    expect(protectCell(text)).toBe(expected);
  });

  it.each(['Avery Lin', "it's", "'plain", '', '1-2', 'a=b', '12'])(
    'leaves %j as it is',
    (text: string) => {
      expect(protectCell(text)).toBe(text);
    },
  );

  it('keeps numbers as they are in number columns', () => {
    expect(protectCell('-12', true)).toBe('-12');
    expect(protectCell('-$1,234.50', true)).toBe('-$1,234.50');
    expect(protectCell('-45%', true)).toBe('-45%');
    expect(protectCell('+5', true)).toBe('+5');
    expect(protectCell('=1+2', true)).toBe("'=1+2");
    expect(protectCell('-call back', true)).toBe("'-call back");
  });
});

describe('unprotectCell', () => {
  it('removes the apostrophe protectCell adds', () => {
    expect(unprotectCell("'=SUM(1)")).toBe('=SUM(1)');
    expect(unprotectCell("''=SUM(1)")).toBe("'=SUM(1)");
    expect(unprotectCell("'-12")).toBe('-12');
  });

  it('keeps other apostrophes', () => {
    expect(unprotectCell("'plain")).toBe("'plain");
    expect(unprotectCell("it's")).toBe("it's");
    expect(unprotectCell("'")).toBe("'");
    expect(unprotectCell('=SUM(1)')).toBe('=SUM(1)');
  });

  it.each(['=1', "'=1", "''+2", '-x', "'", "'abc", 'abc', '@me', '', '\tx', '\r'])(
    'undoes protectCell for %j',
    (text: string) => {
      expect(unprotectCell(protectCell(text))).toBe(text);
    },
  );
});

describe('exportFileName', () => {
  const today = '2026-10-26';

  it('names This view exports after the database and the view', () => {
    expect(exportFileName({ title: 'QA reviews' }, { name: 'Open' }, today)).toBe(
      'QA reviews \u2013 Open \u2013 2026-10-26.csv',
    );
  });

  it('names Everything exports after the database only', () => {
    expect(exportFileName({ title: 'QA reviews' }, null, today)).toBe(
      'QA reviews \u2013 2026-10-26.csv',
    );
  });

  it('turns characters file systems refuse into spaces', () => {
    expect(
      exportFileName({ title: 'Clients: A/B "test"?' }, { name: 'Due <today>|*' }, today),
    ).toBe('Clients A B test \u2013 Due today \u2013 2026-10-26.csv');
    expect(exportFileName({ title: 'Line 1\nLine 2\\x' }, null, today)).toBe(
      'Line 1 Line 2 x \u2013 2026-10-26.csv',
    );
  });

  it('drops leading dots', () => {
    expect(exportFileName({ title: '..hidden' }, { name: '.view' }, today)).toBe(
      'hidden \u2013 view \u2013 2026-10-26.csv',
    );
  });

  it('uses Untitled for a database without a usable name and leaves out an empty view name', () => {
    expect(exportFileName({ title: '' }, null, today)).toBe('Untitled \u2013 2026-10-26.csv');
    expect(exportFileName({ title: '...' }, { name: '???' }, today)).toBe(
      'Untitled \u2013 2026-10-26.csv',
    );
  });

  it('cuts each part to 100 bytes of UTF-8', () => {
    expect(exportFileName({ title: 'a'.repeat(150) }, null, today)).toBe(
      `${'a'.repeat(100)} \u2013 2026-10-26.csv`,
    );
    expect(
      exportFileName({ title: '\u00e9'.repeat(60) }, { name: '\u{1F600}'.repeat(30) }, today),
    ).toBe(`${'\u00e9'.repeat(50)} \u2013 ${'\u{1F600}'.repeat(25)} \u2013 2026-10-26.csv`);
  });
});

describe('exportColumns', () => {
  const name = newProperty('Name', defaultConfig('title'));
  const notes = newProperty('Notes', defaultConfig('text'));
  const status = newProperty('Status', defaultConfig('status'));
  const created = newProperty('Created', defaultConfig('created_time'));
  const button = newProperty('Send reminder', defaultConfig('button'));
  const properties: Property[] = [notes, name, status, button, created];
  const setting = (p: Property | string, visible = true): ViewPropertySetting => ({
    propertyId: typeof p === 'string' ? p : p.id,
    visible,
  });

  it('Everything: every property in database order, Name first, without buttons', () => {
    expect(exportColumns(properties, null)).toEqual([name, notes, status, created]);
  });

  it("This view: the view's visible properties in view order, Name first", () => {
    const view = {
      properties: [
        setting(status),
        setting(created),
        setting(notes, false),
        setting('deleted-property'),
        setting(button),
        setting(name),
        setting(status),
      ],
    };
    expect(exportColumns(properties, view)).toEqual([name, status, created]);
  });

  it('keeps Name when the view hides it', () => {
    expect(
      exportColumns(properties, { properties: [setting(name, false), setting(notes)] }),
    ).toEqual([name, notes]);
  });
});

describe('exportTable', () => {
  const row = (id: string, title: string): Row => ({
    id,
    title,
    values: {},
    createdAt: '2026-10-26T15:00:00.000Z',
    createdBy: 'u-avery',
    editedAt: '2026-10-26T15:00:00.000Z',
    editedBy: 'u-avery',
    uniqueNumber: null,
  });
  const numberFormula: ConfigOf<'formula'> = { ...defaultConfig('formula'), resultKind: 'number' };
  const textFormula: ConfigOf<'formula'> = { ...defaultConfig('formula'), resultKind: 'text' };
  const columns: Property[] = [
    newProperty('Name', defaultConfig('title')),
    newProperty('Amount', defaultConfig('number')),
    newProperty('+Notes', defaultConfig('text')),
    newProperty('Total', numberFormula),
    newProperty('Label', textFormula),
  ];
  const shown: Record<string, string[]> = {
    r1: ['=Avery Lin', '-12', '-12', '-3', '-3'],
    r2: ['Jordan Park', '-$1,234.50', '@Jordan', '=1', 'ok'],
  };

  it('writes a header row, then protected cells, keeping numbers in number columns', () => {
    const rows = [row('r1', '=Avery Lin'), row('r2', 'Jordan Park')];
    const cellText = (r: Row, p: Property): string => shown[r.id]?.[columns.indexOf(p)] ?? '';
    expect(exportTable(columns, rows, cellText)).toEqual([
      ['Name', 'Amount', "'+Notes", 'Total', 'Label'],
      ["'=Avery Lin", '-12', "'-12", '-3', "'-3"],
      ['Jordan Park', '-$1,234.50', "'@Jordan", "'=1", 'ok'],
    ]);
  });
});
