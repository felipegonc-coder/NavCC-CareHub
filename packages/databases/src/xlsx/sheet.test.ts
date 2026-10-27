import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { utf8, xlsxFile, type FixtureSheet, type FixtureWorkbook } from './fixtures';
import { columnIndex, firstVisibleSheet, readSheet, readXlsxFile } from './sheet';
import { openXlsx, XLSX_ERRORS } from './workbook';
import type { InflateRaw } from './zip';

const inflate: InflateRaw = (b, max) => inflateRawSync(b, { maxOutputLength: max });

/** The table of a one-sheet workbook with these rows (the inside of <sheetData>). */
function table(rows: string, book: Omit<FixtureWorkbook, 'sheets'> = {}): string[][] {
  const r = readXlsxFile(xlsxFile({ ...book, sheets: [{ name: 'Reviews', rows }] }), {
    inflateRaw: inflate,
  });
  if (!r.ok) throw new Error(`readXlsxFile refused: ${r.error}`);
  return r.table;
}

/** The error for a one-sheet workbook, or "ok". */
function problem(sheet: Omit<FixtureSheet, 'name'>, firstRowIsHeaders?: boolean): string {
  const r = readXlsxFile(xlsxFile({ sheets: [{ name: 'Reviews', ...sheet }] }), {
    inflateRaw: inflate,
    firstRowIsHeaders,
  });
  return r.ok ? 'ok' : r.error;
}

const num = (ref: string, v: string | number, s = 0) => `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
const row = (r: number, cells: string) => `<row r="${r}">${cells}</row>`;

describe('columnIndex', () => {
  it.each([
    ['A1', 0],
    ['Z9', 25],
    ['AA1', 26],
    ['AB7', 27],
    ['GR1', 199],
    ['XFD1048576', 16383],
    ['b2', 1],
    ['C', 2],
  ])('%s is column %i', (ref: string, index: number) => {
    expect(columnIndex(ref)).toBe(index);
  });

  it.each([[''], ['1'], ['XFE1'], ['AAAA1'], ['A-1']])('%s has no column', (ref: string) => {
    expect(columnIndex(ref)).toBeNull();
  });
});

describe('sheet cells', () => {
  it('reads each kind of cell as its text', () => {
    const cells =
      '<c r="A1" t="s"><v>0</v></c>' +
      '<c r="B1" t="inlineStr"><is><t>Blue Pine Plumbing</t></is></c>' +
      '<c r="C1" t="str"><v>Jordan Park</v></c>' +
      '<c r="D1" t="b"><v>1</v></c><c r="E1" t="b"><v>0</v></c>' +
      '<c r="F1" t="e"><v>#N/A</v></c>' +
      '<c r="G1"><v>42</v></c><c r="H1" t="n"><v>0.30000000000000004</v></c>' +
      '<c r="I1" t="s"><v>99</v></c><c r="J1"><v>-1.5E-3</v></c>';
    expect(table(row(1, cells), { strings: ['Avery Lin'] })).toEqual([
      [
        'Avery Lin',
        'Blue Pine Plumbing',
        'Jordan Park',
        'TRUE',
        'FALSE',
        '#N/A',
        '42',
        '0.3',
        '',
        '-0.0015',
      ],
    ]);
  });

  it('reads rich inline strings without phonetic guides, and decodes escapes', () => {
    const cells =
      '<c r="A1" t="inlineStr"><is><r><rPr><b/></rPr><t>Blue </t></r><r><t>Pine</t></r>' +
      '<rPh sb="0" eb="4"><t>ぶるー</t></rPh></is></c>' +
      '<c r="B1" t="inlineStr"><is><t>Line one_x000D_\nLine two</t></is></c>' +
      '<c r="C1" t="str"><v>a_x000D_\nb</v></c>' +
      '<c r="D1" t="inlineStr"><is><t>&lt;Lin &amp; Park&gt;</t></is></c>';
    expect(table(row(1, cells))).toEqual([
      ['Blue Pine', 'Line one\nLine two', 'a\nb', '<Lin & Park>'],
    ]);
  });

  it('reads formulas as their saved results', () => {
    const cells =
      '<c r="A1"><f>1+1</f><v>2</v></c>' +
      '<c r="B1" t="str"><f>A1&amp;"!"</f><v>2!</v></c>' +
      '<c r="C1" t="b"><f>A1=2</f><v>1</v></c>' +
      '<c r="D1" t="e"><f>1/0</f><v>#DIV/0!</v></c>' +
      '<c r="E1"><f t="shared" ref="E1:E2" si="0"/><v>5</v></c>' +
      '<c r="F1" t="str"><f>NOW()</f></c>' +
      '<c r="G1"><f>B1</f><v></v></c>' +
      '<c r="H1" s="1"><f>TODAY()</f><v>46321</v></c>';
    expect(table(row(1, cells), { cellXfs: [0, 14] })).toEqual([
      ['2', '2!', 'TRUE', '#DIV/0!', '5', '', '', '2026-10-26'],
    ]);
  });

  it('reads dates, times and elapsed times by their format', () => {
    const book = {
      numFmts: { 164: 'dd/mm/yyyy', 165: '0.00', 166: '[h]:mm' },
      cellXfs: [0, 14, 22, 164, 165, 166, 20, 46],
    };
    const cells =
      num('A1', 46321, 1) +
      num('B1', 46321.604166666664, 2) +
      num('C1', 46321, 3) +
      num('D1', 46321.5, 4) +
      num('E1', 1.5, 5) +
      num('F1', 0.5, 6) +
      num('G1', 0.0625, 7) +
      num('H1', -1, 1) +
      num('I1', 3, 9) +
      '<c r="J1" s="1" t="s"><v>0</v></c>';
    expect(table(row(1, cells), { ...book, strings: ['26/10/2026'] })).toEqual([
      [
        '2026-10-26',
        '2026-10-26 14:30',
        '2026-10-26',
        '46321.5',
        '36:00',
        '12:00',
        '01:30',
        '-1',
        '3',
        '26/10/2026',
      ],
    ]);
  });

  it('counts dates from 1904 when the workbook says so', () => {
    expect(
      table(row(1, num('A1', 44859, 1) + num('B1', 44859.5, 2)), {
        cellXfs: [0, 14, 22],
        date1904: true,
      }),
    ).toEqual([['2026-10-26', '2026-10-26 12:00']]);
  });

  it('reads ISO dates (t="d") by their format', () => {
    const d = (ref: string, v: string, s = 0) => `<c r="${ref}" s="${s}" t="d"><v>${v}</v></c>`;
    const cells =
      d('A1', '2026-10-26T14:30:00Z') +
      d('B1', '2026-10-26T00:00:00Z') +
      d('C1', '2026-10-26T14:30:00', 1) +
      d('D1', '2026-10-26', 2) +
      d('E1', '1899-12-31T14:30:15', 3) +
      d('F1', '2026-10-26T14:30:15.250+02:00') +
      d('G1', 'not a date');
    expect(table(row(1, cells), { cellXfs: [0, 14, 22, 20] })).toEqual([
      [
        '2026-10-26 14:30',
        '2026-10-26',
        '2026-10-26',
        '2026-10-26 00:00',
        '14:30:15',
        '2026-10-26 14:30:15',
        'not a date',
      ],
    ]);
  });
});

describe('sheet layout', () => {
  it('keeps cells in their columns and rows at their numbers', () => {
    const rows =
      row(2, '<c r="A2" t="inlineStr"><is><t>Avery Lin</t></is></c>' + num('C2', 3)) +
      row(4, num('B4', 5));
    expect(table(rows)).toEqual([[], ['Avery Lin', '', '3'], [], ['', '5']]);
  });

  it('leaves out empty cells at the end of a row and empty rows at the end', () => {
    const rows =
      row(
        1,
        `${num('A1', 1)}<c r="B1"/><c r="C1" t="s"/><c r="D1" t="inlineStr"><is><t></t></is></c>`,
      ) +
      '<row r="2"/>' +
      row(3, '<c r="A3" s="0"/>') +
      row(4, '<c r="B4"><v></v></c>');
    expect(table(rows)).toEqual([['1']]);
  });

  it('places cells and rows without references after the ones before them', () => {
    const rows =
      '<row><c><v>1</v></c><c><v>2</v></c>' +
      num('E1', 5) +
      '<c><v>6</v></c></row><row><c><v>7</v></c></row>' +
      row(5, '<c><v>8</v></c>');
    expect(table(rows)).toEqual([['1', '2', '', '', '5', '6'], ['7'], [], [], ['8']]);
  });

  it('reads only sheetData, with or without a namespace prefix', () => {
    const xml =
      '<x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<x:sheetPr><x:tabColor rgb="FF00AA00"/></x:sheetPr><x:dimension ref="A1:B1"/>' +
      '<x:sheetData><x:row r="1"><x:c r="A1" t="inlineStr"><x:is><x:t>Jordan Park</x:t></x:is></x:c>' +
      '<x:c r="B1"><x:v>8</x:v></x:c></x:row></x:sheetData>' +
      '<x:mergeCells count="1"><x:mergeCell ref="A1:B1"/></x:mergeCells>' +
      '<x:headerFooter><x:oddHeader>&amp;CBlue Pine</x:oddHeader></x:headerFooter>' +
      '<x:extLst><x:ext><x:row r="9"><x:c r="A9"><x:v>9</x:v></x:c></x:row></x:ext></x:extLst></x:worksheet>';
    const r = readXlsxFile(xlsxFile({ sheets: [{ name: 'Reviews', xml }] }), {
      inflateRaw: inflate,
    });
    expect(r.ok && r.table).toEqual([['Jordan Park', '8']]);
  });

  it('gives an empty table for an empty sheet', () => {
    expect(table('')).toEqual([]);
    const xml = '<worksheet><sheetData/></worksheet>';
    const r = readXlsxFile(xlsxFile({ sheets: [{ name: 'Reviews', xml }] }), {
      inflateRaw: inflate,
    });
    expect(r.ok && r.table).toEqual([]);
  });
});

describe('sheet limits', () => {
  it('allows 200 columns and refuses more', () => {
    expect(problem({ rows: row(1, num('GR1', 1)) })).toBe('ok');
    expect(problem({ rows: row(1, num('GS1', 1)) })).toBe('This file has more than 200 columns.');
    expect(problem({ rows: row(1, num('XFD1', 1)) })).toBe('This file has more than 200 columns.');
  });

  it('allows 20,000 rows below the header row and refuses more', () => {
    const last = (r: number) => ({ rows: row(1, num('A1', 1)) + row(r, num(`A${r}`, 1)) });
    expect(problem(last(20_001))).toBe('ok');
    expect(problem(last(20_002))).toBe('This file has more than 20,000 rows.');
    expect(problem(last(20_001), false)).toBe('This file has more than 20,000 rows.');
    expect(problem(last(20_000), false)).toBe('ok');
    expect(problem(last(1_048_576))).toBe('This file has more than 20,000 rows.');
  });

  it('counts every row up to the limit', () => {
    const rows = Array.from({ length: 20_002 }, (_, k) => row(k + 1, num(`A${k + 1}`, k))).join('');
    expect(problem({ rows })).toBe('This file has more than 20,000 rows.');
  });

  it('refuses a sheet that is not well formed', () => {
    const xml = '<worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData';
    expect(problem({ xml })).toBe(XLSX_ERRORS.damaged);
    expect(problem({ xml: '<!DOCTYPE worksheet><worksheet/>' })).toBe(XLSX_ERRORS.damaged);
  });
});

describe('picking a sheet', () => {
  const book = xlsxFile({
    sheets: [
      { name: 'Setup', state: 'hidden', rows: row(1, num('A1', 0)) },
      { name: 'Q3 reviews', rows: row(1, '<c r="A1" t="inlineStr"><is><t>Name</t></is></c>') },
      {
        name: 'Vendors',
        rows: row(1, '<c r="A1" t="inlineStr"><is><t>Blue Pine Plumbing</t></is></c>'),
      },
    ],
  });
  const sheets = [
    { name: 'Setup', hidden: true },
    { name: 'Q3 reviews', hidden: false },
    { name: 'Vendors', hidden: false },
  ];

  it('reads the first visible sheet by default', () => {
    expect(readXlsxFile(book, { inflateRaw: inflate })).toEqual({
      ok: true,
      sheets,
      sheet: 'Q3 reviews',
      table: [['Name']],
    });
  });

  it('reads the chosen sheet, hidden or not', () => {
    const vendors = readXlsxFile(book, { inflateRaw: inflate, sheet: 'Vendors' });
    expect(vendors.ok && vendors.table).toEqual([['Blue Pine Plumbing']]);
    const setup = readXlsxFile(book, { inflateRaw: inflate, sheet: 'Setup' });
    expect(setup.ok && setup.table).toEqual([['0']]);
  });

  it('names a sheet that is not there, and still lists the others', () => {
    expect(readXlsxFile(book, { inflateRaw: inflate, sheet: 'vendors' })).toEqual({
      ok: false,
      error: "This file has no sheet named 'vendors'.",
      sheets,
    });
  });

  it('gives no sheet list when the workbook itself cannot be opened', () => {
    expect(readXlsxFile(utf8('Name\nAvery Lin\n'), { inflateRaw: inflate })).toEqual({
      ok: false,
      error: XLSX_ERRORS.notXlsx,
    });
  });

  it('reads sheets of an opened workbook one by one', () => {
    const opened = openXlsx(book, inflate);
    if (!opened.ok) throw new Error(opened.error);
    expect(readSheet(opened.file, 'Vendors')).toEqual({
      ok: true,
      table: [['Blue Pine Plumbing']],
    });
    expect(readSheet(opened.file, 'Q3 reviews', { firstRowIsHeaders: false })).toEqual({
      ok: true,
      table: [['Name']],
    });
    expect(readSheet(opened.file, 'Q4')).toEqual({
      ok: false,
      error: "This file has no sheet named 'Q4'.",
    });
  });

  it('picks the first visible sheet, else the first one', () => {
    expect(firstVisibleSheet(sheets)).toBe('Q3 reviews');
    expect(
      firstVisibleSheet([
        { name: 'Setup', hidden: true },
        { name: 'Old', hidden: true },
      ]),
    ).toBe('Setup');
    expect(firstVisibleSheet([])).toBe('');
  });

  it('reads deflated workbooks', () => {
    const deflated = xlsxFile({
      sheets: [
        { name: 'Q3 reviews', rows: row(1, '<c r="A1" t="s"><v>0</v></c>' + num('B1', 46321, 1)) },
      ],
      strings: ['Avery Lin'],
      cellXfs: [0, 14],
      deflate: (b) => deflateRawSync(b),
    });
    expect(readXlsxFile(deflated, { inflateRaw: inflate })).toEqual({
      ok: true,
      sheets: [{ name: 'Q3 reviews', hidden: false }],
      sheet: 'Q3 reviews',
      table: [['Avery Lin', '2026-10-26']],
    });
  });
});
