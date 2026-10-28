import type { ImportSourceId } from './sources';

/**
 * What one import may bring in (Import and export spec 3.1; docs/extras/import-export.md#safety).
 * Known gap: the spec allows 2 GB uploads, but for now an upload is capped at 100 MB, #109's zip
 * limit.
 */
export const IMPORT_LIMITS = {
  uploadBytes: 100 * 1024 * 1024,
  /** Pages and databases together (rows are counted per database). */
  pages: 10_000,
  files: 50_000,
  /** Every character the import writes, each repeat of a shared item included ("10 MB of text"). */
  textChars: 10_000_000,
  titleChars: 500,
  /** One page's text: its Markdown, or its document as JSON. */
  pageChars: 1_000_000,
  fileNameChars: 255,
  /** A database, as for CSV files (Databases 3.7). */
  columns: 200,
  columnNameChars: 100,
  rows: 20_000,
  cellChars: 10_000,
  /** How deep pages may sit below the destination. */
  depth: 64,
  /** Problems kept for the summary and its CSV; the count goes on past it. */
  problems: 1_000,
} as const;

/** Undo import stays in the summary for 7 days. */
export const UNDO_DAYS = 7;

/** A line of the summary's problem list: the file, what happened, and why. */
export interface ImportProblem {
  file: string;
  what: string;
  why: string;
}

/** A node of an editor document: ProseMirror JSON of the page schema (@carehub/editor). */
export interface PlanNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PlanNode[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
}

/**
 * A page's text: Markdown, read with the editor's Markdown rules (HTML off), or an editor
 * document made in the browser, which the server checks against the page schema again.
 */
export type PlanContent = { markdown: string } | { doc: PlanNode };

/**
 * A page the import makes. `parent` is the key of a page or of a database row, or null for right
 * under the destination. Links to other items of the plan are `carehub-import:<key>`.
 */
export interface PlanPage {
  key: string;
  parent: string | null;
  title: string;
  content: PlanContent;
  /** The file it came from, for problems. */
  source: string;
}

/** Property types an import can make (Databases 3.7's types for new properties). */
export const PLAN_COLUMN_TYPES = [
  'text',
  'number',
  'select',
  'multi_select',
  'status',
  'date',
  'checkbox',
  'url',
  'email',
  'phone',
] as const;
export type PlanColumnType = (typeof PLAN_COLUMN_TYPES)[number];

export interface PlanColumn {
  name: string;
  /** The type when the source says it; null to guess it from the values, as CSV import does. */
  type: PlanColumnType | null;
}

export interface PlanRow {
  key: string;
  /** One per column, as text. The first column is the row's title. */
  cells: string[];
  /** The row's page, when it has text. */
  content?: PlanContent;
}

/** A database the import makes, with its rows. */
export interface PlanDatabase {
  key: string;
  parent: string | null;
  title: string;
  columns: PlanColumn[];
  rows: PlanRow[];
  source: string;
}

/**
 * A file the import uploads. Its bytes are the zip entry `entry` of the upload, or `bytes` for
 * browser importers that find files inside a file (Evernote's attachments).
 */
export interface PlanFile {
  key: string;
  name: string;
  entry?: string;
  bytes?: Uint8Array;
}

/**
 * What an importer gives back: the importer reads the file, the import job writes this. Every
 * source has this one shape, so a new source needs no job changes.
 */
export interface ImportPlan {
  pages: PlanPage[];
  databases: PlanDatabase[];
  files: PlanFile[];
  problems: ImportProblem[];
}

/** A zip the person picked, read with #109's reader and its limits. */
export interface ImportZip {
  /** The entries' names with "/" between folders, folders left out. Never used as paths. */
  names: readonly string[];
  /** An entry's bytes; throws ImportFileError when it's damaged. */
  read(name: string): Promise<Uint8Array>;
  /** An entry's text: UTF-8 (with or without a byte order mark), otherwise Windows-1252. */
  text(name: string): Promise<string>;
}

/** The file an importer reads. */
export interface ImportInput {
  fileName: string;
  bytes: Uint8Array;
  /** The file's text, as for zip entries. */
  text(): Promise<string>;
  /** Set when the file is a zip (a .docx is one). */
  zip: ImportZip | null;
}

/**
 * An importer: no database, no network, no signing in anywhere (IE-D1). It throws ImportFileError
 * for a file it can't read; anything it can't bring in goes in the plan's problems.
 */
export interface Importer {
  source: ImportSourceId;
  plan(input: ImportInput): Promise<ImportPlan>;
}

/** Why an import stopped, such as "the zip is damaged" (see stoppedMessage). */
export class ImportFileError extends Error {
  override name = 'ImportFileError';
}

/** "The import stopped: the zip is damaged. Nothing was added." */
export const stoppedMessage = (reason: string) =>
  `The import stopped: ${reason}. Nothing was added.`;

export const PLAN_LINK = 'carehub-import:';
const KEY = /^[A-Za-z0-9_-]{1,64}$/;

/** The link an importer writes for another page, row or file of its plan. */
export const planLink = (key: string) => `${PLAN_LINK}${key}`;

/** `text` with every plan link swapped for what `resolve` gives (unknown keys keep their link). */
export function resolvePlanLinks(text: string, resolve: (key: string) => string | null): string {
  return text.replace(
    /carehub-import:([A-Za-z0-9_-]{1,64})/g,
    (link, key: string) => resolve(key) ?? link,
  );
}

/** `text` cut to `max` characters (never in the middle of a surrogate pair). */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const end = /[\uD800-\uDBFF]/.test(text.charAt(max - 1)) ? max - 1 : max;
  return text.slice(0, end);
}

/** Characters a page's text takes. */
export const contentSize = (content: PlanContent) =>
  'markdown' in content ? content.markdown.length : JSON.stringify(content.doc).length;

/** Characters the plan writes: titles, text, cells and names. */
export function planTextSize(plan: ImportPlan): number {
  let size = 0;
  for (const page of plan.pages) size += page.title.length + contentSize(page.content);
  for (const database of plan.databases) {
    size += database.title.length;
    for (const column of database.columns) size += column.name.length;
    for (const row of database.rows) {
      for (const cell of row.cells) size += cell.length;
      if (row.content) size += contentSize(row.content);
    }
  }
  for (const file of plan.files) size += file.name.length;
  return size;
}

export type PlanItem =
  { kind: 'page'; page: PlanPage } | { kind: 'database'; database: PlanDatabase };

/**
 * Checks a plan against the limits and its own keys, before anything is written, and gives the
 * order to make it in: every parent before what's under it. A page or database sits under
 * another page, a row, or the destination (null).
 */
export function checkPlan(plan: ImportPlan): PlanItem[] {
  if (plan.pages.length + plan.databases.length > IMPORT_LIMITS.pages) {
    throw new ImportFileError('imports can have up to 10,000 pages');
  }
  if (plan.files.length > IMPORT_LIMITS.files) {
    throw new ImportFileError('imports can have up to 50,000 files');
  }
  if (planTextSize(plan) > IMPORT_LIMITS.textChars) {
    throw new ImportFileError('imports can have up to 10 MB of text');
  }
  const damaged = () => new ImportFileError('the import is damaged');
  const keys = new Set<string>();
  const use = (key: string) => {
    if (!KEY.test(key) || keys.has(key)) throw damaged();
    keys.add(key);
  };
  /** Pages and rows, by key: what can be a parent, and its own parent. */
  const parentOf = new Map<string, string | null>();
  for (const file of plan.files) use(file.key);
  for (const page of plan.pages) {
    use(page.key);
    parentOf.set(page.key, page.parent);
  }
  for (const database of plan.databases) {
    if (database.columns.length > IMPORT_LIMITS.columns) {
      throw new ImportFileError('databases can have up to 200 columns');
    }
    if (database.rows.length > IMPORT_LIMITS.rows) {
      throw new ImportFileError('databases can have up to 20,000 rows');
    }
    use(database.key);
    for (const row of database.rows) {
      use(row.key);
      parentOf.set(row.key, database.parent);
    }
  }
  const levelOf = (parent: string | null): number => {
    let level = 0;
    for (let at = parent; at !== null; at = parentOf.get(at) ?? null) {
      if (!parentOf.has(at)) throw damaged();
      level += 1;
      if (level > IMPORT_LIMITS.depth) {
        throw new ImportFileError('pages can be nested up to 64 levels deep');
      }
    }
    return level;
  };
  const order: { item: PlanItem; level: number }[] = [];
  for (const page of plan.pages) {
    order.push({ item: { kind: 'page', page }, level: levelOf(page.parent) });
  }
  for (const database of plan.databases) {
    order.push({ item: { kind: 'database', database }, level: levelOf(database.parent) });
  }
  // A stable sort: same-level items keep the plan's order.
  return order.sort((a, b) => a.level - b.level).map(({ item }) => item);
}
