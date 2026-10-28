/**
 * The Import CSV dialog's logic (spec 3.7): checks a picked file, builds the preview and import
 * requests, and reads the server's answers. Until core files is on main, the file goes in the body
 * as base64, at most 10 MB (decision 0200).
 */
import {
  findPropertyByName,
  LIMITS,
  type Id,
  type Property,
  type SelectOption,
  type StatusOption,
} from '@carehub/databases';
import {
  checkCsvSize,
  CSV_SEPARATORS,
  importSummary,
  NEW_PROPERTY_TYPES,
  type ColumnPlan,
  type ColumnTarget,
  type CsvSeparator,
  type ImportedRow,
  type ImportProblem,
  type NewPropertyType,
} from '@carehub/databases/csv';
import type { XlsxSheet } from '@carehub/databases/xlsx';
import { isApiError, UNKNOWN_ERROR_MESSAGE, type ImportRequest } from '../api';
import { IMPORT_TEXT } from './import-text';

export type FileKind = 'csv' | 'xlsx';

/** The picked file as the requests send it. */
export interface PickedFile {
  name: string;
  kind: FileKind;
  /** The file's bytes as base64. */
  data: string;
}

/** The dialog's options. Changing one asks for a fresh plan, so columns aren't kept with them. */
export interface ImportChoices {
  firstRowIsHeaders: boolean;
  /** CSV only: detected by the server unless picked. */
  separator?: CsvSeparator | undefined;
  /** Excel only: the first visible sheet unless picked. */
  sheet?: string | undefined;
}

export interface PreviewColumn extends ColumnPlan {
  /** The type guessed from the column's values, for when it becomes a new property. */
  guessedType: NewPropertyType;
}

/** The answer of POST /:id/import/preview. */
export interface ImportPreview {
  kind: FileKind;
  separator: CsvSeparator | null;
  sheets: XlsxSheet[] | null;
  sheet: string | null;
  firstRowIsHeaders: boolean;
  columns: PreviewColumn[];
  /** Rows the import would add. */
  rowCount: number;
  /** The first of them (20), as they would be saved. */
  rows: ImportedRow[];
  /** The properties the import would make, in column order. */
  newProperties: Property[];
  /** Options it would add to existing properties, by property id. */
  newOptions: Record<Id, SelectOption[]>;
  /** The first problems, in file order. */
  problems: ImportProblem[];
  problemCount: number;
}

/** An import the server has taken (202). */
export interface ImportStarted {
  importId: Id;
  jobId: Id;
}

/** What the summary says once the job is done. */
export interface ImportOutcome {
  rowCount: number;
  problemCount: number;
  summary: string;
}

// ---------------------------------------------------------------- the file

/** CSV (.csv, .tsv) or Excel (.xlsx), by the file's name; null for anything else. */
export function fileKind(name: string): FileKind | null {
  const extension = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  if (extension === 'csv' || extension === 'tsv') return 'csv';
  if (extension === 'xlsx') return 'xlsx';
  return null;
}

/** Why a picked file can't be imported, checked before it's read; null when it can be. */
export function checkPickedFile(file: { name: string; size: number }): string | null {
  if (!fileKind(file.name)) return IMPORT_TEXT.fileType;
  if (file.size === 0) return IMPORT_TEXT.empty;
  return checkCsvSize(file.size);
}

/** The file's bytes as base64. */
export function readFileData(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = typeof reader.result === 'string' ? reader.result : '';
      resolve(url.slice(url.indexOf(',') + 1));
    };
    reader.onerror = () => reject(new Error(IMPORT_TEXT.unreadable));
    reader.readAsDataURL(file);
  });
}

// ---------------------------------------------------------------- requests

/** A column as the server's strict schema takes it (without guessedType). */
function planOnly(column: ColumnPlan): ColumnPlan {
  const t = column.target;
  const target: ColumnTarget =
    t.kind === 'existing'
      ? { kind: 'existing', propertyId: t.propertyId }
      : t.kind === 'new'
        ? { kind: 'new', name: t.name.trim(), type: t.type }
        : { kind: 'skip' };
  return { index: column.index, header: column.header, target };
}

/**
 * The body of POST /:id/import/preview and POST /:id/import: the file and the options, and the
 * columns once the person has seen a plan (left out, the server makes the first plan).
 */
export function importBody(
  file: PickedFile,
  choices: ImportChoices,
  columns?: readonly ColumnPlan[],
): ImportRequest {
  const body: Record<string, unknown> = {
    fileName: file.name,
    data: file.data,
    firstRowIsHeaders: choices.firstRowIsHeaders,
  };
  if (file.kind === 'csv' && choices.separator) body.separator = choices.separator;
  if (file.kind === 'xlsx' && choices.sheet) body.sheet = choices.sheet;
  if (columns) body.columns = columns.map(planOnly);
  // The client's type names an uploaded file (fileId), which comes with core files.
  return body as unknown as ImportRequest;
}

// ---------------------------------------------------------------- answers

type Json = Record<string, unknown>;

const isRecord = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const count = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
const isNewType = (v: unknown): v is NewPropertyType =>
  typeof v === 'string' && (NEW_PROPERTY_TYPES as readonly string[]).includes(v);
const isSeparator = (v: unknown): v is CsvSeparator =>
  typeof v === 'string' && (CSV_SEPARATORS as readonly string[]).includes(v);

function readTarget(v: unknown): ColumnTarget | null {
  if (!isRecord(v)) return null;
  if (v.kind === 'existing' && typeof v.propertyId === 'string') {
    return { kind: 'existing', propertyId: v.propertyId };
  }
  if (v.kind === 'new' && typeof v.name === 'string' && isNewType(v.type)) {
    return { kind: 'new', name: v.name, type: v.type };
  }
  return v.kind === 'skip' ? { kind: 'skip' } : null;
}

function readColumn(v: unknown): PreviewColumn | null {
  if (!isRecord(v) || typeof v.index !== 'number' || typeof v.header !== 'string') return null;
  const target = readTarget(v.target);
  if (!target) return null;
  const guessedType = isNewType(v.guessedType)
    ? v.guessedType
    : target.kind === 'new'
      ? target.type
      : 'text';
  return { index: v.index, header: v.header, target, guessedType };
}

function readRow(v: unknown): ImportedRow[] {
  if (!isRecord(v)) return [];
  return [
    {
      rowNumber: count(v.rowNumber),
      title: typeof v.title === 'string' ? v.title : '',
      values: isRecord(v.values) ? v.values : {},
    },
  ];
}

const isProperty = (v: unknown): v is Property =>
  isRecord(v) &&
  typeof v.id === 'string' &&
  typeof v.name === 'string' &&
  isRecord(v.config) &&
  typeof v.config.type === 'string';

const isProblem = (v: unknown): v is ImportProblem =>
  isRecord(v) &&
  typeof v.row === 'number' &&
  typeof v.column === 'string' &&
  typeof v.value === 'string' &&
  typeof v.reason === 'string';

/** The sheets of an Excel file, from a preview or from the details of a refused one. */
export function readSheets(v: unknown): XlsxSheet[] | null {
  if (!Array.isArray(v)) return null;
  return v.flatMap((s: unknown) =>
    isRecord(s) && typeof s.name === 'string' ? [{ name: s.name, hidden: s.hidden === true }] : [],
  );
}

function readOptions(v: unknown): Record<Id, SelectOption[]> {
  if (!isRecord(v)) return {};
  const out: Record<Id, SelectOption[]> = {};
  for (const [id, options] of Object.entries(v)) {
    if (Array.isArray(options)) out[id] = options as SelectOption[];
  }
  return out;
}

/** The preview, or null when the answer isn't one. */
export function readPreview(
  answer: unknown,
  sent: { kind: FileKind; choices: ImportChoices },
): ImportPreview | null {
  if (!isRecord(answer) || !Array.isArray(answer.columns)) return null;
  const read = answer.columns.map(readColumn);
  const columns = read.filter((c): c is PreviewColumn => c !== null);
  if (columns.length !== read.length) return null;
  return {
    kind: answer.kind === 'xlsx' || answer.kind === 'csv' ? answer.kind : sent.kind,
    separator: isSeparator(answer.separator) ? answer.separator : null,
    sheets: readSheets(answer.sheets),
    sheet: typeof answer.sheet === 'string' ? answer.sheet : null,
    firstRowIsHeaders:
      typeof answer.firstRowIsHeaders === 'boolean'
        ? answer.firstRowIsHeaders
        : sent.choices.firstRowIsHeaders,
    columns,
    rowCount: count(answer.rowCount),
    rows: list(answer.rows).flatMap(readRow),
    newProperties: list(answer.newProperties).filter(isProperty),
    newOptions: readOptions(answer.newOptions),
    problems: list(answer.problems).filter(isProblem),
    problemCount: count(answer.problemCount),
  };
}

/** The answer of POST /:id/import, or null when it isn't one. */
export function readStarted(answer: unknown): ImportStarted | null {
  if (!isRecord(answer)) return null;
  const { importId, jobId } = answer;
  return typeof importId === 'string' && typeof jobId === 'string' ? { importId, jobId } : null;
}

/** The import job's result: "Imported 412 rows. 3 values couldn't be read." */
export function readOutcome(result: unknown): ImportOutcome {
  const r = isRecord(result) ? result : {};
  const rowCount = count(r.rowCount);
  const problemCount = count(r.problemCount);
  const summary =
    typeof r.rowCount !== 'number' && typeof r.summary === 'string'
      ? r.summary
      : importSummary(rowCount, problemCount);
  return { rowCount, problemCount, summary };
}

/** How many rows Undo import moved to Trash (its answer lists them), else the imported count. */
export function undoneCount(answer: unknown, imported: number): number {
  return isRecord(answer) && Array.isArray(answer.rowIds) ? answer.rowIds.length : imported;
}

/** The server's words for a refused request, or the general ones. */
export function errorMessage(error: unknown): string {
  return isApiError(error) && error.message ? error.message : UNKNOWN_ERROR_MESSAGE;
}

/** The sheets listed with a refused Excel preview (so another one can be picked). */
export function errorSheets(error: unknown): XlsxSheet[] | null {
  return isApiError(error) && isRecord(error.details) ? readSheets(error.details.sheets) : null;
}

/** Where the problem list downloads as CSV (Row, Column, Value, Reason). */
export function problemsHref(databaseId: Id, importId: Id): string {
  const seg = encodeURIComponent;
  return `/api/databases/${seg(databaseId)}/imports/${seg(importId)}/problems`;
}

// ---------------------------------------------------------------- matching columns

/** A column's choice as a select's value: "existing:<property id>", "new" or "skip". */
export function targetValue(target: ColumnTarget): string {
  return target.kind === 'existing' ? `existing:${target.propertyId}` : target.kind;
}

const nameKey = (s: string) => s.replace(/\s+/g, '').toLowerCase();

/** The column's header as a new property's name, with " 2", " 3"… when it's taken. */
function freeName(
  column: ColumnPlan,
  plan: readonly ColumnPlan[],
  properties: readonly Property[],
): string {
  const taken = new Set(
    plan.flatMap((c) =>
      c.index !== column.index && c.target.kind === 'new' ? [nameKey(c.target.name)] : [],
    ),
  );
  const base = column.header.slice(0, LIMITS.propertyName - 3).trim();
  let name = base;
  for (let i = 2; findPropertyByName(properties, name) || taken.has(nameKey(name)); i++) {
    name = `${base} ${i}`;
  }
  return name;
}

/** The plan with one column's target replaced. */
export function withTarget<C extends ColumnPlan>(
  plan: readonly C[],
  index: number,
  target: ColumnTarget,
): C[] {
  return plan.map((c) => (c.index === index ? { ...c, target } : c));
}

/**
 * The plan after a column's select changes (`value` as targetValue makes it). A column that
 * becomes a new property is named after its header and gets the guessed type.
 */
export function chooseTarget(
  plan: readonly PreviewColumn[],
  index: number,
  value: string,
  properties: readonly Property[],
): PreviewColumn[] {
  return plan.map((c): PreviewColumn => {
    if (c.index !== index) return c;
    if (value === 'skip') return { ...c, target: { kind: 'skip' } };
    if (value === 'new') {
      if (c.target.kind === 'new') return c;
      const name = freeName(c, plan, properties);
      return { ...c, target: { kind: 'new', name, type: c.guessedType } };
    }
    const propertyId = value.replace(/^existing:/, '');
    return { ...c, target: { kind: 'existing', propertyId } };
  });
}

/** Whether any column fills a property (otherwise there is nothing to import). */
export const fillsSomething = (plan: readonly ColumnPlan[]): boolean =>
  plan.some((c) => c.target.kind !== 'skip');

// ---------------------------------------------------------------- the preview table

export interface ShownColumn {
  index: number;
  header: string;
  property: Property;
}

/** An existing property with the options the import would add to it. */
function withNewOptions(
  property: Property,
  options: readonly SelectOption[] | undefined,
): Property {
  const c = property.config;
  if (!options?.length) return property;
  if (c.type === 'select' || c.type === 'multi_select') {
    return { ...property, config: { ...c, options: [...c.options, ...options] } };
  }
  if (c.type === 'status') {
    return {
      ...property,
      config: { ...c, options: [...c.options, ...(options as StatusOption[])] },
    };
  }
  return property;
}

/** The preview table's columns: those that fill a property, with the property as the import would fill it. */
export function shownColumns(
  preview: ImportPreview,
  properties: readonly Property[],
): ShownColumn[] {
  const byId = new Map(properties.map((p) => [p.id, p]));
  const made = [...preview.newProperties];
  return preview.columns.flatMap((column): ShownColumn[] => {
    const t = column.target;
    const property =
      t.kind === 'existing' ? byId.get(t.propertyId) : t.kind === 'new' ? made.shift() : undefined;
    if (!property) return [];
    const options = t.kind === 'existing' ? preview.newOptions[t.propertyId] : undefined;
    return [
      { index: column.index, header: column.header, property: withNewOptions(property, options) },
    ];
  });
}

/** A preview row's value for a property (the title is kept apart). */
export function previewValue(row: ImportedRow, property: Property): unknown {
  return property.config.type === 'title' ? row.title : row.values[property.id];
}
