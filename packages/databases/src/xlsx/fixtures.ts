/**
 * Small .zip and .xlsx files built in memory for the xlsx tests (fictional data only). Entries are
 * stored unless a test passes a deflate function (the tests use node:zlib), so this file needs no
 * Node APIs. Relationship ids and sheetIds run backwards, so only <sheets> gives the sheet order.
 */
import { crc32 } from './zip';

/** UTF-8 bytes of a string. */
export function utf8(s: string): Uint8Array {
  const out: number[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else {
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 63),
        0x80 | ((cp >> 6) & 63),
        0x80 | (cp & 63),
      );
    }
  }
  return Uint8Array.from(out);
}

export interface FixtureEntry {
  name: string;
  data: string | Uint8Array;
  /** Deflates the data (method 8); the entry is stored without it. */
  deflate?: (data: Uint8Array) => Uint8Array;
  /** Overrides for files that must be refused. */
  flags?: number;
  method?: number;
  crc?: number;
  size?: number;
  compressedSize?: number;
  /** CRC and sizes in a data descriptor after the data (flag bit 3), zero in the local header. */
  dataDescriptor?: boolean;
  /** Overrides in the local header only, so that it disagrees with the central directory. */
  local?: { name?: string; method?: number; crc?: number; size?: number };
  /** Where the central directory says the local header is, instead of where it was written. */
  offset?: number;
  /** Writes only the central directory record (with `offset`, entries can share bytes). */
  centralOnly?: boolean;
}

/** Little-endian fields [offset, 2 or 4 bytes, value] in a buffer of `length` bytes. */
function record(length: number, fields: [number, 2 | 4, number][]): Uint8Array {
  const out = new Uint8Array(length);
  const view = new DataView(out.buffer);
  for (const [at, size, value] of fields) {
    if (size === 2) view.setUint16(at, value, true);
    else view.setUint32(at, value >>> 0, true);
  }
  return out;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** A zip file with these entries, in order. */
export function zipFile(entries: readonly FixtureEntry[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const data = typeof e.data === 'string' ? utf8(e.data) : e.data;
    const body = e.deflate ? e.deflate(data) : data;
    const name = utf8(e.name);
    const method = e.method ?? (e.deflate ? 8 : 0);
    const flags = (e.flags ?? 0) | 0x800 | (e.dataDescriptor ? 8 : 0);
    const crc = e.crc ?? crc32(data);
    const size = e.size ?? data.length;
    const packed = e.compressedSize ?? body.length;
    const inHeader = (v: number) => (e.dataDescriptor ? 0 : v);
    const localName = e.local?.name === undefined ? name : utf8(e.local.name);
    const header = record(30 + localName.length, [
      [0, 4, 0x04034b50],
      [4, 2, 20],
      [6, 2, flags],
      [8, 2, e.local?.method ?? method],
      [14, 4, inHeader(e.local?.crc ?? crc)],
      [18, 4, inHeader(packed)],
      [22, 4, inHeader(e.local?.size ?? size)],
      [26, 2, localName.length],
    ]);
    header.set(localName, 30);
    const descriptor = e.dataDescriptor
      ? [
          record(16, [
            [0, 4, 0x08074b50],
            [4, 4, crc],
            [8, 4, packed],
            [12, 4, size],
          ]),
        ]
      : [];
    const cd = record(46 + name.length, [
      [0, 4, 0x02014b50],
      [4, 2, 20],
      [6, 2, 20],
      [8, 2, flags],
      [10, 2, method],
      [16, 4, crc],
      [20, 4, packed],
      [24, 4, size],
      [28, 2, name.length],
      [42, 4, e.offset ?? offset],
    ]);
    cd.set(name, 46);
    central.push(cd);
    if (e.centralOnly) continue;
    parts.push(header, body, ...descriptor);
    offset += header.length + body.length + (descriptor[0]?.length ?? 0);
  }
  const directory = concat(central);
  const end = record(22, [
    [0, 4, 0x06054b50],
    [8, 2, entries.length],
    [10, 2, entries.length],
    [12, 4, directory.length],
    [16, 4, offset],
  ]);
  return concat([...parts, directory, end]);
}

export const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const DOC = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';

export interface FixtureSheet {
  name: string;
  /** The inside of <sheetData>. */
  rows?: string;
  /** A whole worksheet part instead (bytes for big ones). */
  xml?: string | Uint8Array;
  state?: 'hidden' | 'veryHidden';
  /** A chart sheet (no cells). */
  chart?: boolean;
}

export interface FixtureWorkbook {
  sheets: FixtureSheet[];
  /** Shared strings as plain text. */
  strings?: string[];
  /** The inside of <sst> instead, for rich text and phonetic runs. */
  sst?: string;
  /** Custom number formats by id. */
  numFmts?: Record<number, string>;
  /** The numFmtId of each cell style (s="0", s="1"...). Default: [0]. */
  cellXfs?: number[];
  date1904?: boolean;
  deflate?: (data: Uint8Array) => Uint8Array;
  /** Leave out these parts (for example "xl/workbook.xml"). */
  without?: string[];
}

/** An .xlsx file with these sheets, shared strings and styles. */
export function xlsxFile(book: FixtureWorkbook): Uint8Array {
  const n = book.sheets.length;
  const kind = (s: FixtureSheet) => (s.chart ? 'chartsheet' : 'worksheet');
  const sheets = book.sheets
    .map((s, k) => {
      const state = s.state ? ` state="${s.state}"` : '';
      return `<sheet name="${esc(s.name)}" sheetId="${n - k}"${state} r:id="rId${n - k}"/>`;
    })
    .join('');
  const sheetRels = book.sheets
    .map(
      (s, k) =>
        `<Relationship Id="rId${n - k}" Type="${DOC}/${kind(s)}" Target="${kind(s)}s/sheet${k + 1}.xml"/>`,
    )
    .reverse()
    .join('');
  const numFmts = Object.entries(book.numFmts ?? {})
    .map(([id, code]) => `<numFmt numFmtId="${id}" formatCode="${esc(code)}"/>`)
    .join('');
  const xfs = (book.cellXfs ?? [0])
    .map((id) => `<xf numFmtId="${id}" fontId="0" xfId="0"/>`)
    .join('');
  const strings = (book.strings ?? []).map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`);
  const parts: [string, string | Uint8Array][] = [
    [
      '[Content_Types].xml',
      `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`,
    ],
    [
      '_rels/.rels',
      `${HEAD}<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${DOC}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ],
    [
      'xl/workbook.xml',
      `${HEAD}<workbook xmlns="${MAIN}" xmlns:r="${DOC}"><workbookPr${book.date1904 ? ' date1904="1"' : ''}/><bookViews><workbookView activeTab="0"/></bookViews><sheets>${sheets}</sheets></workbook>`,
    ],
    [
      'xl/_rels/workbook.xml.rels',
      `${HEAD}<Relationships xmlns="${PKG}">${sheetRels}<Relationship Id="rIdS" Type="${DOC}/styles" Target="styles.xml"/><Relationship Id="rIdT" Type="${DOC}/sharedStrings" Target="/xl/sharedStrings.xml"/></Relationships>`,
    ],
    [
      'xl/styles.xml',
      `${HEAD}<styleSheet xmlns="${MAIN}"><numFmts>${numFmts}</numFmts><cellStyleXfs count="1"><xf numFmtId="14"/></cellStyleXfs><cellXfs>${xfs}</cellXfs><dxfs count="1"><dxf><numFmt numFmtId="164" formatCode="0.00"/></dxf></dxfs></styleSheet>`,
    ],
    ['xl/sharedStrings.xml', `${HEAD}<sst xmlns="${MAIN}">${book.sst ?? strings.join('')}</sst>`],
    ...book.sheets.map((s, k): [string, string | Uint8Array] => [
      `xl/${kind(s)}s/sheet${k + 1}.xml`,
      s.xml ??
        `${HEAD}<${kind(s)} xmlns="${MAIN}" xmlns:r="${DOC}"><dimension ref="A1"/><sheetData>${s.rows ?? ''}</sheetData><pageMargins left="0.7"/></${kind(s)}>`,
    ]),
  ];
  const deflate = book.deflate;
  return zipFile(
    parts
      .filter(([name]) => !book.without?.includes(name))
      .map(([name, data]) => (deflate ? { name, data, deflate } : { name, data })),
  );
}
