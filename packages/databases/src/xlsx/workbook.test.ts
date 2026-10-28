import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { utf8, xlsxFile, zipFile, type FixtureEntry } from './fixtures';
import {
  cleanCellText,
  failureMessage,
  listSheets,
  noSuchSheet,
  openXlsx,
  XLSX_ERRORS,
  XlsxFailure,
  type XlsxFile,
} from './workbook';
import { XmlError } from './xml';
import type { InflateRaw } from './zip';

const inflate: InflateRaw = (b, max) => inflateRawSync(b, { maxOutputLength: max });

function open(bytes: Uint8Array): XlsxFile {
  const r = openXlsx(bytes, inflate);
  if (!r.ok) throw new Error(`openXlsx refused: ${r.error}`);
  return r.file;
}

const errorOf = (bytes: Uint8Array): string => {
  const r = openXlsx(bytes, inflate);
  return r.ok ? 'opened' : r.error;
};

const REL = 'http://purl.oclc.org/ooxml/officeDocument/relationships';

describe('openXlsx', () => {
  it('lists worksheets in workbook order with hidden ones marked, without chart sheets', () => {
    const file = open(
      xlsxFile({
        sheets: [
          { name: 'Q3 reviews' },
          { name: 'Scores chart', chart: true },
          { name: 'Old', state: 'hidden' },
          { name: 'Setup', state: 'veryHidden' },
          { name: 'Vendors & "notes"' },
        ],
      }),
    );
    expect(listSheets(file)).toEqual([
      { name: 'Q3 reviews', hidden: false },
      { name: 'Old', hidden: true },
      { name: 'Setup', hidden: true },
      { name: 'Vendors & "notes"', hidden: false },
    ]);
    expect([...file.parts.keys()]).toEqual(['Q3 reviews', 'Old', 'Setup', 'Vendors & "notes"']);
  });

  it('gives copies of the sheet list', () => {
    const file = open(xlsxFile({ sheets: [{ name: 'Q3 reviews' }] }));
    const first = listSheets(file);
    first.push({ name: 'Extra', hidden: false });
    expect(listSheets(file)).toEqual([{ name: 'Q3 reviews', hidden: false }]);
  });

  it('reads the date system', () => {
    expect(open(xlsxFile({ sheets: [{ name: 'A' }] })).date1904).toBe(false);
    expect(open(xlsxFile({ sheets: [{ name: 'A' }], date1904: true })).date1904).toBe(true);
  });

  it('reads shared strings: rich text runs joined, phonetic guides left out, escapes decoded', () => {
    const sst =
      '<si><t>Avery Lin</t></si>' +
      '<si><r><rPr><b/><sz val="11"/></rPr><t xml:space="preserve">Blue </t></r><r><t>Pine</t></r>' +
      '<rPh sb="0" eb="4"><t>ぶるー</t></rPh><phoneticPr fontId="1"/></si>' +
      '<si/>' +
      '<si><t/></si>' +
      '<si><t>Line one_x000D_\nLine two</t></si>' +
      '<si><t>_x005F_x000D_ stays</t></si>';
    expect(open(xlsxFile({ sheets: [{ name: 'A' }], sst })).strings).toEqual([
      'Avery Lin',
      'Blue Pine',
      '',
      '',
      'Line one\nLine two',
      '_x000D_ stays',
    ]);
  });

  it('clips each shared string to one character more than a Text property takes', () => {
    const sst =
      `<si><t>${'a'.repeat(20_000)}</t></si>` +
      `<si><t>${'b'.repeat(10_000)}</t></si>` +
      `<si><t>${'c'.repeat(10_000)}😀d</t></si>` +
      `<si><r><t>${'x'.repeat(6_000)}</t></r><r><t>${'y'.repeat(6_000)}</t></r></si>` +
      `<si><t>${'_x0041_'.repeat(12_000)}</t></si>`;
    expect(open(xlsxFile({ sheets: [{ name: 'A' }], sst })).strings).toEqual([
      'a'.repeat(10_001),
      'b'.repeat(10_000),
      `${'c'.repeat(10_000)}😀`,
      'x'.repeat(6_000) + 'y'.repeat(4_001),
      'A'.repeat(10_001),
    ]);
  });

  it('refuses more than 1,000,000 shared strings', () => {
    const sst = '<si/>'.repeat(1_000_000);
    expect(open(xlsxFile({ sheets: [{ name: 'A' }], sst })).strings).toHaveLength(1_000_000);
    expect(
      errorOf(xlsxFile({ sheets: [{ name: 'A' }], sst: `${sst}<si><t>Avery Lin</t></si>` })),
    ).toBe('This file has more than 1,000,000 different text values.');
  });

  it('reads which cell styles show dates, from cellXfs only', () => {
    const file = open(
      xlsxFile({
        sheets: [{ name: 'A' }],
        numFmts: { 164: 'yyyy-mm-dd', 165: '0.00', 166: '[h]:mm' },
        cellXfs: [0, 14, 164, 22, 165, 10, 20, 166],
      }),
    );
    // The fixture's cellStyleXfs (numFmtId 14) and its dxf numFmt 164 ("0.00") don't count.
    expect(file.styles).toEqual([null, 'date', 'date', 'datetime', null, null, 'time', 'duration']);
  });

  it('opens workbooks without shared strings, styles or package relationships', () => {
    const file = open(
      xlsxFile({
        sheets: [{ name: 'A' }],
        without: ['xl/sharedStrings.xml', 'xl/styles.xml', '_rels/.rels'],
      }),
    );
    expect(file.strings).toEqual([]);
    expect(file.styles).toEqual([]);
    expect(listSheets(file)).toEqual([{ name: 'A', hidden: false }]);
  });

  it('follows relationships as other programs write them', () => {
    const entries: FixtureEntry[] = [
      {
        name: 'xl/workbook.xml',
        data:
          '<workbook xmlns:rel="x"><workbookPr date1904="true"/><sheets>' +
          '<sheet name="Avery" rel:id="r1"/><sheet name="Jordan" rel:id="r2"/>' +
          '<sheet name="Web" rel:id="r3"/><sheet name="Lost" rel:id="r4"/><sheet name="Nowhere"/>' +
          '</sheets></workbook>',
      },
      {
        name: 'xl/_rels/workbook.xml.rels',
        data:
          `<Relationships><Relationship Id="r1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/>` +
          `<Relationship Id="r2" Type="${REL}/worksheet" Target="../xl/./worksheets/sheet2.xml"/>` +
          `<Relationship Id="r3" Type="${REL}/worksheet" Target="https://example.com/s.xml" TargetMode="External"/>` +
          `<Relationship Id="r4" Type="${REL}/worksheet" Target="worksheets/missing.xml"/></Relationships>`,
      },
      { name: 'XL/Worksheets/Sheet1.xml', data: '<worksheet><sheetData/></worksheet>' },
      { name: 'xl\\worksheets\\sheet2.xml', data: '<worksheet><sheetData/></worksheet>' },
    ];
    const file = open(zipFile(entries));
    expect(listSheets(file)).toEqual([
      { name: 'Avery', hidden: false },
      { name: 'Jordan', hidden: false },
    ]);
    expect(file.date1904).toBe(true);
  });

  it('refuses files that are not .xlsx workbooks', () => {
    expect(errorOf(utf8('Name,Score\r\nAvery Lin,9\r\n'))).toBe(XLSX_ERRORS.notXlsx);
    expect(errorOf(new Uint8Array(0))).toBe(XLSX_ERRORS.notXlsx);
    expect(errorOf(zipFile([{ name: 'word/document.xml', data: '<document/>' }]))).toBe(
      XLSX_ERRORS.notXlsx,
    );
    expect(errorOf(xlsxFile({ sheets: [{ name: 'A' }], without: ['xl/workbook.xml'] }))).toBe(
      XLSX_ERRORS.notXlsx,
    );
  });

  it('refuses older .xls files and password-protected workbooks', () => {
    const ole = new Uint8Array(512);
    ole.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    expect(errorOf(ole)).toBe(XLSX_ERRORS.oldOrPassword);
    expect(errorOf(zipFile([{ name: 'xl/workbook.xml', data: '<workbook/>', flags: 1 }]))).toBe(
      XLSX_ERRORS.password,
    );
  });

  it('refuses files over 10 MB with the CSV message', () => {
    expect(errorOf(new Uint8Array(10 * 1024 * 1024 + 1))).toBe('This file is larger than 10 MB.');
    expect(errorOf(new Uint8Array(10 * 1024 * 1024))).toBe(XLSX_ERRORS.notXlsx);
  });

  it('refuses zips that would unpack too much, before unpacking', () => {
    const many = Array.from({ length: 1001 }, (_, k) => ({ name: `xl/p${k}.xml`, data: '' }));
    expect(errorOf(zipFile(many))).toBe('This file has more than 1,000 parts.');
    expect(
      errorOf(zipFile([{ name: 'xl/workbook.xml', data: '', size: 50 * 1024 * 1024 + 1 }])),
    ).toBe('Part of this file is larger than 50 MB once unpacked.');
    const big = [1, 2, 3].map((k) => ({ name: `xl/p${k}.xml`, data: '', size: 40 * 1024 * 1024 }));
    expect(errorOf(zipFile(big))).toBe('This file is larger than 100 MB once unpacked.');
  });

  it('refuses damaged workbooks', () => {
    const workbook = (e: Partial<FixtureEntry>) =>
      errorOf(zipFile([{ name: 'xl/workbook.xml', data: '<workbook/>', ...e }]));
    expect(workbook({ crc: 1 })).toBe(XLSX_ERRORS.damaged);
    expect(workbook({ method: 14 })).toBe(XLSX_ERRORS.damaged);
    expect(
      workbook({ data: '<!DOCTYPE workbook [<!ENTITY e "x">]><workbook>&e;</workbook>' }),
    ).toBe(XLSX_ERRORS.damaged);
    expect(workbook({ data: '<workbook><sheets><sheet name="A' })).toBe(XLSX_ERRORS.damaged);
    const book = xlsxFile({ sheets: [{ name: 'A' }], sst: '<!DOCTYPE sst>' });
    expect(errorOf(book)).toBe(XLSX_ERRORS.damaged);
    const lying: InflateRaw = () => new Uint8Array(3);
    const r = openXlsx(xlsxFile({ sheets: [{ name: 'A' }], deflate: (b) => b }), lying);
    expect(r.ok ? 'opened' : r.error).toBe(XLSX_ERRORS.damaged);
  });

  it('refuses workbooks without worksheets', () => {
    expect(errorOf(xlsxFile({ sheets: [] }))).toBe(XLSX_ERRORS.noSheets);
    expect(errorOf(xlsxFile({ sheets: [{ name: 'Scores chart', chart: true }] }))).toBe(
      XLSX_ERRORS.noSheets,
    );
    expect(
      errorOf(zipFile([{ name: 'xl/workbook.xml', data: '<workbook><sheets/></workbook>' }])),
    ).toBe(XLSX_ERRORS.noSheets);
  });
});

describe('messages', () => {
  it('names the missing sheet', () => {
    expect(noSuchSheet('Q4 reviews')).toBe("This file has no sheet named 'Q4 reviews'.");
  });

  it('turns reader errors into messages and throws anything else again', () => {
    expect(failureMessage(new XlsxFailure('This file has no sheets.'))).toBe(
      'This file has no sheets.',
    );
    expect(failureMessage(new XmlError('Bad tag at character 4.'))).toBe(XLSX_ERRORS.damaged);
    expect(() => failureMessage(new TypeError('a bug'))).toThrow(TypeError);
  });
});

describe('cleanCellText', () => {
  it.each([
    ['Avery Lin', 'Avery Lin'],
    ['one_x000D_\ntwo', 'one\ntwo'],
    ['one_x000d_two', 'one\ntwo'],
    ['one\r\ntwo\rthree', 'one\ntwo\nthree'],
    ['tab_x0009_here', 'tab\there'],
    ['_x005F_x0041_', '_x0041_'],
    ['nul_x0000_\u0000gone', 'nulgone'],
    ['_x00_ and _xZZZZ_', '_x00_ and _xZZZZ_'],
  ])('%j reads %j', (raw: string, text: string) => {
    expect(cleanCellText(raw)).toBe(text);
  });
});
