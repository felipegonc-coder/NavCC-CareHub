// Reading an import's file (decision 0200, spec 3.7; security #212): CSV or Excel bytes become the
// column plan, the type guessed for each column, the rows to add and the problems, through
// '@carehub/databases/csv' and '/xlsx'. import.ts runs this file as a worker thread with memory and
// time limits, so a file that makes the readers misbehave only costs that thread. Nothing here
// touches the database: the caller passes in everything reading needs.
import { validateValue } from '@carehub/databases/values';
import type { Id, Property, SelectOption, StatusOption } from '@carehub/databases';
import {
  MAX_LISTED_PROBLEMS,
  buildImport,
  columnValues,
  guessType,
  matchColumns,
  readCsvFile,
  splitTable,
  validatePlan,
  type ColumnPlan,
  type CsvSeparator,
  type CsvSheet,
  type GuessedType,
  type ImportContext,
  type ImportProblem,
  type ImportResult,
  type ImportedRow,
} from '@carehub/databases/csv';
import {
  readXlsxFile,
  withExcelRowNumbers,
  type InflateRaw,
  type XlsxSheet,
} from '@carehub/databases/xlsx';
import { parentPort, workerData } from 'node:worker_threads';
import { inflateRawSync } from 'node:zlib';

/** Messages, word for word. None of them repeats anything from the file or the request. */
export const IMPORT_MESSAGES = {
  unreadable: "This file couldn't be read.",
  fileType: 'Choose a .csv, .tsv or .xlsx file.',
  noSheet: 'This file has no sheet with that name.',
  plan: "The columns don't fit this database anymore. Check them and try again.",
  notFinished: "This import hasn't finished yet.",
  failed: 'This import failed, so there is nothing to undo.',
  undone: 'This import was already undone.',
  tooLate: "This import can't be undone anymore.",
  changedSince: 'Some rows from this import changed since it ran, so nothing was moved to Trash.',
  gone: 'This database was deleted or moved to Trash.',
} as const;

/** The preview shows this many rows and problems; the import itself keeps them all. */
export const PREVIEW_ROWS = 20;
export const PREVIEW_PROBLEMS = 100;

/** The uploaded file and the dialog's choices. */
export interface ImportFile {
  kind: 'csv' | 'xlsx';
  bytes: Uint8Array;
  /** Excel: the sheet to read (default: the first visible one). */
  sheet?: string | undefined;
  /** CSV: the separator (default: detected). */
  separator?: CsvSeparator | undefined;
  firstRowIsHeaders: boolean;
  /** The plan from the dialog; matched from the headers when left out. */
  columns?: ColumnPlan[] | undefined;
}

/** The database as the importer sees it, and what reading values needs. */
export interface ImportTarget {
  /** The properties the importer can see, in order. */
  properties: Property[];
  /** The ids of those they can't change: no column fills them. */
  fixed: Id[];
  /** Names of the properties they can't see: new properties never take them. */
  otherNames: string[];
  canAddProperties: boolean;
  viewer: { timeZone: string; now: Date };
  /** Workspace members, for Person columns. */
  people: { id: string; name: string; email: string }[];
  /** For relation columns: by database id, the rows the importer can open, oldest first. */
  rows: Record<Id, { id: string; title: string }[]>;
}

export interface ReadImportInput {
  /** 'preview' keeps the first PREVIEW_ROWS rows and PREVIEW_PROBLEMS problems. */
  mode: 'preview' | 'import';
  file: ImportFile;
  target: ImportTarget;
}

/** A column of the plan with the type its values look like. */
export interface PreviewColumn extends ColumnPlan {
  guessedType: GuessedType;
}

export type ImportReading =
  /** `sheets` when the workbook opened, so another sheet can be picked. */
  | { ok: false; error: string; sheets?: XlsxSheet[] }
  | {
      ok: true;
      /** CSV: the separator used. */
      separator: CsvSeparator | null;
      /** Excel: the sheets and the one read. */
      sheets: XlsxSheet[] | null;
      sheet: string | null;
      columns: PreviewColumn[];
      /** Rows to add (rows with every cell empty are left out). */
      rowCount: number;
      /** With Excel's row numbers for Excel files. */
      rows: ImportedRow[];
      newProperties: Property[];
      newOptions: Record<Id, SelectOption[]>;
      problems: ImportProblem[];
      problemCount: number;
    };

type Table =
  | {
      ok: true;
      table: string[][];
      skippedRows: number;
      separator: CsvSeparator | null;
      sheets: XlsxSheet[] | null;
      sheet: string | null;
    }
  | { ok: false; error: string; sheets?: XlsxSheet[] };

const inflateRaw: InflateRaw = (bytes, max) => inflateRawSync(bytes, { maxOutputLength: max });

function readTable(file: ImportFile): Table {
  if (file.kind === 'csv') {
    const read = readCsvFile(file.bytes, {
      firstRowIsHeaders: file.firstRowIsHeaders,
      ...(file.separator ? { separator: file.separator } : {}),
    });
    if (!read.ok) return { ok: false, error: read.error };
    const { table, separator } = read;
    return { ok: true, table, skippedRows: 0, separator, sheets: null, sheet: null };
  }
  const read = readXlsxFile(file.bytes, {
    inflateRaw,
    sheet: file.sheet,
    firstRowIsHeaders: file.firstRowIsHeaders,
  });
  if (read.ok) {
    const { table, skippedRows, sheets, sheet } = read;
    return { ok: true, table, skippedRows, separator: null, sheets, sheet };
  }
  // The reader's message for a missing sheet repeats its name; this one doesn't.
  const missing = file.sheet !== undefined && read.sheets?.every((s) => s.name !== file.sheet);
  const error = missing ? IMPORT_MESSAGES.noSheet : read.error;
  return read.sheets ? { ok: false, error, sheets: read.sheets } : { ok: false, error };
}

const nameKey = (s: string) => s.replace(/\s+/g, '').toLowerCase();

/** A column's name as the plan shows it: its header, or "Column 3" when it has none. */
const headerOf = (sheet: CsvSheet, index: number) =>
  (sheet.headers[index] ?? '').replace(/\s+/g, ' ').trim() || `Column ${index + 1}`;

/** `name`, or "name 2", "name 3"... when a property already has it (in any case or spacing). */
function freeName(name: string, taken: Set<string>): string {
  let free = name;
  for (let n = 2; taken.has(nameKey(free)); n++) {
    const suffix = ` ${n}`;
    free = `${[...name]
      .slice(0, 100 - suffix.length)
      .join('')
      .trimEnd()}${suffix}`;
  }
  taken.add(nameKey(free));
  return free;
}

/** The first plan: matched by name, skipping what the importer can't fill. */
function firstPlan(sheet: CsvSheet, target: ImportTarget): ColumnPlan[] {
  const fixed = new Set(target.fixed);
  const plan = matchColumns(sheet.headers, target.properties, sheet.rows, {
    canAddProperties: target.canAddProperties,
  });
  const taken = new Set(
    [...target.properties.map((p) => p.name), ...target.otherNames].map(nameKey),
  );
  return plan.map((column): ColumnPlan => {
    const t = column.target;
    if (t.kind === 'existing' && fixed.has(t.propertyId)) {
      return { ...column, target: { kind: 'skip' } };
    }
    if (t.kind === 'new') return { ...column, target: { ...t, name: freeName(t.name, taken) } };
    return column;
  });
}

/**
 * A plan sent by the dialog, with the file's own headers; null when it doesn't fit the file or
 * the database (each column once, targets the importer can fill, new names free).
 */
function checkedPlan(
  columns: readonly ColumnPlan[],
  sheet: CsvSheet,
  target: ImportTarget,
): ColumnPlan[] | null {
  const width = sheet.headers.length;
  const seen = new Set<number>();
  const fixed = new Set(target.fixed);
  const hidden = new Set(target.otherNames.map(nameKey));
  for (const { index, target: t } of columns) {
    if (!Number.isInteger(index) || index < 0 || index >= width || seen.has(index)) return null;
    seen.add(index);
    if (t.kind === 'existing' && fixed.has(t.propertyId)) return null;
    if (t.kind === 'new' && (!target.canAddProperties || hidden.has(nameKey(t.name)))) return null;
  }
  const plan = columns.map((c) => ({ ...c, header: headerOf(sheet, c.index) }));
  return validatePlan(plan, target.properties) === null ? plan : null;
}

function contextFor(target: ImportTarget): ImportContext {
  const byName = new Map<string, Id | null>();
  const byEmail = new Map<string, Id>();
  for (const person of target.people) {
    // Two members with one name: neither is picked.
    byName.set(person.name, byName.has(person.name) ? null : person.id);
    const email = person.email.toLowerCase();
    if (!byEmail.has(email)) byEmail.set(email, person.id);
  }
  const titles = new Map<Id, Map<string, Id[]>>();
  const rowsOf = (databaseId: Id) => {
    let found = titles.get(databaseId);
    if (!found) {
      found = new Map();
      for (const row of target.rows[databaseId] ?? []) {
        const ids = found.get(row.title);
        if (ids) ids.push(row.id);
        else found.set(row.title, [row.id]);
      }
      titles.set(databaseId, found);
    }
    return found;
  };
  return {
    viewer: target.viewer,
    findUser: (text) => byName.get(text) ?? byEmail.get(text.toLowerCase()),
    findRows: (databaseId, title) => rowsOf(databaseId).get(title) ?? [],
  };
}

/**
 * Runs every value through validateValue, as the row writes will: a value it refuses is left
 * empty and listed as a problem (with the cell's text), so the rows can still be added.
 */
function checkValues(
  result: ImportResult,
  plan: readonly ColumnPlan[],
  sheet: CsvSheet,
  properties: readonly Property[],
): ImportResult {
  const props = new Map<Id, Property>();
  for (const p of properties) props.set(p.id, withOptions(p, result.newOptions[p.id] ?? []));
  for (const p of result.newProperties) props.set(p.id, p);
  // Each property's column, for the problem list.
  const columnOf = new Map<Id, ColumnPlan>();
  const newIds = new Map(result.newProperties.map((p) => [nameKey(p.name), p.id]));
  for (const column of plan) {
    const t = column.target;
    if (t.kind === 'existing') columnOf.set(t.propertyId, column);
    else if (t.kind === 'new') {
      const id = newIds.get(nameKey(t.name.trim()));
      if (id) columnOf.set(id, column);
    }
  }
  const title = properties.find((p) => p.config.type === 'title');
  const found: ImportProblem[] = [];
  const cell = (row: ImportedRow, column: ColumnPlan | undefined) =>
    column ? (sheet.rows[row.rowNumber - sheet.firstRowNumber]?.[column.index] ?? '') : '';
  const refuse = (row: ImportedRow, id: Id, reason: string) => {
    const column = columnOf.get(id);
    found.push({
      row: row.rowNumber,
      column: column?.header ?? '',
      value: cell(row, column),
      reason,
    });
  };
  const rows = result.rows.map((row): ImportedRow => {
    const values: Record<Id, unknown> = {};
    for (const [id, value] of Object.entries(row.values)) {
      const prop = props.get(id);
      if (!prop) continue;
      const checked = validateValue(prop, value);
      if (!checked.ok) refuse(row, id, checked.error);
      else if (checked.value !== null) values[id] = checked.value;
    }
    let name = row.title;
    if (title && name) {
      const checked = validateValue(title, name);
      if (!checked.ok) refuse(row, title.id, checked.error);
      name = checked.ok && typeof checked.value === 'string' ? checked.value : '';
    }
    return { ...row, title: name, values };
  });
  if (!found.length) return { ...result, rows };
  // File order, as buildImport lists its own (a stable sort keeps a row's problems in order).
  const problems = [...result.problems, ...found]
    .sort((a, b) => a.row - b.row)
    .slice(0, MAX_LISTED_PROBLEMS);
  return { ...result, rows, problems, problemCount: result.problemCount + found.length };
}

/** The property with the options the import adds to it. */
export function withOptions(p: Property, added: readonly SelectOption[]): Property {
  const c = p.config;
  if (!added.length) return p;
  if (c.type === 'select' || c.type === 'multi_select') {
    return { ...p, config: { ...c, options: [...c.options, ...added] } };
  }
  // readCell makes Status options with their group.
  if (c.type === 'status') {
    return { ...p, config: { ...c, options: [...c.options, ...(added as StatusOption[])] } };
  }
  return p;
}

/** Reads the file with the plan (or the first plan), as the preview shows it or the job adds it. */
export function readImport({ mode, file, target }: ReadImportInput): ImportReading {
  const read = readTable(file);
  if (!read.ok) return read;
  const sheet = splitTable(read.table, file.firstRowIsHeaders);
  const plan = file.columns ? checkedPlan(file.columns, sheet, target) : firstPlan(sheet, target);
  if (!plan) return { ok: false, error: IMPORT_MESSAGES.plan };
  const built = buildImport(read.table, plan, target.properties, contextFor(target), {
    firstRowIsHeaders: file.firstRowIsHeaders,
  });
  const result = withExcelRowNumbers(
    checkValues(built, plan, sheet, target.properties),
    read.skippedRows,
  );
  const preview = mode === 'preview';
  return {
    ok: true,
    separator: read.separator,
    sheets: read.sheets,
    sheet: read.sheet,
    columns: plan.map((c) => ({ ...c, guessedType: guessType(columnValues(sheet.rows, c.index)) })),
    rowCount: result.rows.length,
    rows: preview ? result.rows.slice(0, PREVIEW_ROWS) : result.rows,
    newProperties: result.newProperties,
    newOptions: result.newOptions,
    problems: preview ? result.problems.slice(0, PREVIEW_PROBLEMS) : result.problems,
    problemCount: result.problemCount,
  };
}

/** Marks the worker's data, so importing this file elsewhere never starts reading. */
export const WORKER_MARK = 'carehubImportReading';

const job = workerData as { [WORKER_MARK]?: ReadImportInput } | null;
const input = job?.[WORKER_MARK];
if (parentPort && input) parentPort.postMessage(readImport(input));
