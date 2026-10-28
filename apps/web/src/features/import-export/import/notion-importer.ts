import {
  folderOf,
  isSkipped,
  linkTarget,
  type UploadEntry,
} from '@carehub/extras/import-export/import/documents';
import {
  IMPORT_LIMITS,
  ImportFileError,
  clip,
  planLink,
  type ImportPlan,
  type Importer,
  type PlanColumn,
  type PlanContent,
  type PlanDatabase,
  type PlanFile,
  type PlanPage,
  type PlanRow,
} from '@carehub/extras/import-export/import/index';
import {
  exportFiles,
  notionId,
  notionLinkId,
  notionName,
} from '@carehub/extras/import-export/import/notion';
import { htmlToContent } from './html';
import { readNotionPage, tableOf, type NotionPage, type NotionType } from './notion-html';

// Notion's HTML export (Import and export spec 3.2; IE-04), read on the Import screen
// (readsInBrowser), as the import worker reads the "Markdown & CSV" kind (notion.ts): the page
// tree, the databases with their rows' pages, the files, and the links between them. A page is
// "Title <id>.html", with its sub-pages and files in "Title <id>/"; a database is a page that is
// only its table, with its rows' pages in its folder, or a table inside a page. A table showing
// rows already read is a view of their database, and links to it. Formulas and rollups come in
// as text with their last values, and are listed.

const PAGE = /\.html?$/i;
const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);
const byName = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });
const stemOf = (path: string) => path.replace(PAGE, '');

const planType = (type: NotionType | null): PlanColumn['type'] =>
  type === 'formula' || type === 'rollup' ? 'text' : type === 'title' ? null : type;

const isEmpty = (content: PlanContent) =>
  'doc' in content &&
  (content.doc.content ?? []).every((node) => node.type === 'paragraph' && !node.content?.length);

interface Database {
  database: PlanDatabase;
  /** Each column's type as Notion says it, for the problems. */
  types: (NotionType | null)[];
  /** Its rows' pages, by path. */
  pages: Map<string, PlanRow>;
  /** The page that is the database, or null for a table inside a page (`database.source`). */
  own: string | null;
}

/** The pages, databases, files and problems of Notion's HTML export. */
export function planNotionHtml(entries: readonly UploadEntry[]): ImportPlan {
  const { texts, assets, problems } = exportFiles(entries, PAGE);
  const paths = [...texts.keys()].sort(byName);
  const read = new Map<string, NotionPage>();
  for (const path of paths) {
    read.set(path, readNotionPage(texts.get(path) ?? ''));
    texts.delete(path);
  }
  const pathOf = new Map(paths.map((path) => [stemOf(path), path]));

  let count = 0;
  const newKey = (kind: 'p' | 'd' | 'r' | 'f') => `${kind}${(count += 1)}`;
  /** Pages, rows and databases by their page's path, and by Notion id. */
  const keyOf = new Map<string, string>();
  const keyOfId = new Map<string, string>();
  const known = (path: string, key: string) => {
    keyOf.set(path, key);
    const id = notionId(stemOf(path));
    if (id !== undefined) keyOfId.set(id, key);
  };
  const cell = (source: string, text: string) => {
    if (text.length > IMPORT_LIMITS.cellChars) {
      problems.push({
        file: source,
        what: 'Cut short',
        why: 'Cells can have up to 10,000 characters.',
      });
    }
    return clip(text, IMPORT_LIMITS.cellChars);
  };
  const columnName = (name: string, index: number) =>
    clip(name || `Column ${index + 1}`, IMPORT_LIMITS.columnNameChars);

  const databases: Database[] = [];
  const rowOf = new Map<string, Database>();
  /** What each page's tables link to: their database, or nothing for the page's own. */
  const tableLinks = new Map<string, (string | null)[]>();
  const isDatabase = (path: string) => read.get(path)?.isDatabase === true;
  // Databases' own pages first: a table elsewhere with their rows is a view of them.
  for (const path of [...paths.filter(isDatabase), ...paths.filter((one) => !isDatabase(one))]) {
    const page = read.get(path);
    const links: (string | null)[] = [];
    for (const table of page?.tables ?? []) {
      const rowPaths = table.rows.map(({ href }) =>
        href === null ? null : linkTarget(path, href),
      );
      const shown = rowPaths.find((rowPath) => rowPath !== null && rowOf.has(rowPath));
      const viewOf = shown ? rowOf.get(shown) : undefined;
      if (viewOf) {
        links.push(planLink(viewOf.database.key));
        continue;
      }
      const own = page?.isDatabase ? path : null;
      const title = own === null ? (table.title ?? 'Untitled') : (page?.title ?? null);
      const columns = table.columns.map(({ name, type }, index) => ({
        name: columnName(name, index),
        type: planType(type),
      }));
      if (columns.length === 0) columns.push({ name: 'Name', type: null });
      const of: Database = {
        database: {
          key: newKey('d'),
          parent: null,
          title: clip(title ?? notionName(nameOf(stemOf(path))), IMPORT_LIMITS.titleChars),
          columns,
          rows: [],
          source: path,
        },
        types: table.columns.map(({ type }) => type),
        pages: new Map(),
        own,
      };
      databases.push(of);
      table.rows.forEach((row, index) => {
        const cells = columns.map((_, at) => cell(path, row.cells[at] ?? ''));
        const planRow: PlanRow = { key: newKey('r'), cells };
        of.database.rows.push(planRow);
        const rowPath = rowPaths[index];
        if (rowPath && read.has(rowPath) && !rowOf.has(rowPath) && !isDatabase(rowPath)) {
          rowOf.set(rowPath, of);
          of.pages.set(rowPath, planRow);
          known(rowPath, planRow.key);
        }
      });
      if (own !== null) known(own, of.database.key);
      links.push(own === null ? planLink(of.database.key) : null);
    }
    tableLinks.set(path, links);
  }

  for (const of of databases) {
    const { database, types, pages } = of;
    // Pages in a database's folder that no row links to are rows too, from their properties.
    const folder = of.own === null ? null : stemOf(of.own);
    for (const path of paths) {
      if (folderOf(path) !== folder || keyOf.has(path)) continue;
      const title = read.get(path)?.title ?? notionName(nameOf(stemOf(path)));
      const row: PlanRow = { key: newKey('r'), cells: [cell(path, title)] };
      database.rows.push(row);
      rowOf.set(path, of);
      pages.set(path, row);
      known(path, row.key);
    }
    // Properties a row's page has that its table doesn't show, and their types.
    for (const [path, row] of pages) {
      for (const property of read.get(path)?.properties ?? []) {
        const name = columnName(property.name, database.columns.length);
        let at = database.columns.findIndex((column) => column.name === name);
        if (at < 0) at = database.columns.push({ name, type: planType(property.type) }) - 1;
        const column = database.columns[at];
        if (column && (types[at] ?? null) === null && property.type !== null) {
          types[at] = property.type;
          column.type = planType(property.type);
        }
        if (at > 0 && !row.cells[at]) row.cells[at] = cell(path, property.value);
      }
    }
    for (const row of database.rows) {
      row.cells = database.columns.map((_, at) => row.cells[at] ?? '');
    }
    types.forEach((type, at) => {
      if (type !== 'formula' && type !== 'rollup') return;
      const kind = type === 'formula' ? 'Formula' : 'Rollup';
      const what = `${kind} "${database.columns[at]?.name ?? ''}" kept as text`;
      const why = 'It came in as text, with its last values.';
      problems.push({ file: database.source, what, why });
    });
  }

  const pagePaths = paths.filter((path) => !keyOf.has(path));
  for (const path of pagePaths) known(path, newKey('p'));
  const databasePages = new Set(databases.flatMap(({ own }) => (own === null ? [] : [own])));
  const pages: PlanPage[] = [];
  const folderPages = new Map<string, string>();
  /** What a folder's items go under: its page or row, or a page made for it. */
  const ownerOf = (folder: string): string | null => {
    if (folder === '') return null;
    const path = pathOf.get(folder);
    const own = path === undefined ? undefined : keyOf.get(path);
    if (path !== undefined && own !== undefined) {
      return databasePages.has(path) ? ownerOf(folderOf(folder)) : own;
    }
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

  const files = new Map<string, PlanFile>();
  const target = (to: string): string | null => {
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
  const contentOf = (path: string): PlanContent => {
    const page = read.get(path);
    const { content, problems: found } = htmlToContent(page?.content ?? '', {
      source: path,
      link: (href) => {
        const address = href.trim();
        const table = tableOf(address);
        if (table !== null) return tableLinks.get(path)?.[table] ?? null;
        const id = notionLinkId(address);
        const key = id === undefined ? undefined : keyOfId.get(id);
        if (key !== undefined) return planLink(key);
        const to = linkTarget(path, address);
        return to === null ? address : target(to);
      },
    });
    problems.push(...found);
    const equations = page?.equations ?? 0;
    if (equations > 0) {
      const noun = equations === 1 ? 'equation' : 'equations';
      const what = `${equations.toLocaleString('en-US')} ${noun} kept as text`;
      problems.push({ file: path, what, why: "Pages can't show them yet." });
    }
    return content;
  };

  for (const path of pagePaths) {
    pages.push({
      key: keyOf.get(path) ?? '',
      parent: ownerOf(folderOf(path)),
      title: clip(
        read.get(path)?.title ?? notionName(nameOf(stemOf(path))),
        IMPORT_LIMITS.titleChars,
      ),
      content: contentOf(path),
      source: path,
    });
  }
  for (const { database, pages: rowPages, own } of databases) {
    database.parent = own === null ? (keyOf.get(database.source) ?? null) : ownerOf(folderOf(own));
    for (const [path, row] of rowPages) {
      const content = contentOf(path);
      if (!isEmpty(content)) row.content = content;
    }
  }
  for (const file of [...assets.keys()].filter((path) => !files.has(path))) {
    problems.push({ file, what: 'Skipped', why: 'No page links to it.' });
  }
  return {
    pages,
    databases: databases.map(({ database }) => database),
    files: [...files.values()],
    problems,
  };
}

/** Notion export, its HTML kind: the .zip of Notion's "HTML" export. */
export const notionHtmlImporter: Importer = {
  source: 'notion',
  async plan(input) {
    if (input.zip === null) throw new ImportFileError("this zip isn't a Notion export");
    const entries: UploadEntry[] = [];
    for (const path of input.zip.names) {
      const isPage = PAGE.test(path) && !isSkipped(path);
      entries.push(isPage ? { path, text: await input.zip.text(path) } : { path });
    }
    return planNotionHtml(entries);
  },
};
