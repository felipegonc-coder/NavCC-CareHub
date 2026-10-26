/**
 * Building an import (spec 3.7, "Result"): the rows to add, the properties and options to create,
 * and the values that couldn't be read. Imports only add rows (DB-D3); the server adds them all or
 * none, runs validateValue on every value, and sends no notices.
 */
import { formatDecimal } from '../decimal';
import { defaultConfig, newProperty } from '../schema';
import {
  CURRENCIES,
  type ConfigOf,
  type DateFormat,
  type Id,
  type Property,
  type PropertyConfig,
  type SelectOption,
  type StatusOption,
} from '../types';
import {
  canImportInto,
  columnValues,
  dateOrder,
  splitTable,
  type ColumnPlan,
  type NewPropertyType,
} from './plan';
import { readCell, type ImportContext } from './read';
import { protectCell, writeCsv } from './write';

export interface ImportProblem {
  /** Row number as in the file (the header row is row 1). */
  row: number;
  /** The column's name (ColumnPlan.header). */
  column: string;
  value: string;
  reason: string;
}

export interface ImportedRow {
  /** Row number in the file, for problems found later (for example by validateValue on the server). */
  rowNumber: number;
  title: string;
  /** Property id → stored value. Empty cells are left out, so new-row defaults still apply. */
  values: Record<Id, unknown>;
}

export interface ImportResult {
  /** In file order, which is also the order IDs are numbered in. Rows with every cell empty are skipped. */
  rows: ImportedRow[];
  /** Properties to create first, with the options the import made. */
  newProperties: Property[];
  /** Options to add to existing properties, by property id. */
  newOptions: Record<Id, SelectOption[]>;
  /** The first MAX_LISTED_PROBLEMS problems, in file order. */
  problems: ImportProblem[];
  /** Every value that couldn't be read. */
  problemCount: number;
}

/** The problem list keeps this many; problemCount counts them all. */
export const MAX_LISTED_PROBLEMS = 10_000;

const cache: { currencySigns?: [string, string][] } = {};

/** Currency signs as exports write them ("CA$", "$", "€", "CHF "), longest first, with their codes. */
function currencySigns(): [string, string][] {
  cache.currencySigns ??= CURRENCIES.map((code): [string, string] => [
    formatDecimal('1', { format: 'currency', currency: code, decimals: 0 })
      .replace(/1$/, '')
      .replace(/\u00a0/g, ' '),
    code,
  ]).sort((a, b) => b[0].length - a[0].length);
  return cache.currencySigns;
}

/** Number format from the values, so an exported column shows the same again: percent, a currency, or commas. */
function numberConfig(values: readonly string[]): ConfigOf<'number'> {
  const config = defaultConfig('number');
  if (!values.length) return config;
  if (values.every((v) => v.endsWith('%'))) return { ...config, format: 'percent' };
  const bare = values.map((v) => v.replace(/^[(−-]\s*/, '').replace(/\u00a0/g, ' '));
  for (const [sign, currency] of currencySigns()) {
    if (bare.every((v) => v.startsWith(sign))) return { ...config, format: 'currency', currency };
  }
  return values.some((v) => /\d,\d{3}/.test(v)) ? { ...config, format: 'number_commas' } : config;
}

/** Date format from the values: 2026-10-26 → Year/Month/Day, 10/26/2026 → Month/Day/Year, 26/10/2026 → Day/Month/Year, else Full. */
function dateConfig(values: readonly string[]): ConfigOf<'date'> {
  let format: DateFormat = 'full';
  if (values.length && values.every((v) => /^\d{4}-\d{1,2}-\d{1,2}/.test(v))) format = 'ymd';
  else if (values.length && values.every((v) => /^\d{1,2}[/.]\d{1,2}[/.]\d{4}/.test(v))) {
    format = dateOrder(values) === 'day_first' ? 'dmy' : 'mdy';
  }
  return { type: 'date', format, timeFormat: 'viewer' };
}

/** Settings for a property the import creates, from its column's values. */
function newConfig(type: NewPropertyType, column: readonly string[]): PropertyConfig {
  const values = column.map((v) => v.trim()).filter((v) => v !== '');
  if (type === 'number') return numberConfig(values);
  if (type === 'date') return dateConfig(values);
  return defaultConfig(type);
}

/** A copy whose option list the import can add to (the caller's property is never changed). */
function ownOptions(prop: Property): Property {
  const c = prop.config;
  if (c.type === 'select' || c.type === 'multi_select' || c.type === 'status') {
    return { ...prop, config: { ...c, options: [...c.options] } as PropertyConfig };
  }
  return prop;
}

function addOptions(prop: Property, options: readonly SelectOption[]): void {
  const c = prop.config;
  if (c.type === 'select' || c.type === 'multi_select') c.options.push(...options);
  // readCell makes Status options with their group.
  else if (c.type === 'status') c.options.push(...(options as StatusOption[]));
}

/**
 * Reads a parsed file (`table`, header row included unless `firstRowIsHeaders` is false) with a
 * column plan. Each cell goes through readCell; values that can't be read are left empty and listed
 * as problems, and their rows are still imported. Targets that no longer exist or can't be filled
 * are ignored (check the plan with validatePlan first).
 */
export function buildImport(
  table: readonly string[][],
  plan: readonly ColumnPlan[],
  properties: readonly Property[],
  ctx: ImportContext,
  opts: { firstRowIsHeaders?: boolean } = {},
): ImportResult {
  const sheet = splitTable(table, opts.firstRowIsHeaders ?? true);
  const existing = new Map(properties.map((p) => [p.id, p]));
  const columns: { index: number; header: string; prop: Property }[] = [];
  const newProperties: Property[] = [];
  for (const column of plan) {
    const t = column.target;
    let prop: Property | undefined;
    if (t.kind === 'existing') {
      prop = existing.get(t.propertyId);
      if (!prop || !canImportInto(prop) || columns.some((c) => c.prop.id === t.propertyId)) {
        continue;
      }
      prop = ownOptions(prop);
    } else if (t.kind === 'new') {
      prop = newProperty(t.name.trim(), newConfig(t.type, columnValues(sheet.rows, column.index)));
      newProperties.push(prop);
    } else {
      continue;
    }
    columns.push({ index: column.index, header: column.header, prop });
  }

  const newOptions: Record<Id, SelectOption[]> = {};
  const rows: ImportedRow[] = [];
  const problems: ImportProblem[] = [];
  let problemCount = 0;
  sheet.rows.forEach((cells, k) => {
    if (cells.every((v) => !v.trim())) return;
    const row: ImportedRow = { rowNumber: sheet.firstRowNumber + k, title: '', values: {} };
    for (const { index, header, prop } of columns) {
      const value = cells[index] ?? '';
      const result = readCell(prop, value, ctx);
      if (!result.ok) {
        problemCount++;
        if (problems.length < MAX_LISTED_PROBLEMS) {
          problems.push({ row: row.rowNumber, column: header, value, reason: result.reason });
        }
        continue;
      }
      if (result.newOptions) {
        addOptions(prop, result.newOptions);
        if (existing.has(prop.id)) (newOptions[prop.id] ??= []).push(...result.newOptions);
      }
      if (prop.config.type === 'title') {
        row.title = typeof result.value === 'string' ? result.value : '';
      } else if (result.value !== null) {
        row.values[prop.id] = result.value;
      }
    }
    rows.push(row);
  });
  return { rows, newProperties, newOptions, problems, problemCount };
}

/** The downloadable problem list: Row, Column, Value, Reason. */
export function problemsCsv(problems: readonly ImportProblem[]): string {
  return writeCsv([
    ['Row', 'Column', 'Value', 'Reason'],
    ...problems.map((p) => [String(p.row), protectCell(p.column), protectCell(p.value), p.reason]),
  ]);
}

const grouped = new Intl.NumberFormat('en-US');

/** "Imported 412 rows. 3 values couldn't be read." (`problems`: the list, or problemCount). */
export function importSummary(count: number, problems: readonly ImportProblem[] | number): string {
  const n = typeof problems === 'number' ? problems : problems.length;
  const imported = `Imported ${grouped.format(count)} ${count === 1 ? 'row' : 'rows'}.`;
  if (!n) return imported;
  return `${imported} ${grouped.format(n)} ${n === 1 ? 'value' : 'values'} couldn't be read.`;
}
