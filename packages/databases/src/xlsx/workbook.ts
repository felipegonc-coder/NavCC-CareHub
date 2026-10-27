/**
 * Opening an .xlsx workbook for import (spec 3.7, "or Excel .xlsx: pick the sheet"): its
 * worksheets in workbook order, the shared strings, which cell styles show dates, and the date
 * system. Chart sheets aren't listed (they have no cells).
 */
import { decodeCsvBytes } from '../csv/decode';
import { checkCsvSize } from '../csv/parse';
import { builtInDateStyle, dateStyleOf, type DateStyle } from './numfmt';
import { XmlError, xmlTokens, type XmlToken } from './xml';
import {
  readZip,
  readZipEntry,
  ZIP_LIMITS,
  type InflateRaw,
  type ZipArchive,
  type ZipEntry,
  type ZipProblem,
} from './zip';

const grouped = new Intl.NumberFormat('en-US');
const mb = (bytes: number) => `${bytes / (1024 * 1024)} MB`;

/** Messages for files that can't be read (the CSV limits keep the CSV messages). */
export const XLSX_ERRORS = {
  notXlsx: "This file isn't an Excel workbook (.xlsx).",
  oldOrPassword:
    'This file has a password or is an older .xls file. Save it as .xlsx without a password and try again.',
  password: 'This file has a password. Save a copy without one and try again.',
  damaged: "This file can't be read. Save it again as .xlsx and try again.",
  tooManyParts: `This file has more than ${grouped.format(ZIP_LIMITS.entries)} parts.`,
  partTooBig: `Part of this file is larger than ${mb(ZIP_LIMITS.entryBytes)} once unpacked.`,
  tooBig: `This file is larger than ${mb(ZIP_LIMITS.totalBytes)} once unpacked.`,
  noSheets: 'This file has no sheets.',
} as const;

/** "This file has no sheet named 'Q3 reviews'." */
export const noSuchSheet = (name: string): string => `This file has no sheet named '${name}'.`;

const ZIP_MESSAGES: Record<ZipProblem, string> = {
  not_zip: XLSX_ERRORS.notXlsx,
  damaged: XLSX_ERRORS.damaged,
  unsupported: XLSX_ERRORS.damaged,
  encrypted: XLSX_ERRORS.password,
  too_many_entries: XLSX_ERRORS.tooManyParts,
  entry_too_big: XLSX_ERRORS.partTooBig,
  too_big: XLSX_ERRORS.tooBig,
};

/** A worksheet as the sheet picker lists it. */
export interface XlsxSheet {
  name: string;
  /** Hidden in Excel (hidden or very hidden). */
  hidden: boolean;
}

/** An opened workbook: everything needed to read any of its sheets. */
export interface XlsxFile {
  /** Worksheets in workbook order. */
  sheets: XlsxSheet[];
  /** Dates count from 1904 (older Mac workbooks) instead of 1900. */
  date1904: boolean;
  /** Shared strings, by index. */
  strings: string[];
  /** The date style of each cell style (a cell's s attribute), null for plain numbers. */
  styles: (DateStyle | null)[];
  /** Each sheet's part in the zip, by sheet name. */
  parts: Map<string, ZipEntry>;
  zip: ZipArchive;
  inflateRaw: InflateRaw;
  /** Size of the uploaded file, for the CSV limits. */
  byteLength: number;
}

export type XlsxOpen = { ok: true; file: XlsxFile } | { ok: false; error: string };

/** Thrown inside the reader with the message to show; turned into { ok: false, error } at the edge. */
export class XlsxFailure extends Error {
  override name = 'XlsxFailure';
}

/** The message for an error thrown while reading; anything else is a bug and is thrown again. */
export function failureMessage(e: unknown): string {
  if (e instanceof XlsxFailure) return e.message;
  if (e instanceof XmlError) return XLSX_ERRORS.damaged;
  throw e;
}

/** Cell text as CSV import gets it: Excel's _x000D_ escapes decoded, CRLF and CR as "\n", no NUL. */
export function cleanCellText(s: string): string {
  const t = s.includes('_x')
    ? s.replace(/_x([\da-fA-F]{4})_/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    : s;
  return t.replace(/\r\n?/g, '\n').replaceAll('\u0000', '');
}

/** Collects the text of a string item (<si> or <is>): its <t> runs, without phonetic guides (<rPh>). */
export class RichText {
  private readonly parts: string[] = [];
  private inText = false;
  private phonetic = 0;

  /** Follows one token inside the item. */
  take(tok: XmlToken): void {
    if (tok.kind === 'text') {
      if (this.inText && this.phonetic === 0) this.parts.push(tok.text);
    } else if (tok.name === 'rPh') {
      if (tok.kind === 'close') this.phonetic = Math.max(0, this.phonetic - 1);
      else if (!tok.selfClosing) this.phonetic++;
    } else if (tok.name === 't') {
      this.inText = tok.kind === 'open' && !tok.selfClosing;
    }
  }

  done(): string {
    return cleanCellText(this.parts.join(''));
  }
}

/** Reads and decodes one part; throws XlsxFailure if the zip says no. */
export function readPart(file: Pick<XlsxFile, 'zip' | 'inflateRaw'>, entry: ZipEntry): string {
  const r = readZipEntry(file.zip, entry, file.inflateRaw);
  if (!r.ok) throw new XlsxFailure(ZIP_MESSAGES[r.problem]);
  return decodeCsvBytes(r.bytes);
}

interface Relationship {
  type: string;
  /** Resolved part name. */
  target: string;
}

/** A relationship target as a part name, relative to the part that points to it. */
function resolvePart(from: string, target: string): string {
  const parts = target.startsWith('/') ? [] : from.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg && seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

/** The relationships of a part ("xl/workbook.xml" reads "xl/_rels/workbook.xml.rels"), by id. */
function relationships(
  read: (name: string) => string | null,
  part: string,
): Map<string, Relationship> {
  const slash = part.lastIndexOf('/') + 1;
  const xml = read(`${part.slice(0, slash)}_rels/${part.slice(slash)}.rels`);
  const rels = new Map<string, Relationship>();
  for (const tok of xml === null ? [] : xmlTokens(xml)) {
    if (tok.kind !== 'open' || tok.name !== 'Relationship') continue;
    const target = tok.attrs.get('Target');
    if (!target || tok.attrs.get('TargetMode') === 'External') continue;
    rels.set(tok.attrs.get('Id') ?? '', {
      type: tok.attrs.get('Type') ?? '',
      target: resolvePart(part, target),
    });
  }
  return rels;
}

const ofType = (rels: Map<string, Relationship>, type: string): string | undefined =>
  [...rels.values()].find((r) => r.type.endsWith(`/${type}`))?.target;

function sharedStrings(xml: string | null): string[] {
  const out: string[] = [];
  let item: RichText | null = null;
  for (const tok of xml === null ? [] : xmlTokens(xml)) {
    if (tok.kind !== 'text' && tok.name === 'si') {
      if (tok.kind === 'close') {
        out.push(item?.done() ?? '');
        item = null;
      } else if (tok.selfClosing) out.push('');
      else item = new RichText();
    } else item?.take(tok);
  }
  return out;
}

/** The date style of each cell style in <cellXfs>; custom formats (<numFmts>) win over built-in ids. */
function cellStyles(xml: string | null): (DateStyle | null)[] {
  const formats = new Map<number, string>();
  const ids: number[] = [];
  let section = '';
  for (const tok of xml === null ? [] : xmlTokens(xml)) {
    if (tok.kind === 'close') {
      if (tok.name === section) section = '';
    } else if (tok.kind === 'open') {
      const id = Number(tok.attrs.get('numFmtId') ?? 0);
      if (tok.name === 'numFmts' || tok.name === 'cellXfs')
        section = tok.selfClosing ? '' : tok.name;
      else if (tok.name === 'numFmt' && section === 'numFmts') {
        formats.set(id, tok.attrs.get('formatCode') ?? '');
      } else if (tok.name === 'xf' && section === 'cellXfs') ids.push(id);
    }
  }
  return ids.map((id) => {
    const code = formats.get(id);
    return code === undefined ? builtInDateStyle(id) : dateStyleOf(code);
  });
}

const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

/**
 * Opens an uploaded .xlsx file: the 10 MB limit (CSV's message), the zip checks, then the workbook,
 * its sheets, shared strings and styles. `inflateRaw` is the server's inflater (see InflateRaw).
 */
export function openXlsx(bytes: Uint8Array, inflateRaw: InflateRaw): XlsxOpen {
  const tooBig = checkCsvSize(bytes.length);
  if (tooBig) return { ok: false, error: tooBig };
  if (OLE.every((b, i) => bytes[i] === b)) return { ok: false, error: XLSX_ERRORS.oldOrPassword };
  const opened = readZip(bytes);
  if (!opened.ok) return { ok: false, error: ZIP_MESSAGES[opened.problem] };
  const { zip } = opened;
  const byName = new Map(zip.entries.map((e) => [e.name.toLowerCase(), e]));
  const read = (name: string): string | null => {
    const entry = byName.get(name.toLowerCase());
    return entry ? readPart({ zip, inflateRaw }, entry) : null;
  };
  try {
    const book = ofType(relationships(read, ''), 'officeDocument') ?? 'xl/workbook.xml';
    const xml = read(book);
    if (xml === null) return { ok: false, error: XLSX_ERRORS.notXlsx };
    const rels = relationships(read, book);
    const sheets: XlsxSheet[] = [];
    const parts = new Map<string, ZipEntry>();
    let date1904 = false;
    for (const tok of xmlTokens(xml)) {
      if (tok.kind !== 'open') continue;
      if (tok.name === 'workbookPr') {
        date1904 = ['1', 'true'].includes(tok.attrs.get('date1904') ?? '');
      } else if (tok.name === 'sheet') {
        const name = tok.attrs.get('name') ?? '';
        const id = [...tok.attrs].find(([k]) => k.endsWith(':id'))?.[1] ?? '';
        const rel = rels.get(id);
        const entry = rel?.type.endsWith('/worksheet')
          ? byName.get(rel.target.toLowerCase())
          : null;
        if (!entry || parts.has(name)) continue;
        sheets.push({
          name,
          hidden: ['hidden', 'veryHidden'].includes(tok.attrs.get('state') ?? ''),
        });
        parts.set(name, entry);
      }
    }
    if (!sheets.length) return { ok: false, error: XLSX_ERRORS.noSheets };
    const strings = sharedStrings(read(ofType(rels, 'sharedStrings') ?? 'xl/sharedStrings.xml'));
    const styles = cellStyles(read(ofType(rels, 'styles') ?? 'xl/styles.xml'));
    const file = {
      sheets,
      date1904,
      strings,
      styles,
      parts,
      zip,
      inflateRaw,
      byteLength: bytes.length,
    };
    return { ok: true, file };
  } catch (e) {
    return { ok: false, error: failureMessage(e) };
  }
}

/** The workbook's worksheets in workbook order, hidden ones marked. */
export function listSheets(file: XlsxFile): XlsxSheet[] {
  return file.sheets.map((s) => ({ ...s }));
}
