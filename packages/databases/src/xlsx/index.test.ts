/** An Excel workbook through the public entry and the CSV import plan (spec 3.7, DB-46). */
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { buildImport, matchColumns, splitTable, type ImportContext } from '../csv';
import { plainText } from '../richtext';
import { defaultConfig, newProperty } from '../schema';
import type { RichText } from '../types';
import { xlsxFile } from './fixtures';
import { readXlsxFile, withExcelRowNumbers, type InflateRaw } from './index';

const inflate: InflateRaw = (b, max) => inflateRawSync(b, { maxOutputLength: max });
const viewer = { timeZone: 'America/Denver', now: new Date('2026-10-26T18:00:00Z') };
const ctx: ImportContext = { viewer, findUser: () => undefined, findRows: () => [] };

const STRINGS = ['Name', 'Visit', 'Score', 'Paid', 'Notes', 'Updated', 'Avery Lin', 'Jordan Park'];
const s = (ref: string, i: number) => `<c r="${ref}" t="s"><v>${i}</v></c>`;
const n = (ref: string, v: number, style = 0) => `<c r="${ref}" s="${style}"><v>${v}</v></c>`;
const b = (ref: string, v: 0 | 1) => `<c r="${ref}" t="b"><v>${v}</v></c>`;
const t = (ref: string, text: string) => `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`;

/** Q3 reviews: rows 1 and 2 empty, the header in row 3, row 6 empty. The summary sheet comes first. */
const workbook = xlsxFile({
  sheets: [
    { name: 'Summary', rows: `<row r="1">${t('A1', 'Reviews by vendor')}</row>` },
    {
      name: 'Q3 reviews',
      rows:
        `<row r="1"><c r="A1" s="1"/></row>` +
        `<row r="3">${[0, 1, 2, 3, 4, 5].map((i) => s(`${'ABCDEF'[i]}3`, i)).join('')}</row>` +
        `<row r="4">${s('A4', 6)}${n('B4', 46321, 1)}${n('C4', 9)}${b('D4', 1)}${t('E4', 'Prefers mornings')}${n('F4', 46321.604166666664, 2)}</row>` +
        `<row r="5">${s('A5', 7)}${n('B5', 46322, 1)}${n('C5', 8.5)}${b('D5', 0)}${n('F5', 46322.5, 2)}</row>` +
        `<row r="7">${t('A7', 'Blue Pine Plumbing')}${n('B7', 46323, 1)}${t('C7', 'n/a')}${b('D7', 1)}${t('E7', 'Call first_x000D_\nthen visit')}${n('F7', 46323.25, 2)}</row>`,
    },
  ],
  strings: STRINGS,
  cellXfs: [0, 14, 22],
  deflate: (bytes) => deflateRawSync(bytes),
});

describe('importing an .xlsx sheet', () => {
  it('reads the chosen sheet into the table CSV import reads, from its first row with a value', () => {
    const r = readXlsxFile(workbook, { inflateRaw: inflate, sheet: 'Q3 reviews' });
    expect(r).toEqual({
      ok: true,
      sheets: [
        { name: 'Summary', hidden: false },
        { name: 'Q3 reviews', hidden: false },
      ],
      sheet: 'Q3 reviews',
      skippedRows: 2,
      table: [
        ['Name', 'Visit', 'Score', 'Paid', 'Notes', 'Updated'],
        ['Avery Lin', '2026-10-26', '9', 'TRUE', 'Prefers mornings', '2026-10-26 14:30'],
        ['Jordan Park', '2026-10-27', '8.5', 'FALSE', '', '2026-10-27 12:00'],
        [],
        [
          'Blue Pine Plumbing',
          '2026-10-28',
          'n/a',
          'TRUE',
          'Call first\nthen visit',
          '2026-10-28 06:00',
        ],
      ],
    });
  });

  it("guesses types, fills properties and gives problems Excel's row numbers", () => {
    const r = readXlsxFile(workbook, { inflateRaw: inflate, sheet: 'Q3 reviews' });
    if (!r.ok) throw new Error(r.error);
    const name = newProperty('Name', defaultConfig('title'));
    const score = newProperty('Score', defaultConfig('number'));
    const properties = [name, score];
    const sheet = splitTable(r.table);
    const plan = matchColumns(sheet.headers, properties, sheet.rows);
    expect(plan.map((p) => p.target)).toEqual([
      { kind: 'existing', propertyId: name.id },
      { kind: 'new', name: 'Visit', type: 'date' },
      { kind: 'existing', propertyId: score.id },
      { kind: 'new', name: 'Paid', type: 'checkbox' },
      { kind: 'new', name: 'Notes', type: 'text' },
      { kind: 'new', name: 'Updated', type: 'date' },
    ]);

    const result = withExcelRowNumbers(buildImport(r.table, plan, properties, ctx), r.skippedRows);
    const id = (propName: string) =>
      result.newProperties.find((p) => p.name === propName)?.id ?? '';
    const day = (start: string) => ({ start, end: null, hasTime: false });
    const at = (start: string) => ({ start, end: null, hasTime: true });
    expect(result.rows.map((row) => [row.rowNumber, row.title])).toEqual([
      [4, 'Avery Lin'],
      [5, 'Jordan Park'],
      [7, 'Blue Pine Plumbing'],
    ]);
    expect(result.rows.map((row) => row.values[id('Visit')])).toEqual([
      day('2026-10-26'),
      day('2026-10-27'),
      day('2026-10-28'),
    ]);
    expect(result.rows.map((row) => row.values[id('Updated')])).toEqual([
      at('2026-10-26T20:30:00.000Z'),
      at('2026-10-27T18:00:00.000Z'),
      at('2026-10-28T12:00:00.000Z'),
    ]);
    expect(result.rows.map((row) => row.values[score.id])).toEqual(['9', '8.5', undefined]);
    expect(result.rows.map((row) => row.values[id('Paid')])).toEqual([true, false, true]);
    expect(
      result.rows.map((row) => plainText(row.values[id('Notes')] as RichText | undefined)),
    ).toEqual(['Prefers mornings', '', 'Call first\nthen visit']);
    expect(result.problemCount).toBe(1);
    expect(result.problems).toMatchObject([{ row: 7, column: 'Score', value: 'n/a' }]);
  });

  it('reads the first visible sheet when none is chosen', () => {
    const r = readXlsxFile(workbook, { inflateRaw: inflate });
    expect(r.ok && [r.sheet, r.table]).toEqual(['Summary', [['Reviews by vendor']]]);
  });
});
