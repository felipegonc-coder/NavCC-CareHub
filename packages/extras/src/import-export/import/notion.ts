import { readCsv } from './csv';
import { cleanPath, folderOf, isSkipped, type LinkTarget, type UploadEntry } from './documents';
import { readMarkdown } from './markdown';
import {
  IMPORT_LIMITS,
  ImportFileError,
  clip,
  planLink,
  type ImportPlan,
  type ImportProblem,
  type Importer,
  type PlanColumn,
  type PlanDatabase,
  type PlanFile,
  type PlanPage,
  type PlanRow,
} from './plan';

/**
 * Notion's "Markdown & CSV" export (IE-04), read in the import worker. A page is "Title <id>.md",
 * with its sub-pages, pictures and files in the folder "Title <id>/". A database is
 * "Title <id>.csv" ("…_all.csv" has every row), with its rows' pages in "Title <id>/". Links
 * between them, relative or to notion.so, point at the new pages; property types are guessed as
 * in CSV import. Notion's HTML export is read on the Import screen (readsInBrowser).
 */

/** The id Notion puts after each name. */
const ID = / ([0-9a-f]{32})$/i;
const NOTION_URL =
  /^https?:\/\/(?:www\.)?notion\.so\/(?:[^\s?#]*[-/])?([0-9a-f]{32})(?:[?#]\S*)?$/i;
const PROGRAM = /\.(exe|dll|msi|com|scr|bat|cmd|ps1|vbs|jar|app|apk|sh|dmg|pkg)$/i;
const CSV = /(_all)?\.csv$/i;

const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);
const byName = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });
const withoutEnding = (path: string) => path.replace(/\.md$/i, '').replace(CSV, '');

/** A file or folder name without Notion's id: "Tasks 0f3c…e1" is "Tasks". */
export const notionName = (name: string) => name.replace(ID, '').trim() || name;
const idOf = (path: string) => ID.exec(withoutEnding(path))?.[1]?.toLowerCase();

/** Links to notion.so pages that are in the export, as plan links. */
function notionLinks(markdown: string, keyOfId: ReadonlyMap<string, string>): string {
  return markdown.replace(/(\]\(\s*)(https?:\/\/[^)\s]+)/g, (whole, start: string, url: string) => {
    const id = NOTION_URL.exec(url)?.[1]?.toLowerCase();
    const key = id === undefined ? undefined : keyOfId.get(id);
    return key === undefined ? whole : `${start}${planLink(key)}`;
  });
}

/** Notion writes callouts as <aside> blocks, which Markdown would show as text: quotes instead. */
export function calloutsAsQuotes(text: string): string {
  if (!text.includes('<aside>')) return text;
  let inCallout = false;
  let inCode = false;
  const lines: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!inCallout && /^ {0,3}(```|~~~)/.test(line)) inCode = !inCode;
    const opens = !inCode && !inCallout && /^\s*<aside>/.test(line);
    if (!opens && !inCallout) {
      lines.push(line);
      continue;
    }
    inCallout = true;
    const closes = /<\/aside>\s*$/.test(line);
    const rest = line.replace(/^\s*<aside>/, '').replace(/<\/aside>\s*$/, '');
    if (rest.trim() !== '') lines.push(`> ${rest}`);
    else if (!opens && !closes) lines.push('>');
    if (closes) {
      inCallout = false;
      lines.push('');
    }
  }
  return lines.join('\n');
}

/**
 * A row's page: its title (the first line, "# Call Rowan"), and its text without the "Status:
 * Done" lines Notion puts under the title, which are the row's cells, by property name.
 */
export function rowPage(
  text: string,
  columns: readonly PlanColumn[],
): { title: string | null; text: string; values: Map<string, string> } {
  const names = new Set(columns.map((column) => column.name));
  const values = new Map<string, string>();
  const lines = text.split(/\r?\n/);
  const first = lines.findIndex((line) => line.trim() !== '');
  const title = /^#\s+(.+?)\s*$/.exec(lines[first] ?? '')?.[1] ?? null;
  if (title === null) return { title, text, values };
  let start = first + 1;
  while (start < lines.length && (lines[start] ?? '').trim() === '') start += 1;
  let end = start;
  for (; end < lines.length; end += 1) {
    const property = /^([^:]+):\s?(.*)$/.exec(lines[end] ?? '');
    const name = property?.[1]?.trim() ?? '';
    if (!names.has(name)) break;
    values.set(name, property?.[2] ?? '');
  }
  if (end === start) return { title, text, values };
  while (end < lines.length && (lines[end] ?? '').trim() === '') end += 1;
  const rest = [...lines.slice(0, start), ...lines.slice(end)];
  return { title, text: rest.join('\n'), values };
}

/** Notion's links in cells ("Call Rowan (Callbacks%20…/Call%20Rowan%20….md)") as their titles. */
export function cellText(cell: string): string {
  const titles: string[] = [];
  const link = /(.+?) \((https?:\/\/[^()\s]+|[^()\s]+\.md)\)(?:, |$)/y;
  for (let match = link.exec(cell); match; match = link.exec(cell)) {
    titles.push(match[1] ?? '');
    if (link.lastIndex >= cell.length) return titles.join(', ');
  }
  return cell;
}

interface Table {
  database: PlanDatabase;
  /** Each row page's row, and its text without the row's cells. */
  rowPages: Map<string, { row: PlanRow; text: string }>;
}

/** The pages, databases, files and problems of a Notion export. */
export function planNotion(entries: readonly UploadEntry[]): ImportPlan {
  const problems: ImportProblem[] = [];
  const documents = new Map<string, string>();
  /** CSV files by their database's folder ("Callbacks <id>"). */
  const csvs = new Map<string, { path: string; text: string }>();
  const assets = new Map<string, string>();
  let zips = 0;
  for (const entry of entries) {
    if (entry.path.endsWith('/') || isSkipped(entry.path)) continue;
    const path = cleanPath(entry.path);
    if (path === null) {
      problems.push({ file: entry.path, what: 'Skipped', why: 'Its path points outside the zip.' });
    } else if (PROGRAM.test(path)) {
      problems.push({ file: path, what: 'Refused', why: "Programs can't be imported." });
    } else if (/\.zip$/i.test(path)) {
      zips += 1;
      problems.push({ file: path, what: 'Skipped', why: "Zips inside zips aren't opened." });
    } else if (entry.text !== undefined && /\.md$/i.test(path)) {
      documents.set(path, entry.text);
    } else if (entry.text !== undefined && CSV.test(path)) {
      const folder = path.replace(CSV, '');
      if (/_all\.csv$/i.test(path) || !csvs.has(folder))
        csvs.set(folder, { path, text: entry.text });
    } else {
      assets.set(path, entry.path);
    }
  }
  if (documents.size === 0 && csvs.size === 0) {
    throw new ImportFileError(
      zips > 0
        ? 'its pages are in a zip inside it, so unzip it first'
        : "this zip isn't a Notion export",
    );
  }

  let count = 0;
  const newKey = (kind: 'p' | 'd' | 'r' | 'f') => `${kind}${(count += 1)}`;
  /** Pages, rows and databases by path (documents, CSV files), and by Notion id. */
  const keyOf = new Map<string, string>();
  const keyOfId = new Map<string, string>();
  const known = (path: string, key: string) => {
    keyOf.set(path, key);
    const id = idOf(path);
    if (id !== undefined) keyOfId.set(id, key);
  };
  const inFolder = new Map<string, string[]>();
  for (const path of [...documents.keys()].sort(byName)) {
    const folder = inFolder.get(folderOf(path));
    if (folder) folder.push(path);
    else inFolder.set(folderOf(path), [path]);
  }

  const tables: Table[] = [];
  for (const [folder, csv] of [...csvs].sort(([a], [b]) => byName(a, b))) {
    const [header = [], ...lines] = readCsv(csv.text);
    const columns: PlanColumn[] = (header.length > 0 ? header : ['Name']).map((name, index) => ({
      name: clip(name.trim() || `Column ${index + 1}`, IMPORT_LIMITS.columnNameChars),
      type: null,
    }));
    const fit = (cells: readonly string[]) =>
      columns.map((_, index) => {
        const cell = index === 0 ? (cells[0] ?? '') : cellText(cells[index] ?? '');
        if (cell.length > IMPORT_LIMITS.cellChars) {
          problems.push({
            file: csv.path,
            what: 'Cut short',
            why: 'Cells can have up to 10,000 characters.',
          });
        }
        return clip(cell, IMPORT_LIMITS.cellChars);
      });
    const rows: PlanRow[] = [];
    const byTitle = new Map<string, PlanRow[]>();
    for (const cells of lines) {
      const row = { key: newKey('r'), cells: fit(cells) };
      rows.push(row);
      const title = row.cells[0] ?? '';
      const same = byTitle.get(title);
      if (same) same.push(row);
      else byTitle.set(title, [row]);
    }
    const database: PlanDatabase = {
      key: newKey('d'),
      parent: null,
      title: clip(notionName(nameOf(folder)), IMPORT_LIMITS.titleChars),
      columns,
      rows,
      source: csv.path,
    };
    known(`${folder}.csv`, database.key);
    keyOf.set(`${folder}_all.csv`, database.key);
    // Each row page belongs to the first row with its title; one without a row makes its own.
    const rowPages = new Map<string, { row: PlanRow; text: string }>();
    for (const path of inFolder.get(folder) ?? []) {
      const page = rowPage(documents.get(path) ?? '', columns);
      const title = page.title ?? notionName(nameOf(withoutEnding(path)));
      let row = byTitle.get(title)?.shift();
      if (!row) {
        const cells = columns.map((column, index) =>
          index === 0 ? title : (page.values.get(column.name) ?? ''),
        );
        row = { key: newKey('r'), cells: fit(cells) };
        rows.push(row);
      }
      rowPages.set(path, { row, text: page.text });
      known(path, row.key);
    }
    tables.push({ database, rowPages });
  }

  const pages: PlanPage[] = [];
  const folderPages = new Map<string, string>();
  /** What a folder's items go under: its page or row, or a page made for it. */
  const ownerOf = (folder: string): string | null => {
    if (folder === '') return null;
    const own = keyOf.get(`${folder}.md`);
    if (own !== undefined) return own;
    if (csvs.has(folder)) return ownerOf(folderOf(folder));
    let key = folderPages.get(folder);
    if (key === undefined) {
      key = newKey('p');
      folderPages.set(folder, key);
      const title = clip(notionName(nameOf(folder)), IMPORT_LIMITS.titleChars);
      const parent = ownerOf(folderOf(folder));
      pages.push({ key, parent, title, content: { markdown: '' }, source: folder });
    }
    return key;
  };
  const documentPages = [...documents.keys()]
    .sort(byName)
    .filter((path) => !csvs.has(folderOf(path)));
  for (const path of documentPages) known(path, newKey('p'));

  const files = new Map<string, PlanFile>();
  const target: LinkTarget = (to) => {
    const key = keyOf.get(to);
    if (key !== undefined) return planLink(key);
    const entry = assets.get(to);
    if (entry === undefined) return null;
    let file = files.get(to);
    if (!file) {
      file = { key: newKey('f'), name: nameOf(to), entry };
      files.set(to, file);
    }
    return planLink(file.key);
  };
  const read = (path: string, text: string) => {
    const page = readMarkdown(path, calloutsAsQuotes(text), target);
    problems.push(...page.problems);
    return { title: page.title, markdown: notionLinks(page.content.markdown, keyOfId) };
  };

  for (const path of documentPages) {
    const { title, markdown } = read(path, documents.get(path) ?? '');
    pages.push({
      key: keyOf.get(path) ?? '',
      parent: ownerOf(folderOf(path)),
      title: clip(title ?? notionName(nameOf(withoutEnding(path))), IMPORT_LIMITS.titleChars),
      content: { markdown },
      source: path,
    });
  }
  for (const { database, rowPages } of tables) {
    database.parent = ownerOf(folderOf(database.source));
    for (const [path, { row, text }] of rowPages) {
      const { markdown } = read(path, text);
      if (markdown.trim() !== '') row.content = { markdown };
    }
  }
  const unlinked = [...assets.keys()].filter((path) => !files.has(path));
  for (const file of unlinked)
    problems.push({ file, what: 'Skipped', why: 'No page links to it.' });
  return {
    pages,
    databases: tables.map(({ database }) => database),
    files: [...files.values()],
    problems,
  };
}

/** Notion export: the .zip of its "Markdown & CSV" export (the HTML kind is read in the browser). */
export const notionImporter: Importer = {
  source: 'notion',
  async plan(input) {
    if (input.zip === null) throw new ImportFileError("this zip isn't a Notion export");
    const entries: UploadEntry[] = [];
    for (const path of input.zip.names) {
      const isText = /\.(md|csv)$/i.test(path) && !isSkipped(path);
      entries.push(isText ? { path, text: await input.zip.text(path) } : { path });
    }
    return planNotion(entries);
  },
};
